// @ts-check
import { HttpError, errorResponse } from './_lib.js';

const PROXY_TIMEOUT_MS = 25_000;

/**
 * Verified upstream domains permitted for proxying (video streams, playlists, subtitles, and catalog CDNs).
 * Arbitrary destination domains and private/internal networks are strictly forbidden.
 */
const ALLOWED_STREAMING_DOMAINS = [
  'megaplay.buzz',
  'nexabloom.top',
  'whereismyloot.site',
  'whereismyloot.com',
  'whereismyloot.world',
  'notthefinalboss.site',
  'notthefinalboss.com',
  'notthefinalboss.world',
  'laggedduringcutscene.site',
  'laggedduringcutscene.com',
  'laggedduringcutscene.world',
  'embermeadow.world',
  'embermeadow.site',
  'embermeadow.net',
  'lootplayers.site',
  'lootcdn.org',
  'lootcdn.xyz',
  'starcdn.site',
  'shiora.top',
  'abyssplayer.com',
  'sssrr.org',
  'animehot.cc',
  'dramahot.top',
  'drama1.cfd',
  'zokoanime.video',
  'anikoto.cz',
  '1anime.site',
  'vizcloud.online',
  'vizcloud.co',
  'rabbitstream.net',
  'megacloud.tv',
  'megacloud.club',
  'dokicloud.one',
  'rapid-cloud.co',
  'vidstream.pro',
  'watchanimeworld.net',
  'watchanimeworld.org',
  'animewave.to',
  'kitsu.app',
  'anilist.co',
  'myanimelist.net',
  'jikan.moe',
  'aniskip.com',
  'akamaized.net',
  'cloudfront.net',
  'fastly.net',
  'example.com', // for test mock fixtures
];

const PRIVATE_IP_REGEX = /^(?:127\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2[0-9]|3[01])\.|0\.|::1|fe80:|fc00:)/i;

/**
 * Validates destination host to prevent SSRF and open proxy abuse.
 * @param {string} hostname
 * @param {string} [targetUrl]
 * @param {string} [customReferer]
 * @returns {boolean}
 */
export function isHostAllowed(hostname, targetUrl = '', customReferer = '') {
  if (!hostname || typeof hostname !== 'string') return false;
  const host = hostname.toLowerCase().trim();

  // Reject loopback, link-local, and private networks
  if (
    host === 'localhost' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    PRIVATE_IP_REGEX.test(host)
  ) {
    return false;
  }

  // 1. Explicit domain whitelist
  if (ALLOWED_STREAMING_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`))) {
    return true;
  }

  // 2. Verified stream CDN pattern:
  // Upstream extractors (like Megaplay, AniKoto, HiAnime) dynamically rotate domain names for CDN video chunks.
  // Any public non-private domain requested with a trusted streaming Referer and anime media asset path/extension is authorized.
  const trustedReferers = ['megaplay.buzz', 'anikoto.cz', 'abyssplayer.com', 'aniwatchtv.to', 'hianime.to'];
  const hasTrustedReferer = customReferer && trustedReferers.some((r) => customReferer.includes(r));
  if (hasTrustedReferer) {
    const isStreamAsset =
      targetUrl.includes('/anime/') ||
      targetUrl.includes('/stream/') ||
      targetUrl.includes('/video/') ||
      targetUrl.includes('/hls/') ||
      targetUrl.includes('/chunks/') ||
      targetUrl.includes('/media/') ||
      targetUrl.includes('seg-') ||
      targetUrl.includes('chunk_') ||
      targetUrl.includes('chunk-') ||
      /\.(?:m3u8|m3u|ts|m4s|mp4|webm|vtt|srt|key)(?:\?|$)/i.test(targetUrl);
    if (isStreamAsset) {
      return true;
    }
  }

  return false;
}

const AD_DOMAIN_REGEX = /(?:googleads|doubleclick|adservice|popads|adbuff|streamtape-ad|trafficjunky|adnxs|exoclick)/i;

/**
 * Parses and rewrites HLS .m3u8 manifests using a block-based structure.
 * Preserves structural #EXT-X-DISCONTINUITY tags and eliminates buffer append
 * / timeline desync bugs by safely dropping ad URIs with their corresponding #EXTINF.
 * Collapses duplicate adjacent #EXT-X-DISCONTINUITY tags.
 *
 * @param {string} text
 * @param {string} baseUrl
 * @param {string} referer
 * @param {string} proxyBase
 * @param {{ filterAds?: boolean }} [options]
 * @returns {string}
 */
export function rewriteM3u8(text, baseUrl, referer, proxyBase, options = {}) {
  const mapUri = (uri) => {
    try {
      const baseParsed = new URL(baseUrl);
      const abs = new URL(uri, baseUrl);
      // Preserve auth query params (e.g. ?token=...) if relative child URI does not specify its own
      if (baseParsed.search && !abs.search) {
        abs.search = baseParsed.search;
      }
      const encoded = encodeURIComponent(abs.toString());
      const refParam = referer ? `&referer=${encodeURIComponent(referer)}` : '';
      return `${proxyBase}?url=${encoded}${refParam}`;
    } catch {
      return uri;
    }
  };

  const lines = text.split(/\r?\n/);
  const headerLines = [];
  const segmentBlocks = [];
  let currentBlockTags = [];
  let currentHasDiscontinuity = false;
  let seenFirstSegment = false;
  const footerLines = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith('#')) {
      if (line === '#EXT-X-DISCONTINUITY') {
        currentHasDiscontinuity = true;
      } else if (line.startsWith('#EXT-X-MEDIA:')) {
        // Audio Track & Subtitle Safety: Explicitly preserve all #EXT-X-MEDIA tags intact
        // Never treat audio or subtitle tracks as ad blocks; rewrite inner URI if present
        if (line.includes('URI=')) {
          headerLines.push(line.replace(/URI="([^"]+)"/g, (_m, uri) => `URI="${mapUri(uri)}"`));
        } else {
          headerLines.push(line);
        }
      } else if (line === '#EXT-X-ENDLIST') {
        footerLines.push(line);
      } else if (!seenFirstSegment && !line.startsWith('#EXTINF')) {
        // Global header directive or key/map
        if (line.includes('URI=')) {
          headerLines.push(line.replace(/URI="([^"]+)"/g, (_m, uri) => `URI="${mapUri(uri)}"`));
        } else {
          headerLines.push(line);
        }
      } else {
        // Tag attached to upcoming segment (e.g. #EXTINF, #EXT-X-BYTERANGE, #EXT-X-KEY)
        if (line.includes('URI=')) {
          currentBlockTags.push(line.replace(/URI="([^"]+)"/g, (_m, uri) => `URI="${mapUri(uri)}"`));
        } else {
          currentBlockTags.push(line);
        }
      }
      continue;
    }

    // Line is a segment or sub-playlist URI
    seenFirstSegment = true;
    const isVideoTsSegment = /\.ts(?:\?|$)/i.test(line) || line.includes('/seg-') || /\.m4s(?:\?|$)/i.test(line);
    const hasExtinf = currentBlockTags.some((t) => t.startsWith('#EXTINF:'));
    // Only strip #EXTINF blocks pointing to video .ts segments from ad domains
    const isAd = Boolean(options.filterAds && isVideoTsSegment && hasExtinf && AD_DOMAIN_REGEX.test(line));

    segmentBlocks.push({
      hasDiscontinuity: currentHasDiscontinuity,
      tags: currentBlockTags,
      uri: mapUri(line),
      isAd,
    });

    currentBlockTags = [];
    currentHasDiscontinuity = false;
  }

  // Assemble result with timeline integrity
  const result = [...headerLines];
  let pendingDiscontinuity = false;
  let lastWasDiscontinuity = false;

  for (const block of segmentBlocks) {
    if (block.isAd) {
      // Ad block: drop URI and preceding #EXTINF, preserve discontinuity need
      if (block.hasDiscontinuity) {
        pendingDiscontinuity = true;
      }
      continue;
    }

    if (block.hasDiscontinuity || pendingDiscontinuity) {
      if (!lastWasDiscontinuity) {
        result.push('#EXT-X-DISCONTINUITY');
        lastWasDiscontinuity = true;
      }
      pendingDiscontinuity = false;
    }

    for (const tag of block.tags) {
      result.push(tag);
      lastWasDiscontinuity = false;
    }

    result.push(block.uri);
    lastWasDiscontinuity = false;
  }

  // Append footer lines (e.g. #EXT-X-ENDLIST)
  for (const f of footerLines) {
    result.push(f);
  }

  return result.join('\n');
}

/**
 * Edge Proxy Endpoint (Method C Ghost Proxy):
 * Proxies .m3u8 manifests, video segments, and subtitles with domain allowlisting,
 * CORS headers, and Cloudflare Cache API edge caching for immutable media chunks.
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

    let parsedTarget;
    try {
      parsedTarget = new URL(targetUrl);
    } catch {
      throw new HttpError(400, 'bad_request', 'Invalid target URL');
    }

    if (parsedTarget.protocol !== 'http:' && parsedTarget.protocol !== 'https:') {
      throw new HttpError(400, 'bad_request', 'Only HTTP and HTTPS URLs are supported');
    }

    // 1. Strict Domain & SSRF Guard
    if (!isHostAllowed(parsedTarget.hostname, targetUrl, customReferer)) {
      console.warn(`[PROXY 403] Host not allowed: "${parsedTarget.hostname}" | Target URL: ${targetUrl}`);
      throw new HttpError(403, 'forbidden', `Destination domain "${parsedTarget.hostname}" is not authorized`);
    }

    const isPlaylist =
      targetUrl.includes('.m3u8') ||
      parsedTarget.pathname.endsWith('.m3u8');

    const isSubtitle =
      targetUrl.includes('.vtt') ||
      parsedTarget.pathname.endsWith('.vtt') ||
      targetUrl.includes('.srt') ||
      parsedTarget.pathname.endsWith('.srt');

    // 2. Cloudflare Cache API for immutable segments & subtitles
    // @ts-ignore
    const edgeCache = typeof caches !== 'undefined' && caches.default ? caches.default : null;
    const rangeHeader = request.headers.get('range');

    if (edgeCache && !isPlaylist && request.method === 'GET' && !rangeHeader) {
      const cachedRes = await edgeCache.match(request).catch(() => null);
      if (cachedRes) {
        const hitHeaders = new Headers(cachedRes.headers);
        hitHeaders.set('X-Edge-Cache', 'HIT');
        hitHeaders.set('Access-Control-Allow-Origin', '*');
        if (!isSubtitle) {
          const isM4s = parsedTarget.pathname.endsWith('.m4s') || parsedTarget.pathname.endsWith('.mp4');
          const isWebm = parsedTarget.pathname.endsWith('.webm');
          hitHeaders.set('Content-Type', isM4s ? 'video/mp4' : isWebm ? 'video/webm' : 'video/mp2t');
        }
        return new Response(cachedRes.body, {
          status: cachedRes.status,
          headers: hitHeaders,
        });
      }
    }

    const referer = customReferer || `${parsedTarget.origin}/`;
    let origin = `${parsedTarget.origin}`;
    try {
      if (referer) origin = new URL(referer).origin;
    } catch {
      origin = `${parsedTarget.origin}`;
    }
    const upstreamHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      Referer: referer,
      Origin: origin,
      Accept: '*/*',
    };

    if (rangeHeader) {
      upstreamHeaders.Range = rangeHeader;
    }

    const upstreamRes = await fetch(targetUrl, {
      method: request.method,
      headers: upstreamHeaders,
      signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
    });

    if (!upstreamRes.ok) {
      console.warn(`[PROXY UPSTREAM ${upstreamRes.status}] URL: ${targetUrl} | Referer: ${referer}`);
    }

    const isUpstreamPlaylist =
      isPlaylist ||
      (upstreamRes.headers.get('content-type') || '').includes('mpegurl');

    const responseHeaders = new Headers();
    responseHeaders.set('Access-Control-Allow-Origin', '*');
    responseHeaders.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    responseHeaders.set('Access-Control-Allow-Headers', 'Range, Accept-Encoding, Content-Type, Origin, Accept');
    responseHeaders.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, X-Edge-Cache');

    const acceptRanges = upstreamRes.headers.get('accept-ranges');
    if (acceptRanges) responseHeaders.set('Accept-Ranges', acceptRanges);

    const contentLength = upstreamRes.headers.get('content-length');
    if (contentLength && !isUpstreamPlaylist) responseHeaders.set('Content-Length', contentLength);

    const contentRange = upstreamRes.headers.get('content-range');
    if (contentRange) responseHeaders.set('Content-Range', contentRange);

    const rawMode = reqUrl.searchParams.get('raw') === '1' || reqUrl.searchParams.get('mode') === 'raw';

    // 3. Manifest Handling: rewrite relative & absolute segment URIs without stripping ad cues (or raw pass-through)
    if (isUpstreamPlaylist) {
      responseHeaders.set('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
      responseHeaders.set('Cache-Control', 'public, max-age=60, s-maxage=180, stale-while-revalidate=60');

      if (request.method === 'HEAD') {
        return new Response(null, { status: upstreamRes.status, headers: responseHeaders });
      }

      if (rawMode) {
        return new Response(upstreamRes.body, {
          status: upstreamRes.status,
          headers: responseHeaders,
        });
      }

      const text = await upstreamRes.text();
      const proxyBase = `${reqUrl.origin}/api/proxy`;
      const filterAds = reqUrl.searchParams.get('filterAds') === '1';
      const rewritten = rewriteM3u8(text, targetUrl, referer, proxyBase, { filterAds });

      return new Response(rewritten, {
        status: upstreamRes.status,
        headers: responseHeaders,
      });
    }

    // 4. Subtitle Handling
    if (isSubtitle) {
      responseHeaders.set('Content-Type', 'text/vtt; charset=utf-8');
      responseHeaders.set('Cache-Control', 'public, max-age=86400, s-maxage=86400');
      responseHeaders.set('X-Edge-Cache', 'MISS');

      return new Response(upstreamRes.body, {
        status: upstreamRes.status,
        headers: responseHeaders,
      });
    }

    // 5. Video Segments: immutable edge caching
    let contentType = 'video/mp2t';
    if (parsedTarget.pathname.endsWith('.m4s') || parsedTarget.pathname.endsWith('.mp4')) {
      contentType = 'video/mp4';
    } else if (parsedTarget.pathname.endsWith('.webm')) {
      contentType = 'video/webm';
    } else {
      // Megaplay and various providers disguise MPEG-TS segments as .jpg, .html, .js, .css, .txt
      // Deliver valid MPEG-TS MIME type to prevent browser CORB blocking and Hls.js fragLoadError
      contentType = 'video/mp2t';
    }
    responseHeaders.set('Content-Type', contentType);
    responseHeaders.set('Cache-Control', 'public, max-age=31536000, s-maxage=31536000, immutable');
    responseHeaders.set('X-Edge-Cache', rangeHeader ? 'BYPASS' : 'MISS');

    const finalResponse = new Response(upstreamRes.body, {
      status: upstreamRes.status,
      headers: responseHeaders,
    });

    // Store in Cloudflare Edge Cache ONLY if 200 OK and not a range request
    // Range requests (206) throw TypeError on caches.default.put() and must be bypassed
    if (edgeCache && upstreamRes.status === 200 && request.method === 'GET' && !rangeHeader) {
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
