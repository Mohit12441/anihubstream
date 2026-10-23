// @ts-check
import { HttpError, cleanDisplayTitle, errorResponse, ok } from '../_lib.js';

const ANIKOTO_MAIN = 'https://anikoto.cz';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

function cleanText(text) {
  if (!text) return '';
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * AniKoto Isolated Search Edge Endpoint:
 * GET /api/anikoto/search?q=
 */
export const onRequestGet = async ({ request, env }) => {
  try {
    const url = new URL(request.url);
    const q = (url.searchParams.get('q') || '').trim();

    if (!q) {
      return ok({
        ok: true,
        data: [],
        total: 0,
        provider: 'anikoto',
        source: 'd1',
      });
    }

    const seenIds = new Set();
    const results = [];

    // --- STEP 1: Fast D1 Search (<10ms) ---
    if (env.ANIHUB) {
      try {
        const likeTerm = `%${q.toLowerCase()}%`;
        const d1Rows = await env.ANIHUB.prepare(
          `SELECT a.id, a.title, a.native, a.art, a.key_art,
                  a.rating, a.year, a.episode_total, a.kind, m.mal_id,
                  COALESCE(pm.provider_slug, m.anikoto_slug, a.id) as slug
           FROM anime a
           JOIN anime_provider_mapping pm ON pm.anime_id = a.id AND pm.provider_id = 'anikoto'
           LEFT JOIN anime_id_map m ON a.id = m.anime_id
           WHERE a.search_text LIKE ?1 OR a.title LIKE ?1 OR a.id LIKE ?1
           ORDER BY a.trend_rank IS NULL, a.trend_rank ASC, a.rating DESC
           LIMIT 20`
        ).bind(likeTerm).all().catch(() => ({ results: [] }));

        for (const row of d1Rows.results || []) {
          const finalSlug = row.slug || row.id;
          const mediaId = `anikoto:${finalSlug}`;
          if (seenIds.has(mediaId)) continue;
          seenIds.add(mediaId);

          results.push({
            id: mediaId,
            slug: finalSlug,
            title: cleanDisplayTitle(row.title),
            originalTitle: row.native || '',
            coverUrl: row.art || row.key_art || '',
            rating: Number(row.rating) || 8.0,
            year: Number(row.year) || null,
            episodeCount: Number(row.episode_total) || 0,
            format: row.kind || 'TV',
            malId: row.mal_id ? Number(row.mal_id) : null,
            provider: 'anikoto',
          });
        }
      } catch (_) {}
    }

    // --- STEP 2: Upstream anikoto.cz Scraping Fallback ---
    if (results.length < 3) {
      try {
        const searchUrl = `${ANIKOTO_MAIN}/filter?keyword=${encodeURIComponent(q).replace(/%20/g, '+')}`;
        const upstreamRes = await fetch(searchUrl, {
          headers: {
            'User-Agent': USER_AGENT,
            Referer: `${ANIKOTO_MAIN}/`,
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
          signal: AbortSignal.timeout(3500),
        });

        if (upstreamRes.ok) {
          const html = await upstreamRes.text();
          // Extract item cards
          const cardMatches = [...html.matchAll(/<div[^>]+class="[^"]*film-detail[^"]*"[\s\S]*?<\/div>\s*<\/div>/gi)];

          for (const card of cardMatches) {
            const block = card[0];
            const href = block.match(/href="[^"]*\/watch\/([^"/?#]+)/i)?.[1] || '';
            const titleMatch = block.match(/<a\b[^>]*class="[^"]*\bfilm-name\b[^"]*"[^>]*>([\s\S]*?)<\/a>/i)
              || block.match(/title="([^"]*)"/i);
            const title = cleanText(titleMatch?.[1] || '');
            if (!href || !title) continue;

            const mediaId = `anikoto:${href}`;
            if (seenIds.has(mediaId)) continue;
            seenIds.add(mediaId);

            results.push({
              id: mediaId,
              slug: href,
              title,
              originalTitle: '',
              coverUrl: '',
              rating: 8.0,
              year: null,
              episodeCount: 0,
              format: 'TV',
              malId: null,
              provider: 'anikoto',
            });
          }
        }
      } catch (_) {}
    }

    return ok({
      ok: true,
      data: results,
      total: results.length,
      provider: 'anikoto',
      source: results.length > 0 ? (seenIds.size > results.length ? 'hybrid' : 'd1') : 'upstream',
    }, { cache: 'public, max-age=180, s-maxage=300' });
  } catch (err) {
    return errorResponse(err);
  }
};
