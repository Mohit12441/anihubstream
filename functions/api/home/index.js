import { CARD_COLUMNS, cardFromRow, errorResponse, ok, withEdgeCache } from '../_lib.js';

/* The home shelves in one round trip. The catalogue grows ~900 titles a day, so
   the rows are picked by the database instead of shipping the whole thing to the
   browser; the client only keeps a slim spine for hero/search hints. */
const ROW_LIMIT = 20;
const FRESH_FROM_YEAR = 2024;

export const onRequestGet = async ({ request, env, waitUntil }) => {
  return withEdgeCache(request, env, 1800, async () => {
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

    // 1. Default / All providers: query core database in a single round-trip
    const q = (where, order) =>
      db.prepare(`SELECT ${CARD_COLUMNS} FROM anime a ${where} ORDER BY ${order} LIMIT ${ROW_LIMIT}`).all();

    const [trending, ongoing, topRated, fresh, added] = await Promise.all([
      q('', 'a.trend_rank IS NULL, a.trend_rank ASC, a.rating DESC'),
      q("WHERE a.status = 'Ongoing'", 'a.trend_rank IS NULL, a.trend_rank ASC, a.rating DESC'),
      q('', 'a.rating DESC'),
      q(`WHERE a.year >= ${FRESH_FROM_YEAR}`, 'a.year DESC, a.rating DESC'),
      q('', 'a.added_at IS NULL, a.added_at DESC, a.rating DESC'),
    ]);

    return ok({
      provider: 'all',
      trending: trending.results.map(cardFromRow),
      ongoing: ongoing.results.map(cardFromRow),
      topRated: topRated.results.map(cardFromRow),
      fresh: fresh.results.map(cardFromRow),
      added: added.results.map(cardFromRow),
    }, {
      cache: 'public, max-age=120, s-maxage=600, stale-while-revalidate=120',
      headers: { vary: 'Accept-Encoding' },
    });
  } catch (err) {
    return errorResponse(err);
  }
  }, { allowedParams: ['provider'], waitUntil });
};