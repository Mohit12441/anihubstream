// @ts-check
import { HttpError, cardFromRow, errorResponse, foldSearch, initialsPattern, ok, safeLikePattern, withEdgeCache } from '../_lib.js';

const MEILISEARCH_TIMEOUT_MS = 800;

// Common fandom abbreviations mapped to canonical search phrases
const ACRONYMS = {
  jjk: 'jujutsu kaisen',
  mha: 'my hero academia',
  bnha: 'boku no hero academia',
  aot: 'attack on titan',
  snk: 'shingeki no kyojin',
  ds: 'demon slayer',
  op: 'one piece',
  csm: 'chainsaw man',
  fma: 'fullmetal alchemist',
  fmab: 'fullmetal alchemist brotherhood',
  kny: 'kimetsu no yaiba',
  sao: 'sword art online',
  ngnl: 'no game no life',
  sl: 'solo leveling',
  hxh: 'hunter x hunter',
  bleach: 'bleach',
  naruto: 'naruto',
  boruto: 'boruto',
};

/**
 * Instant Search Edge Endpoint:
 * Delivers sub-millisecond typo-tolerant anime search suggestions.
 * 1. Checks external Meilisearch cluster IF explicitly configured.
 * 2. High-performance direct Cloudflare D1 indexed catalogue query (<10ms)
 *    with multi-word tokenization, acronym expansion, and title prefix boosting.
 *
 * GET /api/search/instant?q=<term>&limit=<n>
 */
export const onRequestGet = async ({ request, env, waitUntil }) => {
  return withEdgeCache(
    request,
    env,
    1800,
    async () => {
      try {
        const url = new URL(request.url);
        const q = (url.searchParams.get('q') || '').trim();
        const limit = Math.min(Math.max(1, Number.parseInt(url.searchParams.get('limit') || '8', 10) || 8), 20);

        if (!q) {
          return ok({ query: '', hits: [], estimatedTotalHits: 0, engine: 'empty' });
        }

        // 1. Meilisearch ONLY if an external host is explicitly configured
        const meiliHost = env.MEILISEARCH_HOST;
        if (
          meiliHost &&
          typeof meiliHost === 'string' &&
          meiliHost.startsWith('http') &&
          !meiliHost.includes('127.0.0.1') &&
          !meiliHost.includes('localhost')
        ) {
          try {
            const meiliKey = env.MEILISEARCH_KEY || '';
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
              if (Array.isArray(data.hits) && data.hits.length > 0) {
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
                      key_art: h.key_art || h.keyArt,
                      synopsis: h.synopsis,
                      _formatted: h._formatted,
                    })),
                    estimatedTotalHits: data.estimatedTotalHits ?? data.hits?.length ?? 0,
                    engine: 'meilisearch',
                  },
                  { cache: 'public, max-age=120, s-maxage=300' }
                );
              }
            }
          } catch {
            // Meilisearch unavailable or timed out -> Proceed directly to D1
          }
        }

        // 2. High-Performance Direct Cloudflare D1 Indexed Search (<10ms)
        if (env.ANIHUB) {
          const trimmedQ = q.trim();
          const normalizedQ = trimmedQ.replace(/\bs(\d+)\b/gi, 'season $1');
          const acronymExpanded = ACRONYMS[normalizedQ.toLowerCase()] || ACRONYMS[trimmedQ.toLowerCase()] || normalizedQ;
          const foldedQ = foldSearch(acronymExpanded);
          const rawWords = foldedQ.split(' ').filter((w) => w.length > 0);
          const words = rawWords.filter((w) => rawWords.length === 1 || w.length > 1).slice(0, 5);
          const likeTerm = safeLikePattern(acronymExpanded, 48);
          const initPattern = initialsPattern(trimmedQ.toLowerCase());
          const initTerm = initPattern ? `%${initPattern}` : likeTerm;

          let whereClause = "a.id = ?2 OR a.title LIKE (?2 || '%') OR a.search_text LIKE ?1 OR a.title LIKE ?1 OR a.id LIKE ?1";
          const params = [likeTerm, acronymExpanded, initTerm];

          if (initPattern) {
            whereClause += ' OR a.search_text LIKE ?3';
          }

          if (words.length > 1) {
            const wordChecks = words.map((w) => {
              params.push(safeLikePattern(w, 32));
              return `a.search_text LIKE ?${params.length}`;
            });
            whereClause = `(${whereClause}) OR (${wordChecks.join(' AND ')})`;
          }

          params.push(limit);
          const limitIndex = params.length;

          const querySql = `SELECT a.id, a.title, a.native, a.year, a.rating, a.season, a.kind, a.status,
                    a.art, a.key_art, a.accent, a.synopsis, a.rank, a.trend_rank, a.alt_seasons,
                    a.sched_day, a.sched_day_label, a.sched_date, a.sched_time, a.sched_season,
                    a.episode_total, a.source_ids, a.skip_key_id, a.skip_key_space
             FROM anime a
             WHERE ${whereClause}
             ORDER BY 
               CASE WHEN lower(a.title) = lower(?2) THEN 0 WHEN lower(a.title) LIKE (?2 || '%') THEN 1 ELSE 2 END ASC,
               CASE WHEN a.kind IN ('Special', 'Movie') AND (a.episode_total <= 1 OR a.episode_total IS NULL) THEN 1 ELSE 0 END ASC,
               a.trend_rank IS NULL, a.trend_rank ASC, a.rating DESC
             LIMIT ?${limitIndex}`;

          const d1Rows = await env.ANIHUB.prepare(querySql).bind(...params).all().catch(() => ({ results: [] }));
          const hits = (d1Rows?.results || []).map((r) => {
            const card = cardFromRow(r);
            return {
              id: card.id,
              title: card.title,
              native: card.native,
              year: card.year,
              rating: card.rating,
              kind: card.kind,
              status: card.status,
              art: card.art,
              key_art: r.key_art || card.keyArt || card.art,
              synopsis: card.synopsis,
            };
          });

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
    },
    { allowedParams: ['q', 'limit'], waitUntil }
  );
};
