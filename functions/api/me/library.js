import { CARD_COLUMNS, HttpError, cardFromRow, deriveSlugCandidates, errorResponse, existingViewer, findAnimeByCandidates, getViewer, json, withViewer } from '../_lib.js';
const LIST = `SELECT ${CARD_COLUMNS}, l.added_at
                FROM library l JOIN anime a ON a.id = l.anime_id
               WHERE l.viewer_id = ?1
               ORDER BY l.added_at DESC`;

const size = async (env, viewerId) =>
  (await env.ANIHUB.prepare('SELECT count(*) AS n FROM library WHERE viewer_id = ?1').bind(viewerId).first()).n;

const bodyAnimeId = async (request) => {
  let body;
  try {
    body = await request.json();
  } catch {
    throw new HttpError(400, 'bad_request', 'expected a JSON body with an animeId');
  }
  const animeId = body?.animeId;
  if (typeof animeId !== 'string' || animeId === '' || animeId.length > 80) {
    throw new HttpError(400, 'bad_request', 'animeId must be a non-empty string');
  }
  return animeId;
};

const knownAnime = async (env, animeId) => {
  const candidates = deriveSlugCandidates(animeId);
  const found = await findAnimeByCandidates(env.ANIHUB, candidates);
  if (found) return found;
  const row = await env.ANIHUB.prepare('SELECT id FROM anime WHERE id = ?1').bind(animeId).first();
  if (!row) throw new HttpError(404, 'not_found', `anime "${animeId}" not found`);
  return row;
};

export const onRequestGet = async ({ request, env }) => {
  try {
    const id = await existingViewer(env, request);
    if (!id) return json({ count: 0, items: [] });
    const { results } = await env.ANIHUB.prepare(LIST).bind(id).all();
    return json({
      count: results.length,
      items: results.map((r) => ({ addedAt: r.added_at, anime: cardFromRow(r) })),
    });
  } catch (err) {
    return errorResponse(err);
  }
};

export const onRequestPost = async ({ request, env }) => {
  try {
    const rawAnimeId = await bodyAnimeId(request);
    const anime = await knownAnime(env, rawAnimeId);
    const animeId = anime.id;
    const { id, setCookie } = await getViewer(env, request);
    await env.ANIHUB.prepare('INSERT OR IGNORE INTO library (viewer_id, anime_id) VALUES (?1, ?2)')
      .bind(id, animeId)
      .run();
    const card = await env.ANIHUB.prepare(`SELECT ${CARD_COLUMNS} FROM anime a WHERE a.id = ?1`)
      .bind(animeId)
      .first();
    return withViewer(json({ saved: true, count: await size(env, id), anime: cardFromRow(card) }), setCookie);
  } catch (err) {
    return errorResponse(err);
  }
};

export const onRequestDelete = async ({ request, env }) => {
  try {
    const rawAnimeId = new URL(request.url).searchParams.get('animeId');
    if (!rawAnimeId) throw new HttpError(400, 'bad_request', 'animeId query parameter is required');
    const candidates = deriveSlugCandidates(rawAnimeId);
    const anime = await findAnimeByCandidates(env.ANIHUB, candidates);
    const targetIds = anime ? [anime.id, rawAnimeId] : [rawAnimeId];
    const { id, setCookie } = await getViewer(env, request);
    let removed = false;
    for (const aid of targetIds) {
      const { meta } = await env.ANIHUB.prepare('DELETE FROM library WHERE viewer_id = ?1 AND anime_id = ?2')
        .bind(id, aid)
        .run();
      if (meta.changes > 0) removed = true;
    }
    return withViewer(json({ removed, count: await size(env, id) }), setCookie);
  } catch (err) {
    return errorResponse(err);
  }
};
