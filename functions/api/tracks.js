// @ts-check
import { HttpError, ok, errorResponse } from './_lib.js';

export const onRequestGet = async ({ request, env }) => {
  try {
    const url = new URL(request.url);
    const id = url.searchParams.get('id') || url.searchParams.get('anilistId');
    const ep = url.searchParams.get('ep') || '1';
    const lang = url.searchParams.get('lang') || 'sub';
    const server = url.searchParams.get('server') || 'beta';
    const slug = url.searchParams.get('slug') || '';
    const refresh = url.searchParams.has('refresh') ? '&refresh=1' : '';

    if (!id) {
      throw new HttpError(400, 'bad_request', 'id query parameter is required');
    }

    const bridgeBase = env.STREAM_BRIDGE_URL || 'http://127.0.0.1:8795';
    let target = `${bridgeBase}/api/tracks?id=${encodeURIComponent(id)}&ep=${encodeURIComponent(ep)}&lang=${encodeURIComponent(lang)}&server=${encodeURIComponent(server)}${refresh}`;
    if (slug) {
      target += `&slug=${encodeURIComponent(slug)}`;
    }

    const res = await fetch(target, {
      signal: AbortSignal.timeout(25000),
      headers: { accept: 'application/json' },
    });

    const data = await res.json();
    if (!res.ok) {
      return new Response(JSON.stringify(data), {
        status: res.status,
        headers: {
          'content-type': 'application/json',
          'access-control-allow-origin': '*',
          'cache-control': 'no-store',
        },
      });
    }

    return ok(data, { cache: 'no-store' });
  } catch (err) {
    return errorResponse(err);
  }
};
