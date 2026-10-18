import { HttpError, errorResponse, ok } from '../_lib.js';

export const onRequestGet = async ({ request, env }) => {
  try {
    const url = new URL(request.url);
    const key = url.searchParams.get('key');
    if (!key || !/^stream:[a-zA-Z0-9_-]+:\d+:(sub|dub|hindi)(:[a-zA-Z0-9_-]+)?$/.test(key)) {
      throw new HttpError(400, 'bad_request', 'Invalid stream cache key format');
    }

    const row = await env.ANIHUB.prepare(
      'SELECT data, expires_at FROM stream_cache WHERE key = ?1 AND expires_at > ?2'
    )
      .bind(key, Date.now())
      .first();

    if (!row) {
      return ok({ hit: false });
    }

    let parsed = null;
    try {
      parsed = JSON.parse(row.data);
    } catch {
      return ok({ hit: false });
    }

    return ok({ hit: true, data: parsed, expiresAt: row.expires_at });
  } catch (err) {
    return errorResponse(err);
  }
};

export const onRequestPost = async ({ request, env }) => {
  try {
    const body = await request.json().catch(() => null);
    if (!body || !body.key || !body.data) {
      throw new HttpError(400, 'bad_request', 'key and data are required');
    }

    const key = String(body.key);
    if (!/^stream:[a-zA-Z0-9_-]+:\d+:(sub|dub|hindi)(:[a-zA-Z0-9_-]+)?$/.test(key)) {
      throw new HttpError(400, 'bad_request', 'Invalid stream cache key format');
    }

    const ttlSeconds = Number.isFinite(body.ttlSeconds) ? Math.min(Math.max(body.ttlSeconds, 3600), 86400) : 21600; // 6h default, max 24h
    const expiresAt = Date.now() + ttlSeconds * 1000;
    const dataStr = typeof body.data === 'string' ? body.data : JSON.stringify(body.data);

    await env.ANIHUB.prepare(
      'INSERT INTO stream_cache (key, data, expires_at) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET data = excluded.data, expires_at = excluded.expires_at'
    )
      .bind(key, dataStr, expiresAt)
      .run();

    // Opportunistically prune expired keys
    await env.ANIHUB.prepare('DELETE FROM stream_cache WHERE expires_at < ?1')
      .bind(Date.now())
      .run()
      .catch(() => {});

    return ok({ ok: true, key, expiresAt });
  } catch (err) {
    return errorResponse(err);
  }
};
