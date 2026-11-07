// @ts-check
import { resolveTracks } from './anipm.mjs';

export default async function handler(req, res) {
  const u = new URL(req.url, 'http://127.0.0.1');
  const id = u.searchParams.get('id');
  const ep = u.searchParams.get('ep');

  if (!id || !ep) {
    res.writeHead(400, {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
    });
    return res.end(JSON.stringify({ error: 'id and ep required' }));
  }

  try {
    const data = await resolveTracks({
      anilistId: id,
      ep,
      lang: u.searchParams.get('lang') || 'sub',
      server: u.searchParams.get('server') || 'beta',
      refresh: u.searchParams.has('refresh'),
      slug: u.searchParams.get('slug'),
    });
    res.writeHead(200, {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
    });
    res.end(JSON.stringify(data));
  } catch (e) {
    res.writeHead(e.code ? 502 : 500, {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
    });
    res.end(JSON.stringify({ error: e.code || 'internal', detail: e.message }));
  }
}
