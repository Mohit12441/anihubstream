import { CARD_COLUMNS, HttpError, cardFromRow, episodeFromRow, errorResponse, ok } from '../_lib.js';

export const onRequestGet = async ({ params, env }) => {
  try {
    const id = decodeURIComponent(params.id);
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) {
      throw new HttpError(400, 'bad_request', 'anime id may contain letters, digits, dash and underscore only');
    }

    const card = await env.ANIHUB.prepare(`SELECT ${CARD_COLUMNS} FROM anime a WHERE a.id = ?1`)
      .bind(id)
      .first();
    if (!card) throw new HttpError(404, 'not_found', `anime "${id}" not found`);

    const { results: episodeRows } = await env.ANIHUB.prepare(
      `SELECT id, n, title, runtime, runtime_seconds, thumb, synopsis, markers, airdate
         FROM episode WHERE anime_id = ?1 ORDER BY n`,
    )
      .bind(id)
      .all();

    const { results: related } = await env.ANIHUB.prepare(
      `SELECT a.id, a.title, a.native, a.year, a.rating, a.season, a.kind, a.status,
              a.art, a.key_art, a.accent, a.synopsis, a.rank, a.trend_rank, a.alt_seasons,
              a.sched_day, a.sched_day_label, a.sched_date, a.sched_time, a.sched_season,
              a.episode_total,
              (SELECT group_concat(genre_id) FROM anime_genre ag2 WHERE ag2.anime_id = a.id) AS genre_ids,
              (SELECT count(*) FROM episode e2 WHERE e2.anime_id = a.id) AS episode_count
         FROM anime_genre ag
         JOIN anime a ON a.id = ag.anime_id
        WHERE ag.genre_id IN (SELECT genre_id FROM anime_genre WHERE anime_id = ?1)
          AND a.id <> ?1
        GROUP BY a.id
        ORDER BY count(*) DESC, a.rating DESC
        LIMIT 6`,
    )
      .bind(id)
      .all();

    return ok({
      ...cardFromRow(card),
      episodes: episodeRows.map(episodeFromRow),
      related: related.map(cardFromRow),
    });
  } catch (err) {
    return errorResponse(err);
  }
};
