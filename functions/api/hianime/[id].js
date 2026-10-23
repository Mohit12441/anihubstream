// @ts-check
import { HttpError, cleanDisplayTitle, errorResponse, ok } from '../_lib.js';

const HIANIME_MAIN = 'https://animehot.cc';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

/**
 * HiAnime Isolated Anime Details Edge Endpoint:
 * GET /api/hianime/:id
 */
export const onRequestGet = async ({ params, env }) => {
  try {
    const rawId = decodeURIComponent(params.id || '').trim();
    if (!rawId) {
      throw new HttpError(400, 'bad_request', 'anime id is required');
    }

    const slug = rawId.replace(/^hianime:/i, '').trim();

    // 1. Fetch anime details
    const res = await fetch(`${HIANIME_MAIN}/api/anime/${encodeURIComponent(slug).replace(/%3A/gi, ':')}`, {
      headers: {
        'User-Agent': USER_AGENT,
        Referer: `${HIANIME_MAIN}/`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(4000),
    });

    if (!res.ok) {
      throw new HttpError(res.status, 'not_found', `HiAnime details not found for "${slug}"`);
    }

    const data = await res.json();
    const anime = data?.anime;
    if (!anime || !anime.title) {
      throw new HttpError(404, 'not_found', `HiAnime returned empty anime payload for "${slug}"`);
    }

    const animeId = anime._id;
    const totalEpisodes = Number(anime.totalEpisodes) || Number(anime.totalSubbed) || 1;
    let episodes = [];

    // 2. Fetch full episode list if animeId exists
    if (animeId && totalEpisodes > 0) {
      try {
        const epRes = await fetch(`${HIANIME_MAIN}/api/episodes/${animeId}?start=1&end=${totalEpisodes}`, {
          headers: {
            'User-Agent': USER_AGENT,
            Referer: `${HIANIME_MAIN}/`,
            Accept: 'application/json',
          },
          signal: AbortSignal.timeout(4000),
        });

        if (epRes.ok) {
          const epData = await epRes.json();
          const epList = Array.isArray(epData?.episodes) ? epData.episodes : [];
          episodes = epList.map((ep, i) => {
            const num = Number(ep.episodeNumber) || i + 1;
            const subEmbeds = Array.isArray(ep.link?.sub) ? ep.link.sub : [];
            const dubEmbeds = Array.isArray(ep.link?.dub) ? ep.link.dub : [];
            const audioType = subEmbeds.length && dubEmbeds.length ? 'both' : dubEmbeds.length ? 'dub' : 'sub';

            return {
              id: `hianime:${slug}#${num}`,
              n: num,
              title: (ep.title || `Episode ${num}`).trim(),
              audioType,
              embedCounts: { sub: subEmbeds.length, dub: dubEmbeds.length },
              url: `${HIANIME_MAIN}/api/episodes/${animeId}?start=${num}&end=${num}`,
            };
          });
        }
      } catch {
        // Fallback to single episode if range fetch fails
      }
    }

    if (episodes.length === 0) {
      episodes = [{
        id: `hianime:${slug}#1`,
        n: 1,
        title: 'Episode 1',
        audioType: 'sub',
        embedCounts: { sub: 1, dub: 0 },
        url: `${HIANIME_MAIN}/api/episodes/${animeId || slug}?start=1&end=1`,
      }];
    }

    // Persist mapping to D1 asynchronously if available
    if (env.ANIHUB && anime.mal_id) {
      try {
        await env.ANIHUB.prepare(
          `INSERT OR REPLACE INTO anime_provider_mapping (anime_id, provider_id, provider_slug, confidence, updated_at)
           SELECT a.id, 'hianime', ?1, 1.0, datetime('now')
           FROM anime a
           LEFT JOIN anime_id_map m ON a.id = m.anime_id
           WHERE m.mal_id = ?2 OR a.skip_key_id = ?2
           LIMIT 1`
        ).bind(slug, anime.mal_id).run().catch(() => {});
      } catch (_) {}
    }

    const payload = {
      id: `hianime:${slug}`,
      slug,
      nativeId: animeId || null,
      title: cleanDisplayTitle(anime.title || ''),
      originalTitle: (anime.Japanese || anime.original_title || '').trim(),
      synopsis: (anime.description || anime.synopsis || '').trim(),
      art: anime.poster || anime.image || '',
      banner: anime.banner || anime.landscape || '',
      rating: Number(anime.Score || anime.score || 8.0),
      year: Number(anime.Aired?.match(/\b(19|20)\d{2}\b/)?.[0]) || null,
      type: anime.Type || 'TV',
      status: (anime.Status || 'Finished').toLowerCase().includes('finish') ? 'finished' : 'releasing',
      genres: Array.isArray(anime.genres) ? anime.genres : [],
      episodeCount: episodes.length,
      episodeTotal: totalEpisodes,
      malId: Number(anime.mal_id) || null,
      audio: {
        sub: Number(anime.totalSub ?? anime.totalSubbed ?? 0),
        dub: Number(anime.totalDub ?? anime.totalDubbed ?? 0),
      },
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
};
