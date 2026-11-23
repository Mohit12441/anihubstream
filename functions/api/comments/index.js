import { errorResponse, ok, strParam, intParam } from '../_lib.js';

// SHA-256 helper for privacy-preserving rate limiting
async function hashIp(ip, salt = 'anihub-comm-salt-v1') {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(`${salt}:${ip}`));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

// In-memory rate limiting cooldown (15s per IP hash)
const recentComments = new Map();

// Basic profanity / spam word list
const BANNED_PATTERNS = [
  /\b(nigger|faggot|kike|chink|cp|childporn)\b/i,
  /(?:https?:\/\/|www\.)[^\s]+(?:\.ru|\.xyz|\.top|\.click|\.biz|free-vbucks|dating|sex)/i,
];

function sanitizeContent(text) {
  let cleaned = text.trim();
  for (const pattern of BANNED_PATTERNS) {
    if (pattern.test(cleaned)) {
      throw new Error('Comment contains prohibited words or suspicious links.');
    }
  }
  return cleaned;
}

export const onRequestGet = async ({ request, env }) => {
  try {
    const url = new URL(request.url);
    const animeId = strParam(url, 'animeId');
    const episodeNParam = url.searchParams.get('episodeN');
    const episodeN = episodeNParam !== null && episodeNParam !== '' ? intParam(url, 'episodeN', 0, 5000, 0) : null;
    const userUid = strParam(url, 'userUid');

    if (!animeId) {
      return ok({ error: 'bad_request', message: 'animeId parameter is required' }, { status: 400 });
    }

    const db = env.ANIHUB;
    if (!db) return ok({ comments: [], total: 0 });

    const conditions = ['c.anime_id = ?1', 'c.is_deleted = 0'];
    const bindings = [animeId];

    if (episodeN !== null) {
      conditions.push('c.episode_n = ?2');
      bindings.push(episodeN);
    } else {
      // If episodeN is not specified, return series-level comments (episode_n IS NULL)
      conditions.push('c.episode_n IS NULL');
    }

    const hasUser = Boolean(userUid && typeof userUid === 'string' && userUid.trim());
    const queryBindings = [...bindings];
    let joinSql = '';
    let hasLikedSelect = '0 AS has_liked';

    if (hasUser) {
      joinSql = `LEFT JOIN comment_like cl ON cl.comment_id = c.id AND cl.user_uid = ?${bindings.length + 1}`;
      queryBindings.push(userUid.trim());
      hasLikedSelect = 'CASE WHEN cl.user_uid IS NOT NULL THEN 1 ELSE 0 END AS has_liked';
    }

    const sql = `
      SELECT c.id, c.anime_id, c.episode_n, c.parent_id,
             c.author_name, c.author_uid, c.author_avatar,
             c.content, c.has_spoiler, c.likes, c.is_pinned,
             c.created_at, c.updated_at,
             ${hasLikedSelect}
      FROM comment c
      ${joinSql}
      WHERE ${conditions.join(' AND ')}
      ORDER BY c.is_pinned DESC, c.created_at DESC
      LIMIT 100
    `;

    const { results } = await db.prepare(sql).bind(...queryBindings).all();

    // Reconstruct nested thread tree (parent -> replies)
    const commentMap = new Map();
    const rootComments = [];

    for (const r of results) {
      const item = {
        id: r.id,
        animeId: r.anime_id,
        episodeN: r.episode_n,
        parentId: r.parent_id,
        authorName: r.author_name,
        authorUid: r.author_uid,
        authorAvatar: r.author_avatar,
        content: r.content,
        hasSpoiler: Boolean(r.has_spoiler),
        likes: r.likes ?? 0,
        isPinned: Boolean(r.is_pinned),
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        hasLiked: Boolean(r.has_liked),
        replies: [],
      };
      commentMap.set(item.id, item);
    }

    for (const item of commentMap.values()) {
      if (item.parentId && commentMap.has(item.parentId)) {
        commentMap.get(item.parentId).replies.push(item);
      } else {
        rootComments.push(item);
      }
    }

    return ok({
      comments: rootComments,
      total: results.length,
    }, {
      cache: 'public, max-age=5, s-maxage=15, stale-while-revalidate=30',
    });
  } catch (err) {
    return errorResponse(err);
  }
};

export const onRequestPost = async ({ request, env }) => {
  try {
    const db = env.ANIHUB;
    if (!db) return errorResponse(new Error('Database unavailable'), 503);

    const clientIp = request.headers.get('cf-connecting-ip') || '127.0.0.1';
    const ipHash = await hashIp(clientIp);

    // Rate-limiting: max 1 comment every 10 seconds
    const now = Date.now();
    const lastComment = recentComments.get(ipHash);
    if (lastComment && now - lastComment < 10000) {
      const waitSec = Math.ceil((10000 - (now - lastComment)) / 1000);
      return ok({ error: 'rate_limited', message: `Please wait ${waitSec}s before posting again.` }, { status: 429 });
    }

    const body = await request.json().catch(() => null);
    if (!body || !body.animeId || !body.content || !body.content.trim()) {
      return ok({ error: 'bad_request', message: 'Anime ID and comment text are required.' }, { status: 400 });
    }

    const animeId = String(body.animeId).trim().slice(0, 100);
    const episodeN = body.episodeN !== undefined && body.episodeN !== null ? Number(body.episodeN) : null;
    const parentId = body.parentId ? String(body.parentId).trim().slice(0, 64) : null;
    const authorName = (body.authorName || 'Otaku').trim().slice(0, 30);
    const authorUid = (body.authorUid || crypto.randomUUID()).trim().slice(0, 64);
    const authorAvatar = (body.authorAvatar || 'luffy').trim().slice(0, 20);
    const hasSpoiler = Boolean(body.hasSpoiler);

    let content = '';
    try {
      content = sanitizeContent(String(body.content).slice(0, 1000));
    } catch (e) {
      return ok({ error: 'rejected', message: e.message }, { status: 400 });
    }

    const commentId = `comm_${crypto.randomUUID().slice(0, 16)}`;

    await db.prepare(`
      INSERT INTO comment (
        id, anime_id, episode_n, parent_id,
        author_name, author_uid, author_avatar,
        content, has_spoiler, likes, is_pinned, is_deleted,
        ip_hash, created_at, updated_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 0, 0, 0, ?10, ?11, ?11)
    `).bind(
      commentId, animeId, episodeN, parentId,
      authorName, authorUid, authorAvatar,
      content, hasSpoiler ? 1 : 0, ipHash, now
    ).run();

    recentComments.set(ipHash, now);

    return ok({
      success: true,
      comment: {
        id: commentId,
        animeId,
        episodeN,
        parentId,
        authorName,
        authorUid,
        authorAvatar,
        content,
        hasSpoiler,
        likes: 0,
        isPinned: false,
        createdAt: now,
        hasLiked: false,
        replies: [],
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
};
