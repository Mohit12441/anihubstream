// Offline pins for the tunnel origin's /api forwarder (`tools/serve-static.mjs`).
//
// Why this needs pinning: the bundle talks to same-origin /api, and Pages Functions only run on
// Cloudflare. Without a forwarder the origin answers /api from `_redirects`-style SPA fallback —
// HTTP 200 with index.html — so every visitor through app.anihubstream.com gets
// "the catalogue service answered 200 without JSON" while the deployed site looks healthy. That
// failure is invisible from the source file, which is exactly what these tests are for.
//
// The upstream here is a local mock, never anihubstream.com: what is being pinned is the proxy's
// own contract (what it relays, what it drops, what it rewrites), and a test that reached the live
// API could not assert a 302, a dead upstream or a 70 KB body on demand.
//
// Groups:
//   1 relay      the request and response halves of the contract
//   2 refusals   what the origin answers itself, without a socket
//   3 fallback   non-/api paths and ANIHUB_API_UPSTREAM='' keep serving files
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const SERVER = resolve(ROOT, 'tools', 'serve-static.mjs');

/** A port nobody holds, for the child to bind and for the dead-upstream case to target. */
const freePort = async () => {
  const srv = createServer();
  srv.listen(0, '127.0.0.1');
  await once(srv, 'listening');
  const { port } = srv.address();
  srv.close();
  await once(srv, 'close');
  return port;
};

/** @type {{method:string,url:string,headers:Record<string,string|string[]|undefined>,body:string}[]} */
const seen = [];
let upstream;
let upstreamUrl = '';

const reply = (res, status, headers, body) => {
  res.writeHead(status, headers);
  res.end(body);
};

const startUpstream = async () => {
  const srv = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      seen.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      });
      const path = req.url.split('?')[0];
      if (path === '/api/anime') return reply(res, 200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=60', vary: 'Cookie' }, '{"results":[]}');
      if (path === '/api/moved') return reply(res, 302, { location: '/api/anime', 'cache-control': 'no-store' }, 'see elsewhere');
      if (path === '/api/elsewhere') return reply(res, 302, { location: 'https://other.example/x' }, 'off-site hop');
      if (path === '/api/gone') return reply(res, 404, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, '{"error":"not_found"}');
      if (path === '/api/save') return reply(res, 200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=60', 'set-cookie': 'anihub_viewer=abc; Path=/; HttpOnly' }, '{"saved":true}');
      return reply(res, 200, { 'content-type': 'application/json' }, '{"ok":true}');
    });
  });
  srv.listen(0, '127.0.0.1');
  await once(srv, 'listening');
  upstream = srv;
  upstreamUrl = `http://127.0.0.1:${srv.address().port}`;
};

