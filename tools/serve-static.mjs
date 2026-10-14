import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', 'dist-pages');
const PORT = Number(process.env.PORT || 8787);

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

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
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
  console.log(`anihub frontend: http://127.0.0.1:${PORT} root=${ROOT}`)
);
