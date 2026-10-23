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
 * AniKoto Isolated Anime Details Edge Endpoint:
 * GET /api/anikoto/:id
 */
export const onRequestGet = async ({ params, env }) => {
  try {
    const rawId = decodeURIComponent(params.id || '').trim();
    if (!rawId) {
      throw new HttpError(400, 'bad_request', 'anime id is required');
    }

    const slug = rawId.replace(/^anikoto:/i, '').trim();
    let animeData = null;
    let episodes = [];
    let source = 'd1';

    // --- STEP 1: Query Indexed D1 SQLite Database (<5ms) ---
    if (env.ANIHUB) {
      try {
        const d1Anime = await env.ANIHUB.prepare(
          `SELECT a.id, a.title, a.native, a.art, a.key_art,
                  a.synopsis, a.rating, a.year, a.kind, a.status, a.episode_total,
                  m.mal_id, m.anikoto_slug
           FROM anime a
           LEFT JOIN anime_id_map m ON a.id = m.anime_id
           LEFT JOIN anime_provider_mapping pm ON a.id = pm.anime_id AND pm.provider_id = 'anikoto'
           WHERE a.id = ?1 OR m.anikoto_slug = ?1 OR pm.provider_slug = ?1 OR lower(a.title) = lower(?1)
           LIMIT 1`
        ).bind(slug).first();

        if (d1Anime) {
          const canonicalId = d1Anime.id;
          const epRows = await env.ANIHUB.prepare(
            `SELECT n, title, runtime_seconds, markers, thumbnail_url
             FROM episode
             WHERE anime_id = ?1
             ORDER BY n ASC`
          ).bind(canonicalId).all().catch(() => ({ results: [] }));

          const epList = epRows.results || [];
          const totalEp = Number(d1Anime.episode_total) || epList.length || 1;

          // Format episodes
          if (epList.length > 0) {
            episodes = epList.map((e) => ({
              id: `anikoto:${d1Anime.anikoto_slug || slug}#${e.n}`,
              n: e.n,
              title: e.title || `Episode ${e.n}`,
              audioType: 'both',
              duration: e.runtime_seconds || 1440,
            }));
          } else if (totalEp > 0) {
            // Generate synthetic episode sequence if catalogue has declared count
            for (let i = 1; i <= Math.min(totalEp, 2000); i++) {
              episodes.push({
                id: `anikoto:${d1Anime.anikoto_slug || slug}#${i}`,
                n: i,
                title: `Episode ${i}`,
                audioType: 'both',
              });
            }
          }

          animeData = {
            id: `anikoto:${d1Anime.anikoto_slug || slug}`,
            slug: d1Anime.anikoto_slug || slug,
            title: cleanDisplayTitle(d1Anime.title),
            originalTitle: d1Anime.native || '',
            art: d1Anime.art || d1Anime.key_art || '',
            banner: d1Anime.key_art || '',
            description: d1Anime.synopsis || '',
            rating: Number(d1Anime.rating) || 8.0,
            year: Number(d1Anime.year) || null,
            format: d1Anime.kind || 'TV',
            status: d1Anime.status || 'finished',
            genres: [],
            totalEpisodes: totalEp,
            malId: d1Anime.mal_id ? Number(d1Anime.mal_id) : null,
            provider: 'anikoto',
          };
        }
      } catch (_) {}
    }

    // --- STEP 2: Live anikoto.cz Scraping Fallback ---
    if (!animeData) {
      source = 'upstream';
      const watchUrl = `${ANIKOTO_MAIN}/watch/${encodeURIComponent(slug)}`;
      const res = await fetch(watchUrl, {
        headers: {
          'User-Agent': USER_AGENT,
          Referer: `${ANIKOTO_MAIN}/`,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        signal: AbortSignal.timeout(4500),
      });

      if (!res.ok) {
        throw new HttpError(res.status, 'not_found', `AniKoto details not found for "${slug}"`);
      }

      const html = await res.text();
      const watchId = html.match(/id="watch-main"[^>]*data-id="([^"]*)"/i)?.[1] || '';
      if (!watchId) {
        throw new HttpError(404, 'not_found', `AniKoto watch page missing data-id for "${slug}"`);
      }

      const titleMatch = html.match(/<[^>]+class="[^"]*heading-name[^"]*"[^>]*>([\s\S]*?)<\/[^>]*>/i)
        || html.match(/<title>([\s\S]*?)<\/title>/i);
      const title = cleanText(titleMatch?.[1] || slug).replace(/\s*[-–|].*$/, '');

      const originalTitle = cleanText(html.match(/<[^>]+class="[^"]*name-original[^"]*"[^>]*>([\s\S]*?)<\/[^>]*>/i)?.[1] || '');
      const coverUrl = html.match(/<meta property="og:image" content="([^"]*)"/i)?.[1] || '';
      const year = Number(html.match(/<[^>]+itemprop="contentYear"[^>]*content="(\d{4})"/i)?.[1]) || null;
      const genres = [...new Set([...html.matchAll(/<a[^>]+href="[^"]*genres[^"]*"[^>]*>([^<]+)<\/a>/gi)].map((m) => cleanText(m[1])).filter(Boolean))];

      // Fetch episodes
      const epListRes = await fetch(`${ANIKOTO_MAIN}/ajax/episode/list/${watchId}?vrf=`, {
        headers: {
          'User-Agent': USER_AGENT,
          Referer: watchUrl,
          'X-Requested-With': 'XMLHttpRequest',
          Accept: 'application/json, text/javascript, */*; q=0.01',
        },
        signal: AbortSignal.timeout(4500),
      });

      if (epListRes.ok) {
        const epData = await epListRes.json().catch(() => null);
        const epHtml = epData?.html || epData?.result || '';
        for (const m of epHtml.matchAll(/<a\b[^>]*data-ids="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)) {
          const tag = m[0];
          const numRaw = tag.match(/data-num="([^"]*)"/i)?.[1] || '';
          const num = Number(numRaw) || episodes.length + 1;
          const isSub = tag.includes('data-sub="1"');
          const isDub = tag.includes('data-dub="1"');
          const audioType = isDub && isSub ? 'both' : isDub ? 'dub' : 'sub';
          const epTitle = cleanText(tag.match(/class="[^"]*d-title[^"]*"[^>]*>([\s\S]*?)<\/[^>]*>/i)?.[1] || '') || `Episode ${num}`;

          episodes.push({
            id: `anikoto:${slug}#${num}`,
            n: num,
            title: epTitle,
            audioType,
          });
        }
      }

      animeData = {
        id: `anikoto:${slug}`,
        slug,
        title,
        originalTitle,
        art: coverUrl,
        banner: coverUrl,
        description: '',
        rating: 8.0,
        year,
        format: 'TV',
        status: 'finished',
        genres,
        totalEpisodes: episodes.length || 1,
        malId: null,
        provider: 'anikoto',
      };
    }

    return ok({
      ok: true,
      data: {
        anime: animeData,
        episodes,
      },
      source,
      provider: 'anikoto',
    }, { cache: 'public, max-age=300, s-maxage=600' });
  } catch (err) {
    return errorResponse(err);
  }
};
