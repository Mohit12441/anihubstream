import { errorResponse, ok, withEdgeCache } from '../_lib.js';

/* Whole-catalogue counters for the Genres page and the Anime header: the client
   no longer holds every title, so "N results" has to come from here. */
export const onRequestGet = async ({ request, env, waitUntil }) => {
  return withEdgeCache(
    request,
    env,
    600,
    async () => {
      try {
        const [titles, ongoing, genres] = await Promise.all([
          env.ANIHUB.prepare('SELECT count(*) AS n FROM anime').first(),
          env.ANIHUB.prepare("SELECT count(*) AS n FROM anime WHERE status = 'Ongoing'").first(),
          env.ANIHUB.prepare('SELECT genre_id AS id, count(*) AS n FROM anime_genre GROUP BY genre_id').all(),
        ]);
        return ok({
          titles: titles?.n ?? 0,
          ongoing: ongoing?.n ?? 0,
          genres: Object.fromEntries((genres?.results || []).map((g) => [g.id, g.n])),
        });
      } catch (err) {
        return errorResponse(err);
      }
    },
    { allowedParams: [], waitUntil },
  );
};
