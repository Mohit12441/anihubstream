import { errorResponse, ok, withEdgeCache } from './_lib.js';

export const onRequestGet = async ({ request, env, waitUntil }) => {
  return withEdgeCache(request, env, 3600, async () => {
    try {
      const url = new URL(request.url);
      const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '20', 10), 1), 50);
      const category = url.searchParams.get('category');

      // Attempt to load from static edge asset via env.ASSETS or static URL
      let items = [];
      if (env.ASSETS && typeof env.ASSETS.fetch === 'function') {
        try {
          const res = await env.ASSETS.fetch(new URL('/news-feed.json', request.url));
          if (res.ok) items = await res.json();
        } catch {}
      }
      if (!items || items.length === 0) {
        try {
          const res = await fetch(new URL('/news-feed.json', url.origin));
          if (res.ok) items = await res.json();
        } catch {}
      }

      if (Array.isArray(items) && items.length > 0) {
        if (category && category !== 'All') {
          items = items.filter((item) => item.category === category);
        }
        return ok(
          {
            results: items.slice(0, limit),
            total: items.length,
          },
          {
            cache: 'public, max-age=300, s-maxage=3600, stale-while-revalidate=600',
            headers: { vary: 'Accept-Encoding' },
          }
        );
      }

      return ok(
        { results: [], total: 0 },
        { cache: 'public, max-age=60, s-maxage=300' }
      );
    } catch (err) {
      return errorResponse(err);
    }
  }, { allowedParams: ['limit', 'category'], waitUntil });
};

export const onRequestHead = onRequestGet;
