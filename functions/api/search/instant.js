// @ts-check
import { HttpError, cardFromRow, errorResponse, foldSearch, ok } from '../_lib.js';

const MEILISEARCH_TIMEOUT_MS = 2_000;

/**
 * Instant Search Endpoint:
 * Delivers sub-millisecond typo-tolerant anime search via Meilisearch,
 * with automatic zero-downtime fallback to D1 SQLite catalogue search.
 *
 * GET /api/search/instant?q=<term>&limit=<n>
 */
export const onRequestGet = async ({ request, env }) => {
  try {
    const url = new URL(request.url);
    const q = (url.searchParams.get('q') || '').trim();
    const limit = Math.min(Math.max(1, Number.parseInt(url.searchParams.get('limit') || '20', 10) || 20), 50);

    if (!q) {
      return ok({ query: '', hits: [], estimatedTotalHits: 0, engine: 'empty' });
    }

    const meiliHost = env.MEILISEARCH_HOST || 'http://127.0.0.1:7700';
    const meiliKey = env.MEILISEARCH_KEY || '';

    // 1. Attempt Meilisearch query
    try {
      const searchRes = await fetch(`${meiliHost}/indexes/anime/search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(meiliKey ? { Authorization: `Bearer ${meiliKey}` } : {}),
        },
        body: JSON.stringify({
          q,
          limit,
          attributesToHighlight: ['title'],
        }),
        signal: AbortSignal.timeout(MEILISEARCH_TIMEOUT_MS),
      });

      if (searchRes.ok) {
        const data = await searchRes.json();
        return ok(
          {
            query: q,
            hits: (data.hits || []).map((h) => ({
              id: h.id,
              title: h.title,
              native: h.native || h.nativeTitle,
              year: h.year,
              rating: h.rating,
              kind: h.kind,
              status: h.status,
              art: h.art,
              key_art: h.key_art,
              synopsis: h.synopsis,
              _formatted: h._formatted,
            })),
            estimatedTotalHits: data.estimatedTotalHits ?? data.hits?.length ?? 0,
            engine: 'meilisearch',
          },
          { cache: 'public, max-age=120, s-maxage=300' }
        );
      }
    } catch {
      // Meilisearch unavailable or timed out -> Proceed to D1 fallback
    }

    // 2. Fallback to D1 SQLite Catalogue
    if (env.ANIHUB) {
      let rows = null;
      let engineUsed = 'd1_fts5';

      try {
        // Build FTS5 MATCH query: tokenize terms, require all terms (AND) and allow prefix matching
        const ftsQuery = q.trim().split(/\s+/).map((term) => `"${term.replace(/"/g, '""')}"*`).join(' ');
        rows = await env.ANIHUB.prepare(
          `SELECT a.id, a.title, a.native, a.year, a.rating, a.season, a.kind, a.status, a.art, a.key_art, a.accent, a.synopsis
           FROM anime_fts f JOIN anime a ON a.rowid = f.rowid
           WHERE f.anime_fts MATCH ?1
           ORDER BY bm25(f) DESC, a.rating DESC, a.year DESC
           LIMIT ?2`
        )
          .bind(ftsQuery, limit)
          .all();
      } catch {
        // Fallback to indexed LIKE search if anime_fts virtual table is not yet provisioned in D1
        engineUsed = 'd1_fallback';
        const folded = foldSearch(q);
        const pattern = `%${folded}%`;
        rows = await env.ANIHUB.prepare(
          `SELECT a.id, a.title, a.native, a.year, a.rating, a.season, a.kind, a.status, a.art, a.key_art, a.accent, a.synopsis
           FROM anime a
           WHERE a.search_text LIKE ?1 OR a.title LIKE ?2
           ORDER BY a.rating DESC, a.year DESC
           LIMIT ?3`
        )
          .bind(pattern, `%${q}%`, limit)
          .all()
          .catch(() => ({ results: [] }));
      }

      const hits = (rows?.results || []).map((r) => cardFromRow(r));
      return ok(
        {
          query: q,
          hits,
          estimatedTotalHits: hits.length,
          engine: 'd1_fallback',
        },
        { cache: 'public, max-age=60, s-maxage=180' }
      );
    }

    return ok({ query: q, hits: [], estimatedTotalHits: 0, engine: 'none' });
  } catch (err) {
    return errorResponse(err);
  }
};
