import { createHash } from 'node:crypto';

const BASE = 'https://hdrezka.ag';
export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const NAMES = [
  'techaro.lol-anubis-auth',
  'within.website-x-cmd-anubis-auth',
  'within.website-cmd-anubis-auth',
  'anubis-auth',
  'techaro.lol-anubis-cookie-verification',
];

const PASS_PATH = '/.within.website/x/cmd/anubis/api/pass-challenge';
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
  if (tag) {
    try { return JSON.parse(tag[1]); } catch {}
  }
  const inline = html.match(/\{"challenge":"[^"]+"[\s\S]{0,400}?\}/);
  if (inline) {
    try { return JSON.parse(inline[0]); } catch {}
  }
  return null;
}

export async function getCookie(path = '/') {
  const page = await fetch(BASE + path, { headers: { 'user-agent': UA }, redirect: 'follow' });
  const html = await page.text();
  const cfg = extract(html);
  if (!cfg) {
    if (page.status === 200) return { cookie: null };
    throw new Error(`gated, no challenge parsed (${page.status})`);
  }

  const chal = typeof cfg.challenge === 'object' ? cfg.challenge : cfg;
  const chalId = chal.id || cfg.challenge;
  const randomData = chal.randomData || chalId;
  const difficulty = chal.difficulty ?? cfg.rules?.difficulty ?? 4;
  const { nonce, hash, elapsed } = solve(randomData, difficulty);

  const activeBase = new URL(page.url).origin;
  const initialCookies = (page.headers.getSetCookie?.() ?? [])
    .map((c) => c.split(';')[0])
    .filter((c) => !c.endsWith('='));

  const passUrl = new URL(activeBase + PASS_PATH);
  passUrl.searchParams.set('id', chalId);
  passUrl.searchParams.set('response', hash);
  passUrl.searchParams.set('nonce', String(nonce));
  passUrl.searchParams.set('redir', path || '/');
  passUrl.searchParams.set('elapsedTime', String(elapsed));

  const res = await fetch(passUrl.toString(), {
    headers: {
      'user-agent': UA,
      referer: page.url,
      cookie: initialCookies.join('; '),
    },
    redirect: 'manual',
  });

  const solvedCookies = (res.headers.getSetCookie?.() ?? [])
    .map((c) => c.split(';')[0])
    .filter((c) => !c.endsWith('='));

  const combined = [...initialCookies, ...solvedCookies]
    .filter((c) => NAMES.some((n) => c.startsWith(n)));

  if (!combined.length) {
    throw new Error(`pass-challenge failed (${res.status})`);
  }

  const cookie = combined.join('; ');
  const check = await fetch(activeBase + path, { headers: { 'user-agent': UA, cookie } });
  if (check.status === 200) return { cookie };

  throw new Error(`authenticated check failed (${check.status})`);
}

export function headers(cookie) {
  const h = { 'user-agent': UA, 'accept-language': 'en-US,en;q=0.9', referer: BASE + '/' };
  if (cookie) h.cookie = cookie;
  return h;
}
