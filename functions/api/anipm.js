// @ts-check
import { HttpError, ok, errorResponse } from './_lib.js';

export const onRequestGet = async ({ request, env }) => {
  try {
    const url = new URL(request.url);
    const id = url.searchParams.get('id') || url.searchParams.get('anilistId');
    const ep = url.searchParams.get('ep') || '1';
    const lang = url.searchParams.get('lang') || 'sub';
    const refresh = url.searchParams.has('refresh') ? '&refresh=1' : '';

    if (!id) {
      throw new HttpError(400, 'bad_request', 'id query parameter is required');
    }

    const bridgeBase = env.STREAM_BRIDGE_URL || 'http://127.0.0.1:8795';
    const target = `${bridgeBase}/api/anipm?id=${encodeURIComponent(id)}&ep=${encodeURIComponent(ep)}&lang=${encodeURIComponent(lang)}${refresh}`;

    const res = await fetch(target, {
      signal: AbortSignal.timeout(25000),
      headers: { accept: 'application/json' },
    });

    const data = await res.json().catch(() => null);
    if (!res.ok) {
      throw new HttpError(res.status, data?.error || 'bridge_error', data?.detail || 'AniPM resolution failed');
    }
    return ok(data, { cache: 'no-store' });
  } catch (err) {
    return errorResponse(err);
  }
};
