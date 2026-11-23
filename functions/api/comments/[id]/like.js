import { errorResponse, ok } from '../../_lib.js';

export const onRequestPost = async ({ request, env, params }) => {
  try {
    const db = env.ANIHUB;
    if (!db) return errorResponse(new Error('Database unavailable'), 503);

    const commentId = params.id;
    if (!commentId) return ok({ error: 'bad_request', message: 'Comment ID is required' }, { status: 400 });

    const body = await request.json().catch(() => null);
    const userUid = (body?.userUid || '').trim().slice(0, 64);
    if (!userUid) return ok({ error: 'bad_request', message: 'User identification is required to like' }, { status: 400 });

    const now = Date.now();

    // Check if user already liked this comment
    const existingLike = await db.prepare('SELECT 1 FROM comment_like WHERE comment_id = ? AND user_uid = ?').bind(commentId, userUid).first();

    let hasLiked = false;
    let delta = 0;

    if (existingLike) {
      // Unlike
      await db.prepare('DELETE FROM comment_like WHERE comment_id = ? AND user_uid = ?').bind(commentId, userUid).run();
      await db.prepare('UPDATE comment SET likes = MAX(0, likes - 1), updated_at = ? WHERE id = ?').bind(now, commentId).run();
      hasLiked = false;
      delta = -1;
    } else {
      // Like
      await db.prepare('INSERT INTO comment_like (comment_id, user_uid, created_at) VALUES (?, ?, ?)').bind(commentId, userUid, now).run();
      await db.prepare('UPDATE comment SET likes = likes + 1, updated_at = ? WHERE id = ?').bind(now, commentId).run();
      hasLiked = true;
      delta = 1;
    }

    const updated = await db.prepare('SELECT likes FROM comment WHERE id = ?').bind(commentId).first();

    return ok({
      success: true,
      commentId,
      hasLiked,
      likes: updated?.likes ?? 0,
      delta,
    });
  } catch (err) {
    return errorResponse(err);
  }
};
