import { CARD_COLUMNS, cardFromRow, errorResponse, ok } from '../_lib.js';

/* The home shelves in one round trip. The catalogue grows ~900 titles a day, so
   the rows are picked by the database instead of shipping the whole thing to the
   browser; the client only keeps a slim spine for hero/search hints. */
const ROW_LIMIT = 20;
const FRESH_FROM_YEAR = 2024;

/**
 * Fetches real-time catalog from HiAnime's direct API endpoint
 */
async function fetchHiAnimeFeed() {
  try {
    const res = await fetch('https://animehot.cc/api/filter', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        referer: 'https://animehot.cc/',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      },
      body: JSON.stringify({ page: 1, limit: ROW_LIMIT, sort: 'top-airing' }),
      signal: AbortSignal.timeout(3500),
    });

    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.results) && data.results.length > 0) {
        return data.results.map((m) => ({
          id: m.slug || m._id,
          slug: m.slug || m._id,
          title: m.title,
          native: m.Japanese || m.alternateTitle || null,
          year: m.Aired ? Number.parseInt(m.Aired.slice(0, 4), 10) || null : null,
          rating: m.Score && !isNaN(Number(m.Score)) ? Math.round(Number(m.Score) * 10) : null,
          season: m.Premiered || (m.Aired ? `Year ${m.Aired.slice(0, 4)}` : 'Anime'),
          kind: (m.Type || 'TV').toUpperCase(),
          status: m.Status?.includes('Finished') ? 'Finished' : 'Ongoing',
          genres: Array.isArray(m.genres) ? m.genres : [],
          art: m.image || m.originalImage || null,
          keyArt: m.landScapeImage || m.originalLandScapeImage || m.image || null,
          coverUrl: m.image || m.originalImage || null,
          synopsis: m.synopsis || null,
          episodeCount: Number(m.totalEpisodes) || Number(m.totalSubbed) || 1,
          malId: m.mal_id || null,
          provider: 'hianime',
        }));
      }
    }
  } catch {
    // Fall back to D1 queries
  }
  return null;
}

export const onRequestGet = async ({ request, env }) => {
  try {
    const url = new URL(request.url);
    const provider = (url.searchParams.get('provider') || '').toLowerCase().trim();
    const db = env.ANIHUB;

    // 1. HiAnime Live Feed
    if (provider === 'hianime') {
      const liveFeed = await fetchHiAnimeFeed();
      if (liveFeed && liveFeed.length > 0) {
        return ok({
          provider: 'hianime',
          featured: liveFeed,
          trending: liveFeed,
          popular: liveFeed,
          ongoing: liveFeed.filter((i) => i.status === 'Ongoing'),
          topRated: liveFeed,
          fresh: liveFeed,
          added: liveFeed,
        }, { cache: 'public, max-age=180, s-maxage=360' });
      }

      // D1 fallback for HiAnime
      if (db) {
        const rows = await db.prepare(
          `SELECT DISTINCT a.id, a.title, a.native, a.year, a.rating, a.season, a.kind, a.status, a.art, a.key_art, a.accent, a.synopsis
           FROM anime a
           JOIN anime_id_map m ON m.anime_id = a.id
           WHERE m.hianime_slug IS NOT NULL OR a.source_ids LIKE '%hianime%'
           ORDER BY a.rating DESC, a.year DESC
           LIMIT ${ROW_LIMIT}`
        ).all().catch(() => ({ results: [] }));

        const cards = (rows.results || []).map(cardFromRow);
        return ok({
          provider: 'hianime',
          featured: cards,
          trending: cards,
          popular: cards,
          ongoing: cards.filter((c) => c.status === 'Ongoing'),
          topRated: cards,
          fresh: cards,
          added: cards,
        }, { cache: 'public, max-age=120, s-maxage=300' });
      }
    }

    // 2. AniKoto Catalog Feed (High-res 1080p HLS catalog)
    if (provider === 'anikoto') {
      if (db) {
        const rows = await db.prepare(
          `SELECT DISTINCT a.id, a.title, a.native, a.year, a.rating, a.season, a.kind, a.status, a.art, a.key_art, a.accent, a.synopsis
           FROM anime a
           JOIN anime_id_map m ON m.anime_id = a.id
           WHERE m.anikoto_slug IS NOT NULL OR a.source_ids LIKE '%anikoto%'
           ORDER BY a.trend_rank IS NULL, a.trend_rank ASC, a.rating DESC
           LIMIT ${ROW_LIMIT}`
        ).all().catch(() => ({ results: [] }));

        const cards = (rows.results || []).map(cardFromRow);
        return ok({
          provider: 'anikoto',
          featured: cards,
          trending: cards,
          popular: cards,
          ongoing: cards.filter((c) => c.status === 'Ongoing'),
          topRated: cards,
          fresh: cards,
          added: cards,
        }, { cache: 'public, max-age=120, s-maxage=300' });
      }
    }

    // 3. Multi-Provider Aggregate Shelf (for Home Page "All Streams")
    if (provider === 'providers') {
      const [hianimeFeed, anikotoRows, hindiRows, aniwatchRows] = await Promise.all([
        fetchHiAnimeFeed(),
        db ? db.prepare(
          `SELECT DISTINCT a.id, a.title, a.art, a.key_art
           FROM anime a
           JOIN anime_id_map m ON m.anime_id = a.id
           WHERE m.anikoto_slug IS NOT NULL OR a.source_ids LIKE '%anikoto%'
           ORDER BY a.trend_rank IS NULL, a.trend_rank ASC, a.rating DESC
           LIMIT ${ROW_LIMIT}`
        ).all().catch(() => ({ results: [] })) : Promise.resolve({ results: [] }),
        db ? db.prepare(
          `SELECT DISTINCT a.id, a.title, a.art, a.key_art
           FROM anime a
           WHERE a.source_ids LIKE '%animedubhindi%' OR a.source_ids LIKE '%hindi%'
           ORDER BY a.added_at DESC, a.rating DESC
           LIMIT ${ROW_LIMIT}`
        ).all().catch(() => ({ results: [] })) : Promise.resolve({ results: [] }),
        db ? db.prepare(
          `SELECT DISTINCT a.id, a.title, a.art, a.key_art
           FROM anime a
           JOIN anime_id_map m ON m.anime_id = a.id
           WHERE m.aniwatch_slug IS NOT NULL OR a.source_ids LIKE '%aniwatch%'
           ORDER BY a.rating DESC, a.year DESC
           LIMIT ${ROW_LIMIT}`
        ).all().catch(() => ({ results: [] })) : Promise.resolve({ results: [] }),
      ]);

      const mapSearchResult = (r, provName) => ({
        id: r.id,
        slug: r.id,
        title: r.title,
        coverUrl: r.coverUrl || r.art || r.key_art || null,
        provider: provName,
      });

      return ok({
        providers: {
          anikoto: (anikotoRows.results || []).map((r) => mapSearchResult(r, 'anikoto')),
          hianime: hianimeFeed && hianimeFeed.length > 0
            ? hianimeFeed.map((r) => mapSearchResult(r, 'hianime'))
            : (anikotoRows.results || []).slice(0, 10).map((r) => mapSearchResult(r, 'hianime')),
          aniwatch: (aniwatchRows.results || []).map((r) => mapSearchResult(r, 'aniwatch')),
          animedubhindi: (hindiRows.results || []).map((r) => mapSearchResult(r, 'animedubhindi')),
        },
      }, { cache: 'public, max-age=120, s-maxage=300' });
    }

    // 4. AnimeDubHindi Catalog
    if (provider === 'animedubhindi') {
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

    // 5. Default / All providers: query core database
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
