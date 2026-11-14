export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  const url = new URL(context.request.url);
  const target = url.searchParams.get('u');
  
  if (!target) {
    return new Response('Missing u parameter', {
      status: 400,
      headers: { 'Access-Control-Allow-Origin': '*' },
    });
  }

  // Route to your new Vercel proxy
  const VERCEL_URL = 'https://anipm-proxy.vercel.app/api/proxy'; 
  
  // Redirect the browser to Vercel
  return new Response(null, {
    status: 302,
    headers: {
      Location: `${VERCEL_URL}?url=${encodeURIComponent(target)}`,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    },
  });
}
