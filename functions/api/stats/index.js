import { errorResponse, ok } from '../_lib.js';

/* Whole-catalogue counters for the Genres page and the Anime header: the client
   no longer holds every title, so "N results" has to come from here. */
export const onRequestGet = async ({ env }) => {
  try {
    const [titles, ongoing, genres] = await Promise.all([
      env.ANIHUB.prepare('SELECT count(*) AS n FROM anime').first(),
      env.ANIHUB.prepare("SELECT count(*) AS n FROM anime WHERE status = 'Ongoing'").first(),
      env.ANIHUB.prepare('SELECT genre_id AS id, count(*) AS n FROM anime_genre GROUP BY genre_id').all(),
    ]);
    return ok({
      titles: titles.n,
      ongoing: ongoing.n,
      genres: Object.fromEntries(genres.results.map((g) => [g.id, g.n])),
    });
  } catch (err) {
    return errorResponse(err);
  }
};
