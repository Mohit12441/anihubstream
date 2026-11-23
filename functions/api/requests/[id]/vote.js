import { errorResponse, ok } from '../../_lib.js';

export const onRequestPost = async ({ request, env, params }) => {
  try {
    const db = env.ANIHUB;
    if (!db) return errorResponse(new Error('Database unavailable'), 503);

    const requestId = params.id;
    if (!requestId) return ok({ error: 'bad_request', message: 'Request ID is required' }, { status: 400 });

    const body = await request.json().catch(() => null);
    const userUid = (body?.userUid || '').trim().slice(0, 64);
    if (!userUid) return ok({ error: 'bad_request', message: 'User identification is required to vote' }, { status: 400 });

    const now = Date.now();

    // Check if user already voted
    const existingVote = await db.prepare('SELECT 1 FROM anime_request_vote WHERE request_id = ? AND user_uid = ?').bind(requestId, userUid).first();

    let hasVoted = false;
    let voteDelta = 0;

    if (existingVote) {
      // Remove vote (toggle off)
      await db.prepare('DELETE FROM anime_request_vote WHERE request_id = ? AND user_uid = ?').bind(requestId, userUid).run();
      await db.prepare('UPDATE anime_request SET vote_count = MAX(1, vote_count - 1), updated_at = ? WHERE id = ?').bind(now, requestId).run();
      hasVoted = false;
      voteDelta = -1;
    } else {
      // Add vote (toggle on)
      await db.prepare('INSERT INTO anime_request_vote (request_id, user_uid, created_at) VALUES (?, ?, ?)').bind(requestId, userUid, now).run();
      await db.prepare('UPDATE anime_request SET vote_count = vote_count + 1, updated_at = ? WHERE id = ?').bind(now, requestId).run();
      hasVoted = true;
      voteDelta = 1;
    }

    const updated = await db.prepare('SELECT vote_count FROM anime_request WHERE id = ?').bind(requestId).first();

    return ok({
      success: true,
      requestId,
      hasVoted,
      voteCount: updated?.vote_count ?? 1,
      voteDelta,
    });
  } catch (err) {
    return errorResponse(err);
  }
};
