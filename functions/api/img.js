// functions/api/img.js
// Edge image proxy with automatic S3 signed URL normalization,
// immutable edge caching (30 days), and upstream domain safety checks.

export async function onRequestGet(context) {
  const { request } = context;
  const url = new URL(request.url);
  const target = url.searchParams.get('url');

  if (!target) {
    return new Response('Missing target image URL', { status: 400 });
  }

  let cleanTarget = target.trim();
  // Normalize backblazeb2 signed URLs to permanent media.kitsu.app URLs
  if (cleanTarget.includes('backblazeb2.com')) {
    try {
      const u = new URL(cleanTarget);
      cleanTarget = `https://media.kitsu.app${u.pathname}`;
    } catch {}
  }

  // Strip WordPress Jetpack CDN wrapper (i0.wp.com / i1.wp.com / i2.wp.com) which aggressively rate limits edge proxies
  if (/^https?:\/\/i\d+\.wp\.com\//i.test(cleanTarget)) {
    try {
      const u = new URL(cleanTarget);
      const rawPath = u.pathname.replace(/^\/+/, '');
      cleanTarget = `https://${rawPath}`;
    } catch {}
  }


  // Only allow proxying from trusted anime CDNs and integrated streaming providers
  const allowed = [
    'media.kitsu.app',
    's4.anilist.co',
    'cdn.myanimelist.net',
    'kitsu.io',
    'kitsu-production-media.s3.us-west-002.backblazeb2.com',
    'aniwatch.co.at',
    'wp.com',
    'blogger.googleusercontent.com',
    'googleusercontent.com',
  ];


  try {
    const targetUrl = new URL(cleanTarget);
    if (!allowed.some((domain) => targetUrl.hostname === domain || targetUrl.hostname.endsWith(`.${domain}`))) {
      return new Response('Forbidden upstream image domain', { status: 403 });
    }

    const upstreamResponse = await fetch(cleanTarget, {
      headers: {
        'User-Agent': 'AniHubStream Image Proxy (https://anihubstream.com)',
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      },
    });

    if (!upstreamResponse.ok) {
      return new Response('Upstream image fetch failed', { status: upstreamResponse.status });
    }

    const contentType = upstreamResponse.headers.get('content-type') || 'image/jpeg';
    const response = new Response(upstreamResponse.body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=2592000, s-maxage=2592000, immutable',
        'Access-Control-Allow-Origin': '*',
      },
    });

    return response;
  } catch (err) {
    return new Response(`Proxy error: ${err.message}`, { status: 502 });
  }
}
