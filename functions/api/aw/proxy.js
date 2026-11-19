// @ts-check
import { HttpError, errorResponse } from '../_lib.js';

const PROXY_TIMEOUT_MS = 25_000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

const ALLOWED_AW_HOSTS = [
  'mfw09.org',
  'playmogo.com',
  'playmogo.org',
  'akamaized.net',
  'cloudfront.net',
  'fastly.net',
  'fastlylb.net',
  'owphbf24.com',
  'r66nv9ed.com',
  'sprintcdn.com',
];

export function isAwHostAllowed(hostname, env = {}) {
  if (!hostname || typeof hostname !== 'string') return false;
  const host = hostname.toLowerCase().trim();
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return false;
  if (/^(?:127\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2[0-9]|3[01])\.|0\.|::1|fe80:|fc00:)/i.test(host)) return false;
  const extra = String(env?.AW_CDN_HOSTS || '')
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  const hosts = [...ALLOWED_AW_HOSTS, ...extra];
  const allow = (h) => hosts.some((x) => h === x || h.endsWith('.' + x));
  if (allow(host)) return true;
  return false;
}

// Back-compat alias for tests importing isHostAllowed from this module.
export const isHostAllowed = isAwHostAllowed;

function proxyUrlFor(abs) {
  return `/api/aw/proxy?u=${encodeURIComponent(abs)}`;
}

function rewriteAwPlaylist(text, baseUrl) {
  const lines = text.split(/\r?\n/);
  const out = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      out.push(raw);
      continue;
    }
    // Drop interstitial DATERANGE markers.
    if (line.startsWith('#EXT-X-DATERANGE')) {
      if (/CLASS="com\.apple\.hls\.interstitial"/i.test(line) || /X-AD/i.test(line)) {
        continue;
      }
    }
    if (line.startsWith('#')) {
      if (line.includes('URI=')) {
        out.push(line.replace(/URI="([^"]+)"/g, (_m, uri) => {
          try {
            const abs = new URL(uri, baseUrl).href;
            return `URI="${proxyUrlFor(abs)}"`;
          } catch {
            return _m;
          }
        }));
      } else {
        out.push(raw);
      }
      continue;
    }
    // Bare segment / sub-playlist line.
    try {
      const abs = new URL(line, baseUrl).href;
      out.push(proxyUrlFor(abs));
    } catch {
      out.push(raw);
    }
  }
  return out.join('\n');
}

// Compatibility shim matching the main proxy's rewriteM3u8 signature.
export function rewriteM3u8(text, baseUrl, referer, proxyBase, options = {}) {
  return rewriteAwPlaylist(text, baseUrl);
}

export const onRequest = async (context) => {
  const { request, env = {}, waitUntil } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Range, Accept-Encoding, Content-Type, Origin, Accept',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  try {
    const reqUrl = new URL(request.url);
    const targetUrlRaw = reqUrl.searchParams.get('u') || reqUrl.searchParams.get('url');
    if (!targetUrlRaw) {
      throw new HttpError(400, 'bad_request', 'u query parameter is required');
    }

    let targetUrl = targetUrlRaw;
    try {
      if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
        targetUrl = atob(targetUrl.replace(/-/g, '+').replace(/_/g, '/'));
      }
    } catch {}

    let parsedTarget;
    try {
      parsedTarget = new URL(targetUrl);
    } catch {
      throw new HttpError(400, 'bad_request', 'Invalid target URL');
    }

    if (parsedTarget.protocol !== 'http:' && parsedTarget.protocol !== 'https:') {
      throw new HttpError(400, 'bad_request', 'Only HTTP and HTTPS URLs are supported');
    }

    if (!isAwHostAllowed(parsedTarget.hostname, env)) {
      throw new HttpError(403, 'forbidden', `Destination domain "${parsedTarget.hostname}" is not authorized`);
    }

    const hostOrigin = parsedTarget.origin;
    const upstreamHeaders = {
      'User-Agent': UA,
      Referer: `${hostOrigin}/`,
      Origin: hostOrigin,
      Accept: '*/*',
    };

    const rangeHeader = request.headers.get('range');
    if (rangeHeader) upstreamHeaders.Range = rangeHeader;

    const upstreamRes = await fetch(targetUrl, {
      method: request.method,
      headers: upstreamHeaders,
      signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
    });

    const isPlaylist = targetUrl.includes('.m3u8') || parsedTarget.pathname.endsWith('.m3u8') ||
      (upstreamRes.headers.get('content-type') || '').includes('mpegurl');

    const responseHeaders = new Headers();
    responseHeaders.set('Access-Control-Allow-Origin', '*');
    responseHeaders.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    responseHeaders.set('Access-Control-Allow-Headers', 'Range, Accept-Encoding, Content-Type, Origin, Accept');
    responseHeaders.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');

    const acceptRanges = upstreamRes.headers.get('accept-ranges');
    if (acceptRanges) responseHeaders.set('Accept-Ranges', acceptRanges);
    const contentRange = upstreamRes.headers.get('content-range');
    if (contentRange) responseHeaders.set('Content-Range', contentRange);

    if (isPlaylist) {
      responseHeaders.set('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
      responseHeaders.set('Cache-Control', 'public, max-age=60, s-maxage=180, stale-while-revalidate=60');

      if (request.method === 'HEAD') {
        return new Response(null, { status: upstreamRes.status, headers: responseHeaders });
      }

      const text = await upstreamRes.text();
      const rewritten = rewriteAwPlaylist(text, targetUrl);
      return new Response(rewritten, { status: upstreamRes.status, headers: responseHeaders });
    }

    // Non-playlist (segments): pass through headers hls.js needs and cache.
    if (!isPlaylist) {
      for (const k of ['content-length', 'content-range', 'accept-ranges', 'etag']) {
        const v = upstreamRes.headers.get(k);
        if (v) responseHeaders.set(k, v);
      }
    }
    let contentType = 'video/mp2t';
    if (parsedTarget.pathname.endsWith('.m4s') || parsedTarget.pathname.endsWith('.mp4')) contentType = 'video/mp4';
    else if (parsedTarget.pathname.endsWith('.webm')) contentType = 'video/webm';
    responseHeaders.set('Content-Type', upstreamRes.headers.get('content-type') || contentType);
    responseHeaders.set('Cache-Control', 'public, max-age=86400');

    if (upstreamRes.status >= 400) {
      return new Response(null, { status: upstreamRes.status, headers: responseHeaders });
    }

    return new Response(upstreamRes.body, { status: upstreamRes.status, headers: responseHeaders });
  } catch (err) {
    return errorResponse(err);
  }
};

// Aliases for test/import flexibility.
export const onRequestGet = onRequest;
export const onRequestPost = onRequest;
