export async function onRequestGet({ request }) {
  const u = new URL(request.url).searchParams.get('u');
  if (!u) return new Response('missing u parameter', { status: 400 });

  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

  try {
    // We are forcing the datacenter Worker to pretend it is ani.pm
    const upstream = await fetch(u, {
      headers: {
        'User-Agent': UA,
        Origin: 'https://ani.pm',
        Referer: 'https://ani.pm/',
        Accept: '*/*',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'cross-site',
      },
    });

    const status = upstream.status;
    const body = await upstream.text();
    
    return new Response(JSON.stringify({
      status: status,
      isCloudflareChallenge: upstream.headers.get('cf-mitigated') === 'challenge',
      contentType: upstream.headers.get('content-type'),
      preview: body.substring(0, 300) // First 300 chars to see if it's a video or an HTML block page
    }, null, 2), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
