// @ts-check
import { HttpError, cleanDisplayTitle, errorResponse, ok, withEdgeCache } from '../_lib.js';
import { parseHiAnimeEpisodeList } from './_hianime_v2.js';

const HIANIME_MAIN = 'https://hianimex.com.in';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

/**
 * HiAnime Isolated Anime Details Edge Endpoint:
 * GET /api/hianime/:id
 */
export const onRequestGet = async ({ request, params, env, waitUntil }) => {
  return withEdgeCache(
    request,
    env,
    86400,
    async () => {
      try {
        const rawId = decodeURIComponent(params.id || '').trim();
        if (!rawId) {
          throw new HttpError(400, 'bad_request', 'anime id is required');
        }

        const slug = rawId.replace(/^hianime:/i, '').trim();
        let numericId = '';
        let animeTitle = slug.replace(/[-_]+/g, ' ');

        const suffixMatch = /-([0-9]+)$/.exec(slug);
        if (suffixMatch) {
          numericId = suffixMatch[1];
        } else if (/^[0-9]+$/.test(slug)) {
          numericId = slug;
        } else {
          try {
            const searchRes = await fetch(`${HIANIME_MAIN}/search?keyword=${encodeURIComponent(slug.replace(/[-_]+/g, ' '))}`, {
              headers: { 'User-Agent': USER_AGENT, Referer: `${HIANIME_MAIN}/` },
              signal: AbortSignal.timeout(4000),
            });
            if (searchRes.ok) {
              const searchHtml = await searchRes.text();
              const m = /<a\s+[^>]*href="\/watch\/([^"?]+)"[^>]*title="([^"]+)"[^>]*data-id="([^"]+)"/i.exec(searchHtml);
              if (m) {
                numericId = m[3];
                animeTitle = m[2];
              }
            }
          } catch (_) {}
        }

        let episodes = [];
        if (numericId) {
          try {
            const epListRes = await fetch(`${HIANIME_MAIN}/ajax/v2/episode/list/${numericId}`, {
              headers: { 'User-Agent': USER_AGENT, Referer: `${HIANIME_MAIN}/`, 'X-Requested-With': 'XMLHttpRequest' },
              signal: AbortSignal.timeout(4000),
            });
            if (epListRes.ok) {
              const epData = await epListRes.json();
              const parsed = parseHiAnimeEpisodeList(epData?.html || '');
              episodes = parsed.map((e) => ({
                id: `hianime:${slug}#${e.number}`,
                n: e.number,
                title: e.title || `Episode ${e.number}`,
                audioType: 'both',
                embedCounts: { sub: 1, dub: 1 },
                url: `${HIANIME_MAIN}/ajax/v2/episode/servers?episodeId=${e.id}`,
              }));
            }
          } catch (_) {}
        }

        if (episodes.length === 0) {
          episodes = [{
            id: `hianime:${slug}#1`,
            n: 1,
            title: 'Episode 1',
            audioType: 'both',
            embedCounts: { sub: 1, dub: 1 },
            url: `${HIANIME_MAIN}/`,
          }];
        }

        const payload = {
          id: `hianime:${slug}`,
          slug,
          nativeId: numericId || null,
          title: cleanDisplayTitle(animeTitle),
          originalTitle: '',
          synopsis: '',
          art: '',
          banner: '',
          rating: 8.0,
          year: null,
          type: 'TV',
          status: 'releasing',
          genres: [],
          episodeCount: episodes.length,
          episodeTotal: episodes.length,
          malId: null,
          audio: { sub: episodes.length, dub: episodes.length },
          episodes,
          provider: 'hianime',
        };

        return ok({
          ok: true,
          data: payload,
          source: 'upstream',
          provider: 'hianime',
        }, { cache: 'public, max-age=300, s-maxage=600' });
      } catch (err) {
        return errorResponse(err);
      }
    },
    { allowedParams: [], waitUntil },
  );
};
