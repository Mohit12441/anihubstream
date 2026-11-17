import { createHash } from 'node:crypto';

const BASE = 'https://hdrezka.ag';
export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const NAMES = [
  'techaro.lol-anubis-auth',
  'within.website-x-cmd-anubis-auth',
  'within.website-cmd-anubis-auth',
  'anubis-auth',
];
const PASS = [
  '/.within.website/x/cmd/anubis/api/pass-challenge',
  '/api/pass-challenge',
];
const sha256 = (s) => createHash('sha256').update(s).digest('hex');

export function solve(challenge, difficulty, capMs = 300_000) {
  const prefix = '0'.repeat(difficulty);
  const t0 = Date.now();
  for (let nonce = 0; ; nonce++) {
    const hash = sha256(challenge + nonce);
    if (hash.startsWith(prefix)) return { nonce, hash, elapsed: Date.now() - t0 };
    if (Date.now() - t0 > capMs) throw new Error('solve timeout');
  }
}

function extract(html) {
  const tag = html.match(/<script id="anubis_challenge"[^>]*>([\s\S]*?)<\/script>/);
  if (tag) return JSON.parse(tag[1]);
  const inline = html.match(/\{"challenge":"[^"]+"[\s\S]{0,400}?\}/);
  if (inline) { try { return JSON.parse(inline[0]); } catch {} }
  return null;
}

export async function getCookie(path = '/') {
  const page = await fetch(BASE + path, { headers: { 'user-agent': UA }, redirect: 'manual' });
  const html = await page.text();
  const cfg = extract(html);
  if (!cfg) {
    if (page.status === 200) return { cookie: null };
    throw new Error(`gated, no challenge parsed (${page.status})`);
  }
  const difficulty = cfg.rules?.difficulty ?? cfg.difficulty ?? 4;
  const id = cfg.challenge;
  const { nonce, hash, elapsed } = solve(id, difficulty);

  for (const p of PASS) {
    const res = await fetch(BASE + p, {
      method: 'POST',
      headers: {
        'user-agent': UA,
        'content-type': 'application/x-www-form-urlencoded',
        origin: BASE,
        referer: BASE + path,
      },
      body: new URLSearchParams({
        id, nonce: String(nonce), response: hash, redir: BASE + path,
        elapsedTime: String(elapsed),
      }),
      redirect: 'manual',
    });
    const pairs = (res.headers.getSetCookie?.() ?? [])
      .map((c) => c.split(';')[0])
      .filter((c) => NAMES.some((n) => c.startsWith(n + '=')));
    if (!pairs.length) continue;
    const cookie = pairs.join('; ');
    const check = await fetch(BASE + path, { headers: { 'user-agent': UA, cookie } });
    if (check.status === 200) return { cookie };
  }
  throw new Error('all pass-challenge endpoints failed');
}

export function headers(cookie) {
  const h = { 'user-agent': UA, 'accept-language': 'en-US,en;q=0.9', referer: BASE + '/' };
  if (cookie) h.cookie = cookie;
  return h;
}