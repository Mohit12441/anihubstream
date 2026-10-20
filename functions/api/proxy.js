// @ts-check
import { HttpError, errorResponse } from './_lib.js';

const PROXY_TIMEOUT_MS = 25_000;

const AD_DOMAIN_REGEX = /(googleads|doubleclick|adservice|adserver|popcash|propeller|adsterra|monetag|juicyads|exoclick|syndication|outbrain|taboola|trafficjunky|ad-maven)/i;

/**
 * Sanitizes HLS .m3u8 manifests by removing injected advertisement blocks,
 * SCTE-35 ad cue tags, foreign ad tracker URLs, and rewriting all legitimate URIs.
 */
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

  const lines = text.split(/\r?\n/);
  const result = [];
  let skippingAdCue = false;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (!line) continue;

    // Detect SCTE-35 and HLS Ad Insertion Cue markers
    if (line.startsWith('#EXT-X-CUE-OUT') || line.startsWith('#EXT-OATCLS-SCTE35')) {
      skippingAdCue = true;
      continue;
    }
    if (line.startsWith('#EXT-X-CUE-IN')) {
      skippingAdCue = false;
      continue;
    }

    if (skippingAdCue) {
      continue;
    }

    // Drop injected ad segment URLs
    if (AD_DOMAIN_REGEX.test(line)) {
      if (result.length > 0 && result[result.length - 1].startsWith('#EXTINF')) {
        result.pop();
      }
      continue;
    }

    if (line.startsWith('#')) {
      // Rewrite URIs inside tags like #EXT-X-KEY, #EXT-X-MAP, #EXT-X-MEDIA
      if (line.includes('URI=')) {
        result.push(line.replace(/URI="([^"]+)"/g, (_m, uri) => `URI="${mapUri(uri)}"`));
      } else {
        result.push(line);
      }
      continue;
    }

    // Legitimate video / sub-playlist URI
    result.push(mapUri(line));
  }

  return result.join('\n');
}

/**
 * Edge Proxy Endpoint:
 * Proxies .m3u8 manifests and media segments, rewriting URIs to bypass CORS and anti-hotlink protections.
 * Implements Ghost Proxy edge caching via Cloudflare Cache API for video segments.
 *
 * GET /api/proxy?url=<targetUrl>&referer=<referer>
 */
export const onRequest = async (context) => {
  const { request, waitUntil } = context;

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

    const isPlaylist =
      targetUrl.includes('.m3u8') ||
      parsedTarget.pathname.endsWith('.m3u8');

    // Ghost Proxy Edge Caching: Check Cloudflare Cache API for immutable segments
    // @ts-ignore
    const edgeCache = typeof caches !== 'undefined' && caches.default ? caches.default : null;
    if (edgeCache && !isPlaylist && request.method === 'GET' && !request.headers.get('range')) {
      const cachedRes = await edgeCache.match(request);
      if (cachedRes) {
        const hitHeaders = new Headers(cachedRes.headers);
        hitHeaders.set('X-Edge-Cache', 'HIT');
        hitHeaders.set('Access-Control-Allow-Origin', '*');
        return new Response(cachedRes.body, {
          status: cachedRes.status,
          headers: hitHeaders,
        });
      }
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

    const isUpstreamPlaylist =
      isPlaylist ||
      (upstreamRes.headers.get('content-type') || '').includes('mpegurl');

    const responseHeaders = new Headers();
    responseHeaders.set('Access-Control-Allow-Origin', '*');
    responseHeaders.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    responseHeaders.set('Access-Control-Allow-Headers', 'Range, Accept-Encoding');
    responseHeaders.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, X-Edge-Cache');

    const acceptRanges = upstreamRes.headers.get('accept-ranges');
    if (acceptRanges) responseHeaders.set('Accept-Ranges', acceptRanges);

    const contentLength = upstreamRes.headers.get('content-length');
    if (contentLength && !isUpstreamPlaylist) responseHeaders.set('Content-Length', contentLength);

    const contentRange = upstreamRes.headers.get('content-range');
    if (contentRange) responseHeaders.set('Content-Range', contentRange);

    if (isUpstreamPlaylist) {
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

    // Media segment or video stream: cache permanently at the edge (Ghost Proxy)
    const contentType = upstreamRes.headers.get('content-type') || 'video/mp2t';
    responseHeaders.set('Content-Type', contentType);
    responseHeaders.set('Cache-Control', 'public, max-age=31536000, s-maxage=31536000, immutable');
    responseHeaders.set('X-Edge-Cache', 'MISS');

    const finalResponse = new Response(upstreamRes.body, {
      status: upstreamRes.status,
      headers: responseHeaders,
    });

    // Asynchronously store segment in Cloudflare Edge Cache
    if (edgeCache && upstreamRes.status === 200 && request.method === 'GET' && !range) {
      const cacheClone = finalResponse.clone();
      const wait = typeof waitUntil === 'function' ? waitUntil : (context?.waitUntil?.bind(context));
      if (wait) {
        wait(edgeCache.put(request, cacheClone).catch(() => {}));
      }
    }

    return finalResponse;
  } catch (err) {
    return errorResponse(err);
  }
};
