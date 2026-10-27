import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', 'dist-pages');
const PORT = Number(process.env.PORT || 8787);

/* The bundle talks to same-origin /api, and this machine does not run Pages Functions — so
   without a forwarder, every page served through the tunnel (app.anihubstream.com) shows the
   catalogue error while the deployed site works fine. The upstream is a fixed constant, never
   derived from the request, so this cannot be pointed anywhere else.
   ANIHUB_API_UPSTREAM='' turns the forwarder off. */
const API_UPSTREAM = (process.env.ANIHUB_API_UPSTREAM ?? 'https://anihubstream.com').replace(/\/+$/, '');
const UPSTREAM_ORIGIN = API_UPSTREAM ? new URL(API_UPSTREAM).origin : '';
const API_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']);
const FORWARD_REQ = ['content-type', 'accept', 'accept-language', 'cookie', 'user-agent'];
const FORWARD_RES = ['content-type', 'cache-control', 'vary', 'set-cookie', 'location'];
const API_BODY_CAP = 64 * 1024;
const UPSTREAM_TIMEOUT_MS = 25_000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
};

const send = (res, status, body, type) => {
  res.writeHead(status, {
    'content-type': type,
    'content-length': body.length,
    'cache-control': status === 200 ? 'public, max-age=300' : 'no-store',
  });
  res.end(body);
};

const readBody = (req, cap) =>
  new Promise((done, fail) => {
    const chunks = [];
    let size = 0;
    let tooBig = false;
    /* Past the cap the rest is dropped but still drained: destroying the request would reset the
       socket, and a client that sent too much is owed a 413 rather than a broken connection. */
    req.on('data', (c) => {
      size += c.length;
      if (size > cap) {
        tooBig = true;
        chunks.length = 0;
        return;
      }
      if (!tooBig) chunks.push(c);
    });
    req.on('end', () => (tooBig ? fail({ tooBig: true }) : done(chunks.length ? Buffer.concat(chunks) : null)));
    req.on('error', fail);
  });

/* A redirect must keep somewhere to go: without Location the viewer gets a 302 and sits. A
   Location that names the upstream would bounce them off the host they came in on, so inside the
   upstream it becomes path-only and the browser re-asks it against the host it already trusts. */
const redirectToPath = (raw) => {
  let target;
  try {
    target = new URL(raw, API_UPSTREAM);
  } catch {
    return raw;
  }
  return target.origin === UPSTREAM_ORIGIN ? target.pathname + target.search : raw;
};

/* An /api request cannot be answered here: Pages Functions only run on Cloudflare. Rather than
   let the tunnel serve index.html in its place — which the bundle reads as a JSON parse error —
   hand the request to the deployed API and relay the reply untouched. */
const forwardApi = async (req, res, url) => {
  const head = req.method === 'HEAD';
  let body = null;
  if (!head && req.method !== 'GET') {
    try {
      body = await readBody(req, API_BODY_CAP);
    } catch {
      send(res, 413, Buffer.from('{"error":"too_large"}'), 'application/json; charset=utf-8');
      return;
    }
  }

  const headers = {};
  for (const name of FORWARD_REQ) {
    const value = req.headers[name];
    if (value !== undefined) headers[name] = value;
  }

  try {
    /* HEAD is asked of the upstream as a GET: the Functions only route GET, so a HEAD that stays
       a HEAD falls through to the catch-all and reports 404 for a document that exists. The body
       a GET brings back is dropped, because a HEAD answer is headers only. */
    const upstream = await fetch(API_UPSTREAM + url.pathname + url.search, {
      method: head ? 'GET' : req.method,
      headers,
      body: head || req.method === 'GET' ? undefined : body ?? undefined,
      redirect: 'manual',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    const reply = {};
    for (const name of FORWARD_RES) {
      if (name === 'location') {
        const raw = upstream.headers.get('location');
        if (raw) reply.location = redirectToPath(raw);
        continue;
      }
      const value =
        name === 'set-cookie' ? upstream.headers.getSetCookie() : upstream.headers.get(name);
      if (value && value.length) reply[name] = value;
    }
    // A viewer must never cache a response carrying someone else's session cookie.
    if (reply['set-cookie']) reply['cache-control'] = 'no-store';
    if (head) await upstream.body?.cancel().catch(() => {});
    res.writeHead(upstream.status, reply);
    res.end(head ? undefined : Buffer.from(await upstream.arrayBuffer()));
  } catch (err) {
    console.error('[anihub] /api forward failed:', err?.message ?? err);
    res.writeHead(502, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end('{"error":"upstream"}');
  }
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (API_UPSTREAM && (url.pathname === '/api' || url.pathname.startsWith('/api/'))) {
    if (!API_METHODS.has(req.method)) {
      send(res, 405, Buffer.from('{"error":"method_not_allowed"}'), 'application/json; charset=utf-8');
      return;
    }
    await forwardApi(req, res, url);
    return;
  }
  const ext = extname(url.pathname);
  // Only unpathed routes fall through to the SPA; a missing asset must 404, not serve HTML.
  const candidates = [resolve(ROOT, '.' + decodeURIComponent(url.pathname))];
  if (!ext) candidates.push(resolve(ROOT, 'index.html'));

  for (const file of candidates) {
    if (file !== ROOT && !file.startsWith(ROOT + sep)) {
      send(res, 403, Buffer.from('forbidden'), 'text/plain; charset=utf-8');
      return;
    }
    try {
      const body = await readFile(file);
      send(res, 200, body, MIME[extname(file)] || 'application/octet-stream');
      return;
    } catch {
      /* try the next candidate */
    }
  }
  send(res, 404, Buffer.from('not found'), 'text/plain; charset=utf-8');
});

// 127.0.0.1 on purpose: cloudflared talks to this locally, the LAN never sees it.
server.listen(PORT, '127.0.0.1', () =>
  console.log(
    `anihub frontend: http://127.0.0.1:${PORT} root=${ROOT}` +
      (API_UPSTREAM ? ` api->${API_UPSTREAM}` : ' api=disabled')
  )
);
