// @ts-check
import { HttpError, cleanDisplayTitle, errorResponse, ok, withEdgeCache } from '../_lib.js';

const HIANIME_MAIN = 'https://hianimex.com.in';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

function normalizeSearch(text) {
  return String(text || '')
    .replace(/[‘’⁌⁍′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/[–—―]/g, '-')
    .trim();
}

/**
 * HiAnime Isolated Search Edge Endpoint:
 * GET /api/hianime/search?q=<query>&page=1&limit=24
 */
export const onRequestGet = async ({ request, env, waitUntil }) => {
  return withEdgeCache(
    request,
    env,
    1800,
    async () => {
      try {
        const url = new URL(request.url);
        const q = (url.searchParams.get('q') || '').trim();
        const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
        const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit')) || 24));

        if (!q) {
          throw new HttpError(400, 'bad_request', 'q query parameter is required');
        }

        const cleanQ = normalizeSearch(q);

        // Call upstream HiAnime search
        let html = '';
        try {
          const res = await fetch(`${HIANIME_MAIN}/search?keyword=${encodeURIComponent(cleanQ)}`, {
            headers: {
              'User-Agent': USER_AGENT,
              Referer: `${HIANIME_MAIN}/`,
            },
            signal: AbortSignal.timeout(6000),
          });

          if (res.ok) {
            html = await res.text();
          }
        } catch (_) {}

        if (!html) {
          return ok({ ok: true, data: { results: [], total: 0 } });
        }
        const cardRegex = /<div class="[^"]*flw-item[^"]*"[\s\S]*?<img\s+[^>]*(?:data-src|src)="([^"]+)"[\s\S]*?<a\s+[^>]*href="\/watch\/([^"?]+)"[^>]*title="([^"]+)"[^>]*data-id="([^"]+)"/gi;
        const results = [];
        let m;
        while ((m = cardRegex.exec(html)) !== null) {
          const rawPoster = m[1];
          const poster = rawPoster.startsWith('http') ? rawPoster : `${HIANIME_MAIN}${rawPoster.startsWith('/') ? '' : '/'}${rawPoster}`;
          const slug = m[2];
          const title = m[3];
          const animeId = m[4];
          results.push({
            id: `hianime:${slug}`,
            slug,
            nativeId: animeId,
            title: cleanDisplayTitle(title),
            coverUrl: poster,
            provider: 'hianime',
          });
          if (results.length >= limit) break;
        }

        return ok({
          ok: true,
          data: {
            results,
            page,
            limit,
            total: results.length,
            totalPages: 1,
          },
          source: 'upstream',
          provider: 'hianime',
        }, { cache: 'public, max-age=180, s-maxage=300' });
      } catch (err) {
        return errorResponse(err);
      }
    },
    { allowedParams: ['q', 'page', 'limit'], waitUntil },
  );
};
