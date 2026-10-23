// @ts-check
import { HttpError, cardFromRow, cleanDisplayTitle, errorResponse, ok } from './_lib.js';

const FAN_OUT_TIMEOUT_MS = 3_500;
const KNOWN_PROVIDERS = {
  anikoto: { name: 'AniKoto', badge: 'HLS 1080p', color: '#6366f1', icon: '⚡' },
  hianime: { name: 'HiAnime', badge: 'Multi-Quality', color: '#ec4899', icon: '🌸' },
  aniwatch: { name: 'AniWatch', badge: 'Megaplay', color: '#3b82f6', icon: '🛡️' },
  watchanimeworld: { name: 'WatchAnimeWorld', badge: 'Direct MP4', color: '#10b981', icon: '🌐' },
};

/**
 * High-Performance Consolidated Federated Search Edge Endpoint:
 * 1. Single-pass D1 indexed search with provider aggregation via GROUP_CONCAT.
 * 2. Deduplicated canonical anime items with rich metadata (ratings, year, ep count, genres).
 * 3. Multi-provider mapping badges per anime for instant 1-click stream launching.
 * 4. Backward-compatible grouped provider format for classic shelf carousels.
 * 5. Upstream fallback when D1 yields zero matches.
 *
 * GET /api/search?q=<query>
 */
