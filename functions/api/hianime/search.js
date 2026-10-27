// @ts-check
import { HttpError, cleanDisplayTitle, errorResponse, ok } from '../_lib.js';

const HIANIME_MAIN = 'https://animehot.cc';
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
export const onRequestGet = async ({ request, env }) => {
  try {
    const url = new URL(request.url);
    const q = (url.searchParams.get('q') || '').trim();
    const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit')) || 24));

    if (!q) {
      throw new HttpError(400, 'bad_request', 'q query parameter is required');
    }

    const cleanQ = normalizeSearch(q);

    // Call upstream HiAnime /api/filter
    const res = await fetch(`${HIANIME_MAIN}/api/filter`, {
      method: 'POST',
      headers: {
        'User-Agent': USER_AGENT,
        Referer: `${HIANIME_MAIN}/`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ page, limit, keyword: cleanQ }),
      signal: AbortSignal.timeout(4500),
    });

    if (!res.ok) {
      throw new HttpError(res.status, 'upstream_error', `HiAnime search failed: HTTP ${res.status}`);
    }

    const data = await res.json();
    const rawList = Array.isArray(data?.results) ? data.results : [];

    const results = rawList.map((item) => {
      const slug = item.slug || item._id;
      return {
        id: `hianime:${slug}`,
        slug: slug,
        nativeId: item._id || null,
        title: cleanDisplayTitle(item.title || ''),
        originalTitle: (item.Japanese || item.original_title || '').trim(),
        coverUrl: item.poster || item.image || item.coverUrl || '',
        bannerUrl: item.banner || item.landscape || '',
        year: Number(item.Aired?.match(/\b(19|20)\d{2}\b/)?.[0]) || null,
        rating: Number(item.Score || item.averageScore || 8.0),
        type: item.Type || 'TV',
        status: (item.Status || 'Finished').toLowerCase().includes('finish') ? 'finished' : 'releasing',
        genres: Array.isArray(item.genres) ? item.genres : [],
        episodeCount: Number(item.totalEpisodes || item.totalSubbed || 0),
        malId: Number(item.mal_id) || null,
        audio: {
          sub: Number(item.totalSub ?? item.totalSubbed ?? 0),
          dub: Number(item.totalDub ?? item.totalDubbed ?? 0),
        },
        provider: 'hianime',
      };
    });

    return ok({
      ok: true,
      data: {
        results,
        page,
        limit,
        total: Number(data?.total) || results.length,
        totalPages: Number(data?.totalPages) || 1,
      },
      source: 'upstream',
      provider: 'hianime',
    }, { cache: 'public, max-age=180, s-maxage=300' });
  } catch (err) {
    return errorResponse(err);
  }
};
