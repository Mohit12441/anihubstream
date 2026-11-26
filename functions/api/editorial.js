import { errorResponse, ok, withEdgeCache } from './_lib.js';

export const onRequestGet = async ({ request, env, waitUntil }) => {
  return withEdgeCache(request, env, 3600, async () => {
    try {
      let items = [];
      if (env.ASSETS && typeof env.ASSETS.fetch === 'function') {
        try {
          const res = await env.ASSETS.fetch(new URL('/editorial.json', request.url));
          if (res.ok) items = await res.json();
        } catch {}
      }
      if (!items || items.length === 0) {
        try {
          const res = await fetch(new URL('/editorial.json', new URL(request.url).origin));
          if (res.ok) items = await res.json();
        } catch {}
      }

      return ok(
        {
          results: items,
          total: items.length,
        },
        {
          cache: 'public, max-age=300, s-maxage=3600, stale-while-revalidate=600',
          headers: { vary: 'Accept-Encoding' },
        }
      );
    } catch (err) {
      return errorResponse(err);
    }
  }, { allowedParams: [], waitUntil });
};

export const onRequestHead = onRequestGet;
