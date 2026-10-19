import { CARD_COLUMNS, cardFromRow, errorResponse, ok } from '../_lib.js';

/* The home shelves in one round trip. The catalogue grows ~900 titles a day, so
   the rows are picked by the database instead of shipping the whole thing to the
   browser; the client only keeps a slim spine for hero/search hints. */
const ROW_LIMIT = 20;
const FRESH_FROM_YEAR = 2024;

export const onRequestGet = async ({ request, env }) => {
  try {
    const url = new URL(request.url);
    const provider = (url.searchParams.get('provider') || '').toLowerCase().trim();
    const bridgeBase = env.STREAM_BRIDGE_URL || 'https://bridge.anihubstream.com';

    // HiAnime Live Catalog Feed
    if (provider === 'hianime') {
      try {
        const bridgeRes = await fetch(`${bridgeBase}/home?provider=hianime`, {
          headers: { accept: 'application/json' },
          signal: AbortSignal.timeout(6000),
        });
        if (bridgeRes.ok) {
          const feed = await bridgeRes.json();
          const mapHiAnime = (m) => ({
            id: m.slug || m.id,
            title: m.title,
            native: m.originalTitle || null,
            year: m.year || null,
            rating: m.averageScore ? Math.round(m.averageScore * 10) : null,
            season: m.year ? `Year ${m.year}` : 'Anime',
            kind: (m.kind || 'TV').toUpperCase(),
            status: m.status === 'releasing' ? 'Ongoing' : 'Finished',
            genres: m.genres || [],
            art: m.coverUrl || m.bannerUrl || null,
            keyArt: m.bannerUrl || m.coverUrl || null,
            synopsis: m.description || null,
            episodeCount: m.episodeCount || (m.audio?.sub || 1),
            malId: m.malId || null,
            provider: 'hianime',
          });

          return ok({
            provider: 'hianime',
            featured: (feed.featured || []).map(mapHiAnime),
            trending: (feed.trending || []).map(mapHiAnime),
            popular: (feed.popular || []).map(mapHiAnime),
            ongoing: (feed.currentlyAiring || []).map(mapHiAnime),
            topRated: (feed.popular || []).map(mapHiAnime),
            fresh: (feed.latestAnime || []).map(mapHiAnime),
            added: (feed.latestAnime || []).map(mapHiAnime),
          }, { cache: 'public, max-age=120, s-maxage=300', headers: { vary: 'Accept-Encoding' } });
        }
      } catch {
        // Fall back to database query below
      }
    }

    // Aggregated multi-provider live feeds
    if (provider === 'providers') {
      try {
        const bridgeRes = await fetch(`${bridgeBase}/home?provider=all`, {
          headers: { accept: 'application/json' },
          signal: AbortSignal.timeout(6000),
        });
        if (bridgeRes.ok) {
          const feed = await bridgeRes.json();
          if (feed.providers) {
            return ok({ providers: feed.providers }, { cache: 'public, max-age=120, s-maxage=300' });
          }
        }
      } catch {}
    }

    // AnimeDubHindi Catalog
    if (provider === 'animedubhindi') {
      const db = env.ANIHUB;
      const q = (where, order) =>
        db.prepare(`SELECT ${CARD_COLUMNS} FROM anime a ${where} ORDER BY ${order} LIMIT ${ROW_LIMIT}`).all();
      const hindiWhere = "(a.source_ids LIKE '%animedubhindi%' OR a.source_ids LIKE '%hindi%')";
      const [trending, ongoing, topRated, fresh] = await Promise.all([
        q(`WHERE ${hindiWhere}`, 'a.trend_rank IS NULL, a.trend_rank ASC, a.rating DESC'),
        q(`WHERE ${hindiWhere} AND a.status = 'Ongoing'`, 'a.rating DESC'),
        q(`WHERE ${hindiWhere}`, 'a.rating DESC'),
        q(`WHERE ${hindiWhere}`, 'a.added_at DESC, a.rating DESC'),
      ]);
      return ok({
        provider: 'animedubhindi',
        trending: trending.results.map(cardFromRow),
        ongoing: ongoing.results.map(cardFromRow),
        topRated: topRated.results.map(cardFromRow),
        fresh: fresh.results.map(cardFromRow),
        added: fresh.results.map(cardFromRow),
      }, { cache: 'public, max-age=60, s-maxage=300', headers: { vary: 'Accept-Encoding' } });
    }

    // Default / All providers: query core database
    const db = env.ANIHUB;
    const q = (where, order) =>
      db.prepare(`SELECT ${CARD_COLUMNS} FROM anime a ${where} ORDER BY ${order} LIMIT ${ROW_LIMIT}`).all();
    const [trending, ongoing, topRated, fresh, added] = await Promise.all([
      q('WHERE a.trend_rank IS NOT NULL', 'a.trend_rank ASC'),
      q("WHERE a.status = 'Ongoing'", 'a.trend_rank IS NULL, a.trend_rank ASC, a.rating DESC'),
      q('', 'a.rating DESC'),
      q(`WHERE a.year >= ${FRESH_FROM_YEAR}`, 'a.year DESC, a.rating DESC'),
      q('', 'a.added_at IS NULL, a.added_at DESC, a.rating DESC'),
    ]);
    return ok({
      provider: provider || 'all',
      trending: trending.results.map(cardFromRow),
      ongoing: ongoing.results.map(cardFromRow),
      topRated: topRated.results.map(cardFromRow),
      fresh: fresh.results.map(cardFromRow),
      added: added.results.map(cardFromRow),
    }, { cache: 'public, max-age=60, s-maxage=300, stale-while-revalidate=60', headers: { vary: 'Accept-Encoding' } });
  } catch (err) {
    return errorResponse(err);
  }
};
