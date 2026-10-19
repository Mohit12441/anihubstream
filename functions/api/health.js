export async function onRequestGet({ request }) {
  return new Response(
    JSON.stringify({
      status: 'healthy',
      service: 'anihubstream-edge',
      timestamp: new Date().toISOString(),
      uptime: process.uptime ? process.uptime() : 0,
      edge: true
    }),
    {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store'
      }
    }
  );
}
