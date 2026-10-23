import { CARD_COLUMNS, cardFromRow, errorResponse, ok, strParam } from './_lib.js';

const WEEK = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

export const onRequestGet = async ({ request, env }) => {
  try {
    const url = new URL(request.url);
    const season = strParam(url, 'season');
    const filter = season ? 'WHERE a.sched_day IS NOT NULL AND a.sched_season = ?1' : 'WHERE a.sched_day IS NOT NULL';
    const stmt = env.ANIHUB.prepare(
      `SELECT ${CARD_COLUMNS} FROM anime a ${filter} ORDER BY a.sched_day, a.sched_time`,
    );
    const { results } = await (season ? stmt.bind(season) : stmt).all();

    const days = WEEK.map((dayLabel, i) => ({
      day: i + 1,
      dayLabel,
      entries: results.filter((r) => r.sched_day === i + 1).map(cardFromRow),
    }));

    return ok(
      { seasons: [...new Set(results.map((r) => r.sched_season).filter(Boolean))].sort(), days },
      { cache: 'public, max-age=60, s-maxage=600, stale-while-revalidate=60', headers: { vary: 'Accept-Encoding' } },
    );
  } catch (err) {
    return errorResponse(err);
  }
};
