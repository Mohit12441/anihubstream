// @ts-check
import { CARD_COLUMNS, cardFromRow, cleanDisplayTitle, errorResponse, ok } from '../_lib.js';

const ROW_LIMIT = 20;

function formatAnikotoCard(row) {
  if (!row) return null;
  const baseCard = cardFromRow(row);
  const slug = row.provider_slug || row.id;
  return {
    ...baseCard,
    id: `anikoto:${slug}`,
    slug,
    title: cleanDisplayTitle(row.title),
    provider: 'anikoto',
  };
}

/**
 * AniKoto Isolated Home Edge Endpoint:
 * GET /api/anikoto/home
 */
export const onRequestGet = async ({ env }) => {
  try {
    const db = env.ANIHUB;
    if (!db) {
      return ok({
        ok: true,
        data: {
          spotlight: [],
          trending: [],
          popular: [],
          latestEpisodes: [],
        },
        provider: 'anikoto',
        source: 'empty',
      });
    }

    const getShelf = async (orderClause, limit = ROW_LIMIT) => {
      const rows = await db.prepare(
        `SELECT ${CARD_COLUMNS}, pm.provider_slug
         FROM anime a
         JOIN anime_provider_mapping pm ON pm.anime_id = a.id AND pm.provider_id = 'anikoto'
         ORDER BY ${orderClause}
         LIMIT ?1`
      ).bind(limit).all().catch(() => ({ results: [] }));

      return (rows.results || []).map(formatAnikotoCard).filter(Boolean);
    };

    const [spotlight, trending, popular, latestEpisodes] = await Promise.all([
      getShelf('a.trend_rank IS NULL, a.trend_rank ASC, a.rating DESC', 5),
      getShelf('a.trend_rank IS NULL, a.trend_rank ASC, a.rating DESC', ROW_LIMIT),
      getShelf('a.rating DESC, a.year DESC', ROW_LIMIT),
      getShelf('a.year DESC, a.rating DESC', ROW_LIMIT),
    ]);

    return ok({
      ok: true,
      data: {
        spotlight,
        trending,
        popular,
        latestEpisodes,
      },
      provider: 'anikoto',
      source: 'd1',
    }, { cache: 'public, max-age=300, s-maxage=600' });
  } catch (err) {
    return errorResponse(err);
  }
};
