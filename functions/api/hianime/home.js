// @ts-check
import { HttpError, errorResponse, ok } from '../_lib.js';

const HIANIME_MAIN = 'https://animehot.cc';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

function formatCard(item) {
  if (!item) return null;
  const a = item.anime ?? item;
  if (!a || !a.title) return null;
  const slug = a.slug || a._id;
  return {
    id: `hianime:${slug}`,
    slug: slug,
    title: (a.title || '').trim(),
    originalTitle: (a.original_title || a.japanese_title || '').trim(),
    art: a.poster || a.image || a.coverUrl || '',
    banner: a.banner || a.landscape || a.bannerUrl || '',
    rating: Number(a.score || a.averageScore || 8.0),
    episodeCount: Number(a.totalEpisodes || a.totalSubbed || 0),
    type: a.type || 'TV',
    status: a.status || 'finished',
    audio: {
      sub: Number(a.totalSubbed || (a.audio?.sub) || 0),
      dub: Number(a.totalDubbed || (a.audio?.dub) || 0),
    },
    provider: 'hianime',
  };
}

/**
 * HiAnime Isolated Home Edge Endpoint:
 * GET /api/hianime/home
 */
export const onRequestGet = async ({ env }) => {
  try {
    const res = await fetch(`${HIANIME_MAIN}/api/home`, {
      headers: {
        'User-Agent': USER_AGENT,
        Referer: `${HIANIME_MAIN}/`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(4500),
    });

    if (!res.ok) {
      throw new HttpError(res.status, 'upstream_error', `HiAnime home returned ${res.status}`);
    }

    const data = await res.json();
    const parseList = (arr) => (Array.isArray(arr) ? arr.map(formatCard).filter(Boolean) : []);

    const result = {
      spotlight: parseList(data.spotlight || data.featured),
      trending: parseList(data.trending?.animes || data.trending),
      popular: parseList(data.popular?.animes || data.popular),
      currentlyAiring: parseList(data.currentlyAiring?.animes || data.currentlyAiring),
      latestEpisodes: Array.isArray(data.latestEpisodes?.episodes)
        ? data.latestEpisodes.episodes.map((ep) => ({
            id: ep._id,
            episodeNumber: Number(ep.episodeNumber) || 1,
            title: (ep.title || `Episode ${ep.episodeNumber || 1}`).trim(),
            slug: ep.slug,
            media: formatCard(ep.anime_info),
          }))
        : [],
    };

    return ok({
      ok: true,
      data: result,
      source: 'upstream',
      provider: 'hianime',
    }, { cache: 'public, max-age=300, s-maxage=600' });
  } catch (err) {
    return errorResponse(err);
  }
};
