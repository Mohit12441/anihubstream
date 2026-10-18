import { errorResponse, ok } from './_lib.js';

export const onRequestGet = async ({ env }) => {
  try {
    const { results } = await env.ANIHUB.prepare(
      `SELECT g.id, g.label, g.tagline, g.art, g.accent,
              (SELECT count(*) FROM anime_genre ag WHERE ag.genre_id = g.id) AS anime_count
         FROM genre g ORDER BY g.position`,
    ).all();
    return ok({
      results: results.map((g) => ({
        id: g.id,
        label: g.label,
        tagline: g.tagline,
        art: g.art,
        accent: g.accent,
        animeCount: g.anime_count,
      })),
    }, { cache: 'public, max-age=120, s-maxage=900, stale-while-revalidate=60', headers: { vary: 'Accept-Encoding' } });
  } catch (err) {
    return errorResponse(err);
  }
};