/** @param {Record<string,string>} env */
const startOrigin = async (env) => {
  const port = env.PORT;
  const proc = spawn(process.execPath, [SERVER], {
    cwd: ROOT,
    env: { ...process.env, ANIHUB_API_UPSTREAM: upstreamUrl, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let noise = '';
  proc.stderr.on('data', (c) => { noise += String(c); });
  const until = Date.now() + 10_000;
  for (;;) {
    if (proc.exitCode !== null) throw new Error(`origin exited ${proc.exitCode}: ${noise}`);
    try {
      await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(500) });
      break;
    } catch {
      if (Date.now() > until) throw new Error(`origin did not bind :${port} — ${noise || 'no output'}`);
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  return { proc, base: `http://127.0.0.1:${port}`, port };
};

const origins = [];
const withOrigin = async (env) => {
  const o = await startOrigin(env);
  origins.push(o);
  return o;
};

before(async () => {
  await startUpstream();
});

after(() => {
  for (const o of origins) o.proc.kill();
  upstream?.close();
});

/** The last request the mock saw, as the origin left it. */
const lastHop = () => seen[seen.length - 1];

describe('1. what the forwarder relays', () => {
  let origin;
  before(async () => { origin = await withOrigin({ PORT: String(await freePort()) }); });

  it('answers /api with the upstream JSON, status and headers — never with index.html', async () => {
    const res = await fetch(`${origin.base}/api/anime?limit=2&sort=rating`);
    const text = await res.text();
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/json; charset=utf-8', 'a 200 that is not JSON is the bug this file exists to stop');
    assert.equal(text, '{"results":[]}');
    assert.equal(res.headers.get('cache-control'), 'public, max-age=60', 'the upstream cache lifetime survives');
    assert.match(String(res.headers.get('vary')), /Cookie/);
    assert.equal(lastHop().url, '/api/anime?limit=2&sort=rating', 'the query reaches the API untouched');
  });

  it('keeps a percentage-encoded path and query intact', async () => {
    await fetch(`${origin.base}/api/anime?q=%E8%91%AC%E9%80%81%20no%2Fslash`);
    assert.equal(lastHop().url, '/api/anime?q=%E8%91%AC%E9%80%81%20no%2Fslash', 'a Japanese query must not arrive folded or double-decoded');
  });

  it('carries the viewer cookie and JSON body to the API, which is how My List survives', async () => {
    await fetch(`${origin.base}/api/save`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: 'anihub_viewer=abc', accept: 'application/json', 'accept-language': 'en-GB' },
      body: JSON.stringify({ animeId: 'sousou-no-frieren' }),
    });
    const hop = lastHop();
    assert.equal(hop.method, 'POST');
    assert.deepEqual(JSON.parse(hop.body), { animeId: 'sousou-no-frieren' });
    assert.equal(hop.headers.cookie, 'anihub_viewer=abc');
    assert.equal(hop.headers['content-type'], 'application/json');
    assert.equal(hop.headers['accept-language'], 'en-GB');
  });

  it('relays Set-Cookie in full and strips the cache off a response that hands out a session', async () => {
    const res = await fetch(`${origin.base}/api/save`);
    assert.deepEqual(res.headers.getSetCookie(), ['anihub_viewer=abc; Path=/; HttpOnly'], 'every cookie of a multi-cookie reply');
    assert.equal(res.headers.get('cache-control'), 'no-store', 'public, max-age=60 would store someone else\'s viewer id');
  });

  it('answers HEAD from the GET route, with the headers and no body', async () => {
    const res = await fetch(`${origin.base}/api/anime`, { method: 'HEAD' });
    assert.equal(res.status, 200, 'the Functions do not route HEAD, so forwarding HEAD as HEAD reports 404 for a live document');
    assert.equal(res.headers.get('content-type'), 'application/json; charset=utf-8');
    assert.equal((await res.arrayBuffer()).byteLength, 0, 'a HEAD reply carries no body');
    assert.equal(lastHop().method, 'GET', 'the upstream was asked with the method it actually serves');
  });

  it('keeps the upstream Host rather than the tunnel hostname, so the API routes the request', async () => {
    await fetch(`${origin.base}/api/anime`, {
      headers: { host: 'app.anihubstream.com', referer: 'https://app.anihubstream.com/watch/x', 'x-forwarded-for': '203.0.113.7' },
    });
    const hop = lastHop();
    assert.equal(hop.headers.host, `127.0.0.1:${upstream.address().port}`, 'the API call is addressed to the upstream, as any proxy\'s is');
    assert.equal(hop.headers.referer, undefined, 'the page the viewer came from is not part of an API call');
    assert.equal(hop.headers['x-forwarded-for'], undefined, 'a header the tunnel adds is not the API\'s business');
  });

  it('relays a redirect with somewhere to go, on the host the viewer used', async () => {
    const res = await fetch(`${origin.base}/api/moved`, { redirect: 'manual' });
    assert.equal(res.status, 302, 'a 302 without a Location leaves the visitor sitting on a response that goes nowhere');
    assert.equal(res.headers.get('location'), '/api/anime', 'a Location naming the upstream would bounce the visitor off the tunnel host');
    const off = await fetch(`${origin.base}/api/elsewhere`, { redirect: 'manual' });
    assert.equal(off.headers.get('location'), 'https://other.example/x', 'a hop to another host is the upstream\'s business, so it passes through');
  });

  it('passes an error status through as JSON, so the client can act on it', async () => {
    const res = await fetch(`${origin.base}/api/gone`);
    assert.equal(res.status, 404);
    assert.equal(await res.text(), '{"error":"not_found"}');
  });

  it('answers 502 JSON when the upstream cannot be reached at all', async () => {
    const down = await withOrigin({ PORT: String(await freePort()), ANIHUB_API_UPSTREAM: `http://127.0.0.1:${await freePort()}` });
    const res = await fetch(`${down.base}/api/anime`);
    assert.equal(res.status, 502);
    assert.equal(res.headers.get('content-type'), 'application/json; charset=utf-8');
    assert.deepEqual(await res.json(), { error: 'upstream' });
    assert.equal(res.headers.get('cache-control'), 'no-store', 'a failure must not be cached by the tunnel');
  });
});

describe('2. what the origin refuses before any socket opens', () => {
  let origin;
  before(async () => { origin = await withOrigin({ PORT: String(await freePort()) }); });

  it('refuses a method the API does not speak with 405 JSON', async () => {
    const before_ = seen.length;
    const res = await fetch(`${origin.base}/api/anime`, { method: 'OPTIONS' });
    assert.equal(res.status, 405);
    assert.match(await res.text(), /method_not_allowed/);
    assert.equal(seen.length, before_, 'a method nobody supports is not the API\'s problem');
  });

  it('refuses a body past the cap with 413 instead of forwarding it or dropping the connection', async () => {
    const res = await fetch(`${origin.base}/api/save`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'x'.repeat(70 * 1024),
    });
    assert.equal(res.status, 413);
    assert.equal(await res.text(), '{"error":"too_large"}');
    const after = await fetch(`${origin.base}/api/anime`);
    assert.equal(after.status, 200, 'the server is still serving after an oversized request');
  });
});

describe('3. what must keep being files', () => {
  let origin;
  before(async () => { origin = await withOrigin({ PORT: String(await freePort()) }); });

  it('does not touch a non-/api path, however it is spelled', async () => {
    const before_ = seen.length;
    for (const path of ['/apikeeps-going', '/apifoo', '/not-a-real-file-9e1c.txt', '/watch/sousou-no-frieren?ep=1']) {
      const res = await fetch(`${origin.base}${path}`, { redirect: 'manual' });
      assert.ok([200, 404].includes(res.status), `${path} answered ${res.status}`);
      assert.doesNotMatch(res.headers.get('content-type') ?? '', /^application\/json/, `${path} is not the API`);
    }
    assert.equal(seen.length, before_, 'only /api and /api/* reach the upstream');
  });

  it('serves the SPA itself when the forwarder is turned off', async () => {
    const off = await withOrigin({ PORT: String(await freePort()), ANIHUB_API_UPSTREAM: '' });
    const before_ = seen.length;
    const res = await fetch(`${off.base}/api/anime`);
    assert.equal(seen.length, before_, 'with no upstream configured nothing is forwarded');
    assert.ok([200, 404].includes(res.status), `the origin still answers, with ${res.status}`);
    assert.doesNotMatch(res.headers.get('content-type') ?? '', /^application\/json/);
  });
});
