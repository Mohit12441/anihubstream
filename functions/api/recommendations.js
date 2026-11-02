import { CARD_COLUMNS, HttpError, cardFromRow, errorResponse, ok, withEdgeCache } from './_lib.js';

export const onRequestGet = async ({ request, env, waitUntil }) => {
  return withEdgeCache(
    request,
    env,
    86400,
    async () => {
      try {
        const url = new URL(request.url);
        const animeId = url.searchParams.get('id');
        const limitParam = Number(url.searchParams.get('limit')) || 10;
        const limit = Math.max(1, Math.min(limitParam, 30));

        if (animeId) {
          // 1. Fetch target anime
          const target = await env.ANIHUB.prepare(
            `SELECT ${CARD_COLUMNS} FROM anime a WHERE a.id = ?1 LIMIT 1`
          )
            .bind(animeId)
            .first();

          if (!target) {
            throw new HttpError(404, 'not_found', 'anime title not found');
          }

          // 2. Fetch related candidates sharing genres with target
          const { results: candidateRows } = await env.ANIHUB.prepare(
            `SELECT a.id, a.title, a.native, a.year, a.rating, a.season, a.kind, a.status,
                    a.art, a.key_art, a.accent, a.synopsis, a.rank, a.trend_rank, a.alt_seasons,
                    a.sched_day, a.sched_day_label, a.sched_date, a.sched_time, a.sched_season,
                    a.episode_total, a.source_ids, a.skip_key_id, a.skip_key_space,
                    (SELECT group_concat(genre_id) FROM anime_genre ag2 WHERE ag2.anime_id = a.id) AS genre_ids,
                    (SELECT count(*) FROM episode e2 WHERE e2.anime_id = a.id) AS episode_count,
                    count(ag.genre_id) as shared_genres_count
               FROM anime_genre ag
               JOIN anime a ON a.id = ag.anime_id
              WHERE ag.genre_id IN (SELECT genre_id FROM anime_genre WHERE anime_id = ?1)
                AND a.id <> ?1
              GROUP BY a.id
              ORDER BY shared_genres_count DESC, a.rating DESC
              LIMIT ?2`
          )
            .bind(target.id, limit)
            .all();

          const targetCard = cardFromRow(target);
          const targetGenres = new Set(targetCard.genres || []);

          const items = candidateRows.map((row, index) => {
            const card = cardFromRow(row);
            const cardGenres = card.genres || [];
            const shared = cardGenres.filter((g) => targetGenres.has(g));

            // Compute similarity match percentage (65% to 98%)
            const genreRatio = targetGenres.size > 0 ? shared.length / targetGenres.size : 0.5;
            const ratingBias = ((card.rating || 7.0) / 10) * 0.15;
            const matchScore = Math.min(0.98, Math.max(0.65, 0.60 + genreRatio * 0.30 + ratingBias - index * 0.01));
            const matchPercentage = Math.round(matchScore * 100);

            const reason =
              shared.length > 0
                ? `Shared ${shared.slice(0, 3).join(', ')} with ${targetCard.title}`
                : `Similar style to ${targetCard.title}`;

            return {
              ...card,
              matchPercentage,
              reason,
              seedTitle: targetCard.title,
            };
          });

          return ok({
            target: targetCard,
            items,
            total: items.length,
          });
        }

        // Global curated high-rating recommendation shelf
        const { results: topRows } = await env.ANIHUB.prepare(
          `SELECT ${CARD_COLUMNS} FROM anime a 
            WHERE a.rating >= 8.0 AND a.status <> 'Upcoming'
            ORDER BY a.rating DESC, a.trend_rank ASC
            LIMIT ?1`
        )
          .bind(limit)
          .all();

        const items = topRows.map((row, idx) => ({
          ...cardFromRow(row),
          matchPercentage: Math.max(85, Math.round(98 - idx * 1.2)),
          reason: 'Curated high-rating community favorite',
        }));

        return ok({
          items,
          total: items.length,
        });
      } catch (err) {
        return errorResponse(err);
      }
    },
    { allowedParams: ['id', 'limit'], waitUntil }
  );
};
