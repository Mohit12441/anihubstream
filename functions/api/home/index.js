import { CARD_COLUMNS, cardFromRow, cleanDisplayTitle, errorResponse, ok, withEdgeCache } from '../_lib.js';

/* The home shelves in one round trip. The catalogue grows ~900 titles a day, so
   the rows are picked by the database instead of shipping the whole thing to the
   browser; the client only keeps a slim spine for hero/search hints. */
const ROW_LIMIT = 20;
const FRESH_FROM_YEAR = 2024;

export const onRequestGet = async ({ request, env, waitUntil }) => {
  return withEdgeCache(request, env, 7200, async () => {
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
        providers: {},
      });
    }

    const mapSearchResult = (r, provName) => ({
      id: r.id,
      slug: r.id,
      title: cleanDisplayTitle(r.title),
      coverUrl: r.coverUrl || r.art || r.key_art || null,
      provider: provName,
    });

    const getProviderRows = (provId, orderClause) => {
      return db.prepare(
        `SELECT ${CARD_COLUMNS}
         FROM anime a
         JOIN anime_provider_mapping pm ON pm.anime_id = a.id AND pm.provider_id = ?1
         ORDER BY ${orderClause}
         LIMIT ${ROW_LIMIT}`
      ).bind(provId).all().catch(() => ({ results: [] }));
    };

    // 1. Specific Provider Feeds (Strictly from D1 indexed joins)
    if (provider && provider !== 'all' && provider !== 'providers') {
      const order = provider === 'anikoto'
        ? 'a.trend_rank IS NULL, a.trend_rank ASC, a.rating DESC'
        : 'a.rating DESC, a.year DESC';

      const rows = await getProviderRows(provider, order);
      const cards = (rows.results || []).map(cardFromRow);
      return ok({
        provider,
        featured: cards,
        trending: cards,
        popular: cards,
        ongoing: cards.filter((c) => c.status === 'Ongoing'),
        topRated: cards,
        fresh: cards,
        added: cards,
      }, { cache: 'public, max-age=300, s-maxage=600, stale-while-revalidate=120' });
    }

    // 2. Multi-Provider Aggregate Shelf (for Home Page "All Streams", strictly from D1)
    if (provider === 'providers') {
      const [anikotoRows, aniwatchRows, hianimeRows] = await Promise.all([
        getProviderRows('anikoto', 'a.trend_rank IS NULL, a.trend_rank ASC, a.rating DESC'),
        getProviderRows('aniwatch', 'a.rating DESC, a.year DESC'),
        getProviderRows('hianime', 'a.rating DESC, a.year DESC'),
      ]);

      return ok({
        providers: {
          anikoto: (anikotoRows.results || []).map((r) => mapSearchResult(r, 'anikoto')),
          hianime: (hianimeRows.results || []).map((r) => mapSearchResult(r, 'hianime')),
          aniwatch: (aniwatchRows.results || []).map((r) => mapSearchResult(r, 'aniwatch')),
        },
      }, { cache: 'public, max-age=300, s-maxage=600, stale-while-revalidate=120' });
    }

    // 3. Default / All providers: query core database and include provider shelves in a single round-trip
    const q = (where, order) =>
      db.prepare(`SELECT ${CARD_COLUMNS} FROM anime a ${where} ORDER BY ${order} LIMIT ${ROW_LIMIT}`).all();

    const [trending, ongoing, topRated, fresh, added, anikotoRows, aniwatchRows, hianimeRows] = await Promise.all([
      q('WHERE a.trend_rank IS NOT NULL', 'a.trend_rank ASC'),
      q("WHERE a.status = 'Ongoing'", 'a.trend_rank IS NULL, a.trend_rank ASC, a.rating DESC'),
      q('', 'a.rating DESC'),
      q(`WHERE a.year >= ${FRESH_FROM_YEAR}`, 'a.year DESC, a.rating DESC'),
      q('', 'a.added_at IS NULL, a.added_at DESC, a.rating DESC'),
      getProviderRows('anikoto', 'a.trend_rank IS NULL, a.trend_rank ASC, a.rating DESC'),
      getProviderRows('aniwatch', 'a.rating DESC, a.year DESC'),
      getProviderRows('hianime', 'a.rating DESC, a.year DESC'),
    ]);

    return ok({
      provider: 'all',
      trending: trending.results.map(cardFromRow),
      ongoing: ongoing.results.map(cardFromRow),
      topRated: topRated.results.map(cardFromRow),
      fresh: fresh.results.map(cardFromRow),
      added: added.results.map(cardFromRow),
      providers: {
        anikoto: (anikotoRows.results || []).map((r) => mapSearchResult(r, 'anikoto')),
        hianime: (hianimeRows.results || []).map((r) => mapSearchResult(r, 'hianime')),
        aniwatch: (aniwatchRows.results || []).map((r) => mapSearchResult(r, 'aniwatch')),
      },
    }, {
      cache: 'public, max-age=120, s-maxage=600, stale-while-revalidate=120',
      headers: { vary: 'Accept-Encoding' },
    });
  } catch (err) {
    return errorResponse(err);
  }
  }, { allowedParams: ['provider'], waitUntil });
};