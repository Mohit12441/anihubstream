/**
 * Cloudflare Worker HLS Proxy
 * Bypasses beta.cno.to Cloudflare WAF by omitting Origin, setting Referer & Desktop UA.
 * Rewrites .m3u8 playlists so nested playlists stay proxied, while media segments
 * on glowbulb.top remain direct absolute URLs (which have open CORS) to conserve worker execution.
 */

const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range',
};

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      ...CORS_HEADERS,
      'Access-Control-Max-Age': '86400',
    },
  });
}

async function handleProxyRequest({ request }) {
  const reqUrl = new URL(request.url);
  const targetUrl = reqUrl.searchParams.get('u');
  if (!targetUrl) {
    return new Response(JSON.stringify({ status: 'ok', service: 'anihubstream-hls-proxy' }), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  try {
    const parsedTarget = new URL(targetUrl);

    // If target is already on glowbulb.top, redirect directly to CDN (browser handles CORS)
    if (parsedTarget.hostname.includes('glowbulb.top')) {
      return Response.redirect(targetUrl, 302);
    }

    // Prepare upstream request - strictly NO Origin header to avoid beta.cno.to 403
    const upstreamHeaders = {
      'User-Agent': CHROME_UA,
      'Referer': `${parsedTarget.origin}/`,
      'Accept': '*/*',
    };

    const range = request.headers.get('range');
    if (range) {
      upstreamHeaders['Range'] = range;
    }

    const upstream = await fetch(targetUrl, {
      method: request.method,
      headers: upstreamHeaders,
    });

    if (!upstream.ok) {
      return new Response(upstream.body, {
        status: upstream.status,
        headers: {
          ...CORS_HEADERS,
          'Content-Type': upstream.headers.get('content-type') || 'text/plain',
        },
      });
    }

    const contentType = upstream.headers.get('content-type') || '';
    const isM3u8 = targetUrl.includes('.m3u8') || contentType.includes('mpegurl') || contentType.includes('application/x-mpegURL');

    // If not an m3u8 playlist, stream upstream body directly with CORS
    if (!isM3u8) {
      const respHeaders = new Headers(CORS_HEADERS);
      respHeaders.set('Content-Type', contentType || 'application/octet-stream');
      const cl = upstream.headers.get('content-length');
      if (cl) respHeaders.set('Content-Length', cl);
      const cr = upstream.headers.get('content-range');
      if (cr) respHeaders.set('Content-Range', cr);
      const ar = upstream.headers.get('accept-ranges');
      if (ar) respHeaders.set('Accept-Ranges', ar);
      respHeaders.set('Cache-Control', 'public, max-age=86400, immutable');

      return new Response(upstream.body, {
        status: upstream.status,
        headers: respHeaders,
      });
    }

    // For .m3u8 playlists: parse and rewrite playlist lines
    const text = await upstream.text();
    const proxyBase = `${reqUrl.origin}/api/test-proxy`;

    const rewritten = text
      .split('\n')
      .map((line) => {
        const trimmed = line.trim();
        if (!trimmed) return line;

        // Rewrite URI attributes in HLS tags (#EXT-X-MEDIA, #EXT-X-MAP, etc.)
        if (trimmed.startsWith('#')) {
          return line.replace(/URI="([^"]+)"/g, (match, uri) => {
            const abs = new URL(uri, targetUrl).href;
            // Only proxy m3u8 playlists through worker; leave direct segment CDNs intact
            if (abs.includes('.m3u8')) {
              return `URI="${proxyBase}?u=${encodeURIComponent(abs)}"`;
            }
            return `URI="${abs}"`;
          });
        }

        // Stream variant or playlist line
        const abs = new URL(trimmed, targetUrl).href;
        if (abs.includes('.m3u8')) {
          return `${proxyBase}?u=${encodeURIComponent(abs)}`;
        }
        // Direct media segment URL (e.g. glowbulb.top)
        return abs;
      })
      .join('\n');

    return new Response(rewritten, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
}

export async function onRequestGet(context) {
  return handleProxyRequest(context);
}

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') {
    return onRequestOptions();
  }
  return handleProxyRequest(context);
}
