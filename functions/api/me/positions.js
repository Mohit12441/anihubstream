import { HttpError, CARD_COLUMNS, cardFromRow, deriveSlugCandidates, errorResponse, existingViewer, findAnimeByCandidates, getViewer, json, withViewer } from '../_lib.js';

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

    let episode = await env.ANIHUB.prepare(
      'SELECT id, runtime_seconds FROM episode WHERE id = ?1',
    )
      .bind(episodeId)
      .first();

    let targetEpisodeId = episode?.id || episodeId;

    if (!episode && episodeId.includes('#')) {
      const [animeId, rawNum] = episodeId.split('#');
      const num = Number.parseInt(rawNum, 10);
      if (animeId && Number.isFinite(num) && num >= 1) {
        const candidates = deriveSlugCandidates(animeId);
        let anime = await findAnimeByCandidates(env.ANIHUB, candidates);
        if (!anime) {
          anime = await env.ANIHUB.prepare('SELECT id, title, art, key_art FROM anime WHERE id = ?1')
            .bind(animeId)
            .first()
            .catch(() => null);
        }
        if (anime) {
          // Check if canonical episode exists for this anime_id and episode number
          const canonicalEp = await env.ANIHUB.prepare(
            'SELECT id, runtime_seconds FROM episode WHERE anime_id = ?1 AND n = ?2'
          ).bind(anime.id, num).first().catch(() => null);

          if (canonicalEp) {
            episode = canonicalEp;
            targetEpisodeId = canonicalEp.id;
          } else {
            const defaultSeconds = Math.max(1440, Math.ceil(seconds));
            targetEpisodeId = `${anime.id}#${num}`;
            await env.ANIHUB.prepare(
              `INSERT OR IGNORE INTO episode (id, anime_id, n, title, runtime, runtime_seconds, thumb, synopsis, markers, airdate)
               VALUES (?1, ?2, ?3, ?4, '24:00', ?5, ?6, '', '[]', NULL)`
            ).bind(
              targetEpisodeId,
              anime.id,
              num,
              `Episode ${num}`,
              defaultSeconds,
              anime.art || anime.key_art || ''
            ).run().catch(() => null);

            episode = { id: targetEpisodeId, runtime_seconds: defaultSeconds };
          }
        }
      }
    }

    if (!episode) throw new HttpError(404, 'not_found', `episode "${episodeId}" not found`);

    const safeSeconds = Math.max(0, Math.round(seconds * 10) / 10);

    // If viewer watched beyond the initial estimate (e.g. extended cut, movie, OVA),
    // update the database runtime to the actual duration rather than rejecting with 400!
    if (episode.runtime_seconds && safeSeconds > episode.runtime_seconds) {
      const newRuntime = Math.ceil(safeSeconds);
      await env.ANIHUB.prepare('UPDATE episode SET runtime_seconds = ?1 WHERE id = ?2')
        .bind(newRuntime, targetEpisodeId)
        .run()
        .catch(() => null);
      episode.runtime_seconds = newRuntime;
    }

    const { id, setCookie } = await getViewer(env, request);
    await env.ANIHUB.prepare(
      `INSERT INTO position (viewer_id, episode_id, seconds, updated_at) VALUES (?1, ?2, ?3, datetime('now'))
       ON CONFLICT (viewer_id, episode_id) DO UPDATE SET seconds = excluded.seconds, updated_at = datetime('now')`,
    )
      .bind(id, targetEpisodeId, safeSeconds)
      .run();

    return withViewer(json({ saved: true, episodeId: targetEpisodeId, seconds: safeSeconds }), setCookie);
  } catch (err) {
    return errorResponse(err);
  }
};

export const onRequestDelete = async ({ request, env }) => {
  try {
    const rawEpisodeId = new URL(request.url).searchParams.get('episodeId');
    if (!rawEpisodeId) throw new HttpError(400, 'bad_request', 'episodeId query parameter is required');
    let targetId = rawEpisodeId;
    if (rawEpisodeId.includes('#')) {
      const [rawAnimeId, rawNum] = rawEpisodeId.split('#');
      const num = Number.parseInt(rawNum, 10);
      if (rawAnimeId && Number.isFinite(num)) {
        const candidates = deriveSlugCandidates(rawAnimeId);
        const anime = await findAnimeByCandidates(env.ANIHUB, candidates);
        if (anime) {
          const ep = await env.ANIHUB.prepare('SELECT id FROM episode WHERE anime_id = ?1 AND n = ?2')
            .bind(anime.id, num).first().catch(() => null);
          if (ep?.id) targetId = ep.id;
        }
      }
    }
    const { id, setCookie } = await getViewer(env, request);
    const { meta } = await env.ANIHUB.prepare('DELETE FROM position WHERE viewer_id = ?1 AND (episode_id = ?2 OR episode_id = ?3)')
      .bind(id, targetId, rawEpisodeId)
      .run();
    return withViewer(json({ removed: meta.changes > 0 }), setCookie);
  } catch (err) {
    return errorResponse(err);
  }
};