export const onRequestGet = async ({ request, env }) => {
  try {
    const url = new URL(request.url);
    const q = (url.searchParams.get('q') || '').trim();

    if (!q) {
      throw new HttpError(400, 'bad_request', 'q query parameter is required');
    }

    const likeTerm = `%${q.toLowerCase()}%`;
    const grouped = {
      anikoto: [],
      hianime: [],
      aniwatch: [],
      watchanimeworld: [],
    };
    const results = [];
    let source = 'd1';

    // --- STEP 1: Single-Pass Direct Cloudflare D1 Indexed Search (<10ms) ---
    if (env.ANIHUB) {
      try {
        const d1Rows = await env.ANIHUB.prepare(
          `SELECT a.id, a.title, a.native, a.year, a.rating, a.season, a.kind, a.status,
                  a.art, a.key_art, a.accent, a.synopsis, a.rank, a.trend_rank, a.alt_seasons,
                  a.sched_day, a.sched_day_label, a.sched_date, a.sched_time, a.sched_season,
                  a.episode_total, a.source_ids, a.skip_key_id, a.skip_key_space,
                  (SELECT group_concat(genre_id) FROM anime_genre ag WHERE ag.anime_id = a.id) AS genre_ids,
                  GROUP_CONCAT(pm.provider_id || ':' || COALESCE(pm.provider_slug, a.id)) AS provider_pairs
           FROM anime a
           LEFT JOIN anime_provider_mapping pm ON pm.anime_id = a.id
           WHERE a.search_text LIKE ?1 OR a.title LIKE ?1 OR a.id LIKE ?1
           GROUP BY a.id
           ORDER BY a.trend_rank IS NULL, a.trend_rank ASC, a.rating DESC
           LIMIT 40`
        ).bind(likeTerm).all().catch(() => ({ results: [] }));

        for (const row of d1Rows.results || []) {
          const rawPairs = row.provider_pairs ? String(row.provider_pairs).split(',') : [];
          const providerList = [];
          const seenProv = new Set();

          for (const pair of rawPairs) {
            const colonIndex = pair.indexOf(':');
            const provId = colonIndex === -1 ? pair : pair.slice(0, colonIndex);
            const provSlug = colonIndex === -1 ? row.id : pair.slice(colonIndex + 1);
            if (provId && !seenProv.has(provId)) {
              seenProv.add(provId);
              const meta = KNOWN_PROVIDERS[provId] || {
                name: provId.toUpperCase(),
                badge: 'Provider',
                color: '#6366f1',
                icon: '▶',
              };
              providerList.push({
                id: provId,
                name: meta.name,
                slug: provSlug || row.id,
                badge: meta.badge,
                color: meta.color,
                icon: meta.icon,
              });

              // Populate backward-compatible grouped map
              if (!grouped[provId]) grouped[provId] = [];
              grouped[provId].push({
                id: row.id,
                slug: provSlug || row.id,
                title: cleanDisplayTitle(row.title || ''),
                coverUrl: row.art || row.key_art || null,
                provider: provId,
              });
            }
          }

          // If no provider mapping in DB, default to anikoto & hianime
          if (providerList.length === 0) {
            providerList.push(
              { id: 'anikoto', name: 'AniKoto', slug: row.id, badge: 'HLS 1080p', color: '#6366f1', icon: '⚡' },
              { id: 'hianime', name: 'HiAnime', slug: row.id, badge: 'Multi-Quality', color: '#ec4899', icon: '🌸' }
            );
            grouped.anikoto.push({ id: row.id, slug: row.id, title: cleanDisplayTitle(row.title), coverUrl: row.art, provider: 'anikoto' });
            grouped.hianime.push({ id: row.id, slug: row.id, title: cleanDisplayTitle(row.title), coverUrl: row.art, provider: 'hianime' });
          }

          const baseCard = cardFromRow(row);

          results.push({
            ...baseCard,
            id: row.id,
            slug: row.id,
            title: cleanDisplayTitle(row.title),
            native: row.native || '',
            coverUrl: row.art || row.key_art || '',
            art: row.art || row.key_art || '',
            keyArt: row.key_art || '',
            rating: Number(row.rating) || 8.0,
            year: Number(row.year) || null,
            kind: row.kind || 'TV',
            format: row.kind || 'TV',
            status: row.status || 'Finished',
            episodeTotal: Number(row.episode_total) || 0,
            genres: baseCard.genres || [],
            providers: providerList,
          });
        }
      } catch (_) {}
    }

    // --- STEP 2: Upstream Stream Bridge / Scrape Fallback if D1 is empty ---
    if (results.length === 0) {
      source = 'upstream';
      const bridgeBase = env.STREAM_BRIDGE_URL || '';

      if (bridgeBase) {
        const bridgeSearches = ['aniwatch', 'hianime', 'anikoto', 'watchanimeworld'].map(async (provider) => {
          try {
            const searchUrl = new URL(`${bridgeBase}/search`);
            searchUrl.searchParams.set('q', q);
            searchUrl.searchParams.set('provider', provider);

            const res = await fetch(searchUrl.toString(), {
              headers: { accept: 'application/json' },
              signal: AbortSignal.timeout(FAN_OUT_TIMEOUT_MS),
            });
            if (res.ok) {
              const data = await res.json().catch(() => []);
              if (Array.isArray(data)) {
                return {
                  provider,
                  items: data.map((item) => ({
                    id: item.id || item.slug,
                    slug: item.slug || item.id,
                    title: cleanDisplayTitle(item.title || ''),
                    coverUrl: item.coverUrl || null,
                    provider,
                  })),
                };
              }
            }
          } catch {}
          return { provider, items: [] };
        });

        const settled = await Promise.allSettled(bridgeSearches);
        for (const out of settled) {
          if (out.status === 'fulfilled') {
            const { provider, items } = out.value;
            grouped[provider] = items;
            for (const it of items) {
              results.push({
                id: it.id,
                slug: it.slug,
                title: it.title,
                native: '',
                coverUrl: it.coverUrl || '',
                art: it.coverUrl || '',
                keyArt: '',
                rating: 8.0,
                year: null,
                kind: 'TV',
                format: 'TV',
                status: 'Ongoing',
                episodeTotal: 0,
                genres: [],
                providers: [{
                  id: provider,
                  name: KNOWN_PROVIDERS[provider]?.name || provider,
                  slug: it.slug,
                  badge: KNOWN_PROVIDERS[provider]?.badge || 'Stream',
                  color: KNOWN_PROVIDERS[provider]?.color || '#6366f1',
                  icon: KNOWN_PROVIDERS[provider]?.icon || '▶',
                }],
              });
            }
          }
        }
      }
    }

    const providerItemCount = Object.values(grouped).reduce((sum, list) => sum + (Array.isArray(list) ? list.length : 0), 0);

    return ok(
      {
        query: q,
        total: results.length,
        count: providerItemCount,
        results,
        providers: grouped,
        source,
      },
      {
        cache: 'public, max-age=180, s-maxage=300',
      }
    );
  } catch (err) {
    return errorResponse(err);
  }
};
