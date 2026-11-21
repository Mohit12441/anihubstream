// @ts-check
/**
 * Cloudflare Pages Function: /party-ws
 * Proxies WebSocket upgrades to upstream Stream Bridge Watch Party relay
 */
export async function onRequest(context) {
  const { request, env } = context;

  const upgradeHeader = request.headers.get('Upgrade');
  if (upgradeHeader !== 'websocket') {
    return new Response(JSON.stringify({ error: 'Expected WebSocket upgrade' }), {
      status: 426,
      headers: { 'content-type': 'application/json' },
    });
  }

  const bridgeBase = env.STREAM_BRIDGE_URL || 'http://127.0.0.1:8795';
  try {
    const url = new URL(request.url);
    const targetUrl = new URL(`/party-ws${url.search}`, bridgeBase);

    // Forward WebSocket upgrade request to Stream Bridge
    return await fetch(targetUrl.toString(), {
      method: request.method,
      headers: request.headers,
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Stream bridge relay offline', detail: String(err) }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    });
  }
}
