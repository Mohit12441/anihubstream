// @ts-check
import { HttpError, errorResponse, ok } from './_lib.js';

const FAN_OUT_TIMEOUT_MS = 4_500;
const SEARCH_PROVIDERS = ['aniwatch', 'hianime', 'anikoto', 'animedubhindi', 'watchanimeworld'];

/**
 * Federated Search Edge Endpoint:
 * Fans out search queries across all integrated anime streaming providers concurrently,
 * returns grouped results per provider.
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

    const bridgeBase = env.STREAM_BRIDGE_URL || 'http://127.0.0.1:8795';

    // Parallel fan-out to providers with individual error boundaries
    const searches = SEARCH_PROVIDERS.map(async (provider) => {
      const searchUrl = new URL(`${bridgeBase}/search`);
      searchUrl.searchParams.set('q', q);
      searchUrl.searchParams.set('provider', provider);

      try {
        const res = await fetch(searchUrl.toString(), {
          headers: { accept: 'application/json' },
          signal: AbortSignal.timeout(FAN_OUT_TIMEOUT_MS),
        });
        if (!res.ok) return { provider, results: [] };
        const data = await res.json().catch(() => []);
        return {
          provider,
          results: Array.isArray(data)
            ? data.map((item) => ({
                id: item.id || item.slug,
                slug: item.slug || item.id,
                title: item.title,
                coverUrl: item.coverUrl || null,
                provider,
              }))
            : [],
        };
      } catch {
        return { provider, results: [] };
      }
    });

    const settled = await Promise.allSettled(searches);

    /** @type {Record<string, Array<{ id: string, slug: string, title: string, coverUrl: string | null, provider: string }>>} */
    const grouped = {};
    let totalCount = 0;

    for (const outcome of settled) {
      if (outcome.status === 'fulfilled') {
        const { provider, results } = outcome.value;
        grouped[provider] = results;
        totalCount += results.length;
      }
    }

    // Ensure all expected provider keys exist
    for (const prov of SEARCH_PROVIDERS) {
      if (!grouped[prov]) grouped[prov] = [];
    }

    return ok(
      {
        query: q,
        count: totalCount,
        providers: grouped,
      },
      {
        cache: 'public, max-age=300, s-maxage=600',
      }
    );
  } catch (err) {
    return errorResponse(err);
  }
};
