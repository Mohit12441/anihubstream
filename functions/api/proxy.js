// @ts-check
import { HttpError, errorResponse } from './_lib.js';

const PROXY_TIMEOUT_MS = 25_000;

function rewriteM3u8(text, baseUrl, referer, proxyBase) {
  const mapUri = (uri) => {
    try {
      const abs = new URL(uri, baseUrl).toString();
      const encoded = encodeURIComponent(abs);
      const refParam = referer ? `&referer=${encodeURIComponent(referer)}` : '';
      return `${proxyBase}?url=${encoded}${refParam}`;
    } catch {
      return uri;
    }
  };

  return text
    .split(/\r?\n/)
    .map((raw) => {
      const line = raw.trim();
      if (!line) return line;
      if (line.startsWith('#')) {
        return line.replace(/URI="([^"]+)"/g, (_m, uri) => `URI="${mapUri(uri)}"`);
      }
      return mapUri(line);
    })
    .join('\n');
}

/**
 * Edge Proxy Endpoint:
 * Proxies .m3u8 manifests and media segments, rewriting URIs to bypass CORS and anti-hotlink protections.
 *
 * GET /api/proxy?url=<targetUrl>&referer=<referer>
 */
export const onRequest = async ({ request }) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Range, Accept-Encoding, Content-Type',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  try {
    const reqUrl = new URL(request.url);
    const targetUrlRaw = reqUrl.searchParams.get('url');
    const customReferer = reqUrl.searchParams.get('referer') || '';

    if (!targetUrlRaw) {
      throw new HttpError(400, 'bad_request', 'url query parameter is required');
    }

    let targetUrl = targetUrlRaw;
    try {
      // Decode if base64url encoded
      if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
        targetUrl = atob(targetUrl.replace(/-/g, '+').replace(/_/g, '/'));
      }
    } catch {
      // Keep targetUrlRaw
    }

    const parsedTarget = new URL(targetUrl);
    if (parsedTarget.protocol !== 'http:' && parsedTarget.protocol !== 'https:') {
      throw new HttpError(400, 'bad_request', 'Only HTTP and HTTPS URLs are supported');
    }

    const referer = customReferer || `${parsedTarget.origin}/`;
    const upstreamHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      Referer: referer,
      Origin: new URL(referer).origin,
      Accept: '*/*',
    };

    const range = request.headers.get('range');
    if (range) {
      upstreamHeaders.Range = range;
    }

    const upstreamRes = await fetch(targetUrl, {
      method: request.method,
      headers: upstreamHeaders,
      signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
    });

    const isPlaylist =
      targetUrl.includes('.m3u8') ||
      (upstreamRes.headers.get('content-type') || '').includes('mpegurl');

    const responseHeaders = new Headers();
    responseHeaders.set('Access-Control-Allow-Origin', '*');
    responseHeaders.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    responseHeaders.set('Access-Control-Allow-Headers', 'Range, Accept-Encoding');
    responseHeaders.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');

    const acceptRanges = upstreamRes.headers.get('accept-ranges');
    if (acceptRanges) responseHeaders.set('Accept-Ranges', acceptRanges);

    const contentLength = upstreamRes.headers.get('content-length');
    if (contentLength && !isPlaylist) responseHeaders.set('Content-Length', contentLength);

    const contentRange = upstreamRes.headers.get('content-range');
    if (contentRange) responseHeaders.set('Content-Range', contentRange);

    if (isPlaylist) {
      responseHeaders.set('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
      responseHeaders.set('Cache-Control', 'public, max-age=10, s-maxage=30');

      if (request.method === 'HEAD') {
        return new Response(null, { status: upstreamRes.status, headers: responseHeaders });
      }

      const text = await upstreamRes.text();
      const proxyBase = `${reqUrl.origin}/api/proxy`;
      const rewritten = rewriteM3u8(text, targetUrl, referer, proxyBase);

      return new Response(rewritten, {
        status: upstreamRes.status,
        headers: responseHeaders,
      });
    }

    // Media segment or video stream
    const contentType = upstreamRes.headers.get('content-type') || 'video/mp2t';
    responseHeaders.set('Content-Type', contentType);
    responseHeaders.set('Cache-Control', 'public, max-age=86400, s-maxage=86400, immutable');

    return new Response(upstreamRes.body, {
      status: upstreamRes.status,
      headers: responseHeaders,
    });
  } catch (err) {
    return errorResponse(err);
  }
};
