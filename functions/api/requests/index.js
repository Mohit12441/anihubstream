import { errorResponse, ok, strParam, intParam } from '../_lib.js';

// SHA-256 helper for privacy-preserving rate limiting
async function hashIp(ip, salt = 'anihub-req-salt-v1') {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(`${salt}:${ip}`));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

// In-memory cooldown cache per worker instance (60s rate limit)
const recentRequests = new Map();

export const onRequestGet = async ({ request, env }) => {
  try {
    const url = new URL(request.url);
    const status = strParam(url, 'status') || 'all';
    const sort = strParam(url, 'sort') || 'popular';
    const q = strParam(url, 'q');
    const userUid = strParam(url, 'userUid');
    const page = Math.max(1, intParam(url, 'page', 1));
    const limit = Math.min(50, Math.max(1, intParam(url, 'limit', 20)));
    const offset = (page - 1) * limit;

    const db = env.ANIHUB;
    if (!db) return ok({ requests: [], total: 0, page, limit });

    const conditions = [];
    const params = [];

    if (status !== 'all') {
      conditions.push('r.status = ?');
      params.push(status);
    }

    if (q) {
      conditions.push('(r.title LIKE ? OR r.native_title LIKE ?)');
      const pattern = `%${q}%`;
      params.push(pattern, pattern);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const orderClause = sort === 'recent' ? 'r.created_at DESC' : 'r.vote_count DESC, r.created_at DESC';

    // 1. Fetch total count
    const countSql = `SELECT COUNT(*) AS total FROM anime_request r ${whereClause}`;
    const totalRow = await db.prepare(countSql).bind(...params).first();
    const total = totalRow?.total ?? 0;

    // 2. Fetch paginated list
    const listSql = `
      SELECT r.id, r.title, r.native_title, r.anilist_id, r.mal_id, r.year, r.notes,
             r.status, r.vote_count, r.requester_name, r.requester_uid, r.anime_id,
             r.created_at, r.updated_at,
             EXISTS(SELECT 1 FROM anime_request_vote v WHERE v.request_id = r.id AND v.user_uid = ?) AS has_voted
      FROM anime_request r
      ${whereClause}
      ORDER BY ${orderClause}
      LIMIT ? OFFSET ?
    `;

    const listParams = [userUid || '', ...params, limit, offset];
    const { results } = await db.prepare(listSql).bind(...listParams).all();

    return ok({
      requests: results.map((r) => ({
        id: r.id,
        title: r.title,
        nativeTitle: r.native_title,
        anilistId: r.anilist_id,
        malId: r.mal_id,
        year: r.year,
        notes: r.notes,
        status: r.status,
        voteCount: r.vote_count,
        requesterName: r.requester_name,
        requesterUid: r.requester_uid,
        animeId: r.anime_id,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        hasVoted: Boolean(r.has_voted),
      })),
      total,
      page,
      limit,
    }, {
      cache: 'public, max-age=10, s-maxage=30, stale-while-revalidate=60',
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

    // Rate-limiting: max 1 submission every 30 seconds
    const now = Date.now();
    const lastSubmission = recentRequests.get(ipHash);
    if (lastSubmission && now - lastSubmission < 30000) {
      const waitSec = Math.ceil((30000 - (now - lastSubmission)) / 1000);
      return ok({ error: 'rate_limited', message: `Please wait ${waitSec}s before submitting another request.` }, { status: 429 });
    }

    const body = await request.json().catch(() => null);
    if (!body || !body.title || typeof body.title !== 'string' || !body.title.trim()) {
      return ok({ error: 'bad_request', message: 'Anime title is required.' }, { status: 400 });
    }

    const title = body.title.trim().slice(0, 150);
    const nativeTitle = (body.nativeTitle || '').trim().slice(0, 150) || null;
    const anilistId = Number(body.anilistId) > 0 ? Number(body.anilistId) : null;
    const malId = Number(body.malId) > 0 ? Number(body.malId) : null;
    const year = Number(body.year) >= 1960 && Number(body.year) <= 2030 ? Number(body.year) : null;
    const notes = (body.notes || '').trim().slice(0, 300) || null;
    const requesterName = (body.requesterName || 'Otaku').trim().slice(0, 30);
    const requesterUid = (body.requesterUid || crypto.randomUUID()).trim().slice(0, 64);

    // 1. Check if anime is already in the website's catalogue
    const existingInCatalog = await db.prepare(`
      SELECT id, title FROM anime 
      WHERE LOWER(title) = LOWER(?1) 
         OR (json_extract(source_ids, '$.anilist') IS NOT NULL AND json_extract(source_ids, '$.anilist') = ?2)
      LIMIT 1
    `).bind(title, anilistId).first();

    if (existingInCatalog) {
      return ok({
        alreadyExists: true,
        animeId: existingInCatalog.id,
        animeTitle: existingInCatalog.title,
        message: `"${existingInCatalog.title}" is already available on AniHubStream!`,
      });
    }

    // 2. Check if already requested and currently pending or in-progress
    const existingRequest = await db.prepare(`
      SELECT id, title, vote_count FROM anime_request 
      WHERE (LOWER(title) = LOWER(?1) OR (anilist_id IS NOT NULL AND anilist_id = ?2))
        AND status IN ('pending', 'in_progress')
      LIMIT 1
    `).bind(title, anilistId).first();

    if (existingRequest) {
      // Cast a vote automatically for the existing request if user hasn't voted yet
      const voteExists = await db.prepare(`
        SELECT 1 FROM anime_request_vote WHERE request_id = ? AND user_uid = ?
      `).bind(existingRequest.id, requesterUid).first();

      if (!voteExists) {
        await db.prepare('INSERT OR IGNORE INTO anime_request_vote (request_id, user_uid, created_at) VALUES (?, ?, ?)').bind(existingRequest.id, requesterUid, now).run();
        await db.prepare('UPDATE anime_request SET vote_count = vote_count + 1, updated_at = ? WHERE id = ?').bind(now, existingRequest.id).run();
      }

      recentRequests.set(ipHash, now);
      return ok({
        alreadyRequested: true,
        requestId: existingRequest.id,
        voteCount: (existingRequest.vote_count ?? 0) + (voteExists ? 0 : 1),
        message: `This anime has already been requested! We boosted its priority with your vote (+1).`,
      });
    }

    // 3. Create new request
    const requestId = `req_${crypto.randomUUID().slice(0, 12)}`;
    await db.prepare(`
      INSERT INTO anime_request (
        id, title, native_title, anilist_id, mal_id, year, notes,
        status, vote_count, requester_name, requester_uid, created_at, updated_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'pending', 1, ?8, ?9, ?10, ?10)
    `).bind(requestId, title, nativeTitle, anilistId, malId, year, notes, requesterName, requesterUid, now).run();

    // Auto-record requester's vote
    await db.prepare('INSERT OR IGNORE INTO anime_request_vote (request_id, user_uid, created_at) VALUES (?, ?, ?)').bind(requestId, requesterUid, now).run();

    recentRequests.set(ipHash, now);

    return ok({
      success: true,
      request: {
        id: requestId,
        title,
        nativeTitle,
        anilistId,
        malId,
        year,
        notes,
        status: 'pending',
        voteCount: 1,
        requesterName,
        createdAt: now,
      },
      message: 'Request submitted successfully! It has been added to the community request queue.',
    });
  } catch (err) {
    return errorResponse(err);
  }
};
