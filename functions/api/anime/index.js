import {
  CARD_COLUMNS,
  HttpError,
  cardFromRow,
  errorResponse,
  foldSearch,
  initialsPattern,
  intParam,
  ok,
  scoreSearchRow,
  strParam,
} from '../_lib.js';

const SORTS = {
  rating: 'a.rating DESC, a.title ASC',
  title: 'a.title COLLATE NOCASE ASC',
  year: 'a.year DESC, a.rating DESC',
  rank: 'a.rank IS NULL, a.rank ASC, a.rating DESC',
  trend: 'a.trend_rank IS NULL, a.trend_rank ASC, a.rating DESC',
  added: 'a.added_at IS NULL, a.added_at DESC, a.rating DESC',
  status: 'a.status COLLATE NOCASE ASC, a.rating DESC',
};

const STATUSES = ['Ongoing', 'Finished', 'Upcoming'];
const KINDS = ['TV', 'Movie', 'OVA', 'ONA', 'Special'];

/* A ranked search prefers the strongest rows, so the candidate scan takes the
   highest-rated SEARCH_SCAN_MAX prefilter hits before scoring in the Worker.
   Raised from 500 because the backlog importer adds ~18 titles every 30 min: at 500 the
   rating-ordered prefilter could drop a low-rated but exact-title match as the catalogue
   passed it. This is a bound, not a solution — when the scan still fills, `capped` is
   returned and the client says so rather than presenting a partial list as the whole one. */
const SEARCH_SCAN_MAX = 2000;

export const onRequestGet = async ({ request, env }) => {
  try {
    const url = new URL(request.url);
    const q = strParam(url, 'q', 120);
    const genre = strParam(url, 'genre');
    const season = strParam(url, 'season');
    const status = strParam(url, 'status');
    if (status !== null && !STATUSES.includes(status)) {
      throw new HttpError(400, 'bad_request', `status must be one of ${STATUSES.join(', ')}`);
    }
    const kind = strParam(url, 'kind');
    if (kind !== null && !KINDS.includes(kind)) {
      throw new HttpError(400, 'bad_request', `kind must be one of ${KINDS.join(', ')}`);
    }

    const sortKey = url.searchParams.get('sort') || (q ? 'relevance' : 'rating');
    if (sortKey !== 'relevance' && !SORTS[sortKey]) {
      throw new HttpError(400, 'bad_request', `unknown sort "${sortKey}"`);
    }

    const limit = intParam(url, 'limit', 1, 100, 24);
    const page = intParam(url, 'page', 1, 10_000, 1);

    const where = [];
    const bindings = [];
    const add = (template, ...values) => {
      let sql = template;
      for (const v of values) {
        bindings.push(v);
        sql = sql.replace('@', `?${bindings.length}`);
      }
      where.push(sql);
    };

    if (genre)
      add('EXISTS (SELECT 1 FROM anime_genre ag WHERE ag.anime_id = a.id AND ag.genre_id = @)', genre);
    if (season) add('a.sched_season = @', season);
    if (status) add('a.status = @', status);
    if (kind) add('a.kind = @', kind);

    const tokens = q ? foldSearch(q).split(' ').filter(Boolean) : [];
    if (sortKey === 'relevance') {
      if (!q) throw new HttpError(400, 'bad_request', 'relevance sort needs a search query (q)');
      /* A query that folds away ("!!!") is answered with zero results, not an error. */
      if (!tokens.length) return ok({ page, limit, total: 0, count: 0, results: [] });

      const { results: genreRows } = await env.ANIHUB.prepare('SELECT id, label FROM genre').all();
      const genreLabels = new Map(genreRows.map((g) => [g.id, g.label]));

      /* Per token: a LIKE prefilter that is a superset of the ranked matcher's
         matches — plain substring, the word-initials shorthand, and the same
         two checks over genre labels. Scoring then decides the real order. */
      for (const t of tokens) {
        const like = `%${t}%`;
        const init = initialsPattern(t);
        if (init) {
          add(
            `(a.search_text LIKE @ OR a.search_text LIKE @ OR EXISTS (SELECT 1 FROM anime_genre ag JOIN genre g ON g.id = ag.genre_id WHERE ag.anime_id = a.id AND (lower(g.label) LIKE @ OR lower(g.label) LIKE @)))`,
            like, init, like, init,
          );
        } else {
          add(
            `(a.search_text LIKE @ OR EXISTS (SELECT 1 FROM anime_genre ag JOIN genre g ON g.id = ag.genre_id WHERE ag.anime_id = a.id AND lower(g.label) LIKE @))`,
            like, like,
          );
        }
      }

      const filter = `WHERE ${where.join(' AND ')}`;
      const { results } = await env.ANIHUB.prepare(
        `SELECT ${CARD_COLUMNS} FROM anime a ${filter} ORDER BY a.rating DESC LIMIT ${SEARCH_SCAN_MAX}`,
      )
        .bind(...bindings)
        .all();

      const folded = tokens.join(' ');
      const scored = results
        .map((r) => ({ r, s: scoreSearchRow(r, folded, tokens, genreLabels) }))
        .filter((x) => x.s > 0)
        .sort((x, y) => y.s - x.s || y.r.rating - x.r.rating || ((x.r.rank ?? 99) - (y.r.rank ?? 99)));

      const slice = scored.slice((page - 1) * limit, (page - 1) * limit + limit);
      return ok({
        page,
        limit,
        total: scored.length,
        count: slice.length,
        scanned: results.length,
        capped: results.length >= SEARCH_SCAN_MAX,
        results: slice.map((x) => cardFromRow(x.r)),
      });
    }

    const order = SORTS[sortKey];
    const filter = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const limitIndex = bindings.length + 1;
    bindings.push(limit, (page - 1) * limit);

    const { results } = await env.ANIHUB.prepare(
      `SELECT ${CARD_COLUMNS} FROM anime a ${filter}
        ORDER BY ${order} LIMIT ?${limitIndex} OFFSET ?${limitIndex + 1}`,
    )
      .bind(...bindings)
      .all();

    const total = await env.ANIHUB.prepare(`SELECT count(*) AS n FROM anime a ${filter}`)
      .bind(...bindings.slice(0, limitIndex - 1))
      .first();

    return ok({ page, limit, total: total.n, count: results.length, results: results.map(cardFromRow) });
  } catch (err) {
    return errorResponse(err);
  }
};
