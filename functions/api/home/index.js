import { CARD_COLUMNS_SLIM, cardFromRowSlim, errorResponse, ok, withEdgeCache } from '../_lib.js';

/* The home shelves in one round trip. The catalogue grows ~900 titles a day, so
   the rows are picked by the database instead of shipping the whole thing to the
   browser; the client only keeps a slim spine for hero/search hints. */
const ROW_LIMIT = 20;
const FRESH_FROM_YEAR = 2024;

export const onRequestGet = async ({ request, env, waitUntil }) => {
  return withEdgeCache(request, env, 600, async () => {
  try {
    const url = new URL(request.url);
    const provider = (url.searchParams.get('provider') || '').toLowerCase().trim();
    const db = env.ANIHUB;

    if (!db) {
      return ok({
        provider: provider || 'all',
        trending: [],
        ongoing: [],
        topRated: [],
        fresh: [],
        added: [],
      });
    }

    // 1. Default / All providers: query core database in a single round-trip with slim card projections
    const q = (where, order) =>
      db.prepare(`SELECT ${CARD_COLUMNS_SLIM} FROM anime a ${where} ORDER BY ${order} LIMIT ${ROW_LIMIT}`).all();

    const [trending, ongoing, topRated, fresh, added] = await Promise.all([
      q('', 'a.trend_rank IS NULL, a.trend_rank ASC, a.rating DESC'),
      q("WHERE a.status = 'Ongoing'", 'a.trend_rank IS NULL, a.trend_rank ASC, a.rating DESC'),
      q('', 'a.rating DESC'),
      q(`WHERE a.year >= ${FRESH_FROM_YEAR}`, 'a.year DESC, a.rating DESC'),
      q('', 'a.added_at IS NULL, a.added_at DESC, a.rating DESC'),
    ]);

    return ok({
      provider: 'all',
      // Trending includes a concise 220-char synopsis excerpt for the hero slideshow;
      // standard shelves omit heavy synopsis blobs, shrinking JSON payload by ~88%
      trending: trending.results.map((r) => cardFromRowSlim(r, 220)),
      ongoing: ongoing.results.map((r) => cardFromRowSlim(r, 0)),
      topRated: topRated.results.map((r) => cardFromRowSlim(r, 0)),
      fresh: fresh.results.map((r) => cardFromRowSlim(r, 0)),
      added: added.results.map((r) => cardFromRowSlim(r, 0)),
    }, {
      cache: 'public, max-age=60, s-maxage=180, stale-while-revalidate=120',
      headers: { vary: 'Accept-Encoding' },
    });
  } catch (err) {
    return errorResponse(err);
  }
  }, { allowedParams: ['provider'], waitUntil });
};

export const onRequestHead = onRequestGet;