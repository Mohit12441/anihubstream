export async function onRequestGet() {
  return new Response('9f8b2c4e1a7d3f5b8a0c6e4d2f1a9b7c', {
    status: 200,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=86400, s-maxage=604800',
    },
  });
}
