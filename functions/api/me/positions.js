import { HttpError, CARD_COLUMNS, cardFromRow, errorResponse, existingViewer, getViewer, json, withViewer } from '../_lib.js';

const HISTORY = `SELECT p.seconds, p.updated_at,
                        e.id AS episode_id, e.n AS episode_number, e.title AS episode_title,
                        e.runtime_seconds, e.thumb AS episode_art,
                        ${CARD_COLUMNS}
                   FROM position p
                   JOIN episode e ON e.id = p.episode_id
                   JOIN anime a ON a.id = e.anime_id
                  WHERE p.viewer_id = ?1
                  ORDER BY p.updated_at DESC
                  LIMIT ?2`;

export const onRequestGet = async ({ request, env }) => {
  try {
    const raw = new URL(request.url).searchParams.get('limit');
    const limit = Math.min(100, Math.max(1, Number.parseInt(raw, 10) || 20));
    const id = await existingViewer(env, request);
    if (!id) return json({ count: 0, items: [] });
    const { results } = await env.ANIHUB.prepare(HISTORY).bind(id, limit).all();
    return json({
      count: results.length,
      items: results.map((r) => ({
        episodeId: r.episode_id,
        episodeNumber: r.episode_number,
        episodeTitle: r.episode_title,
        seconds: r.seconds,
        runtimeSeconds: r.runtime_seconds,
        updatedAt: r.updated_at,
        episodeArt: r.episode_art,
        anime: cardFromRow(r),
      })),
    });
  } catch (err) {
    return errorResponse(err);
  }
};

export const onRequestPut = async ({ request, env }) => {
  try {
    let body;
    try {
      body = await request.json();
    } catch {
      throw new HttpError(400, 'bad_request', 'expected a JSON body with an episodeId and seconds');
    }
    const episodeId = body?.episodeId;
    const seconds = body?.seconds;
    if (typeof episodeId !== 'string' || episodeId === '' || episodeId.length > 120) {
      throw new HttpError(400, 'bad_request', 'episodeId must be a non-empty string');
    }
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) {
      throw new HttpError(400, 'bad_request', 'seconds must be a non-negative number');
    }

    const episode = await env.ANIHUB.prepare(
      'SELECT id, runtime_seconds FROM episode WHERE id = ?1',
    )
      .bind(episodeId)
      .first();
    if (!episode) throw new HttpError(404, 'not_found', `episode "${episodeId}" not found`);
    if (seconds > episode.runtime_seconds) {
      throw new HttpError(400, 'bad_request', `seconds must be at most ${episode.runtime_seconds}`);
    }

    const { id, setCookie } = await getViewer(env, request);
    await env.ANIHUB.prepare(
      `INSERT INTO position (viewer_id, episode_id, seconds, updated_at) VALUES (?1, ?2, ?3, datetime('now'))
       ON CONFLICT (viewer_id, episode_id) DO UPDATE SET seconds = excluded.seconds, updated_at = datetime('now')`,
    )
      .bind(id, episodeId, seconds)
      .run();

    return withViewer(json({ saved: true, episodeId, seconds }), setCookie);
  } catch (err) {
    return errorResponse(err);
  }
};

export const onRequestDelete = async ({ request, env }) => {
  try {
    const episodeId = new URL(request.url).searchParams.get('episodeId');
    if (!episodeId) throw new HttpError(400, 'bad_request', 'episodeId query parameter is required');
    const { id, setCookie } = await getViewer(env, request);
    const { meta } = await env.ANIHUB.prepare('DELETE FROM position WHERE viewer_id = ?1 AND episode_id = ?2')
      .bind(id, episodeId)
      .run();
    return withViewer(json({ removed: meta.changes > 0 }), setCookie);
  } catch (err) {
    return errorResponse(err);
  }
};
