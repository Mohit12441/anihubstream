// @ts-check
import { createHash } from 'node:crypto';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const BASE = 'https://hdrezka-home.tv';
const MAX_AGE = 30 * 24 * 3600 * 1000;

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

function solvePoW(challenge, difficulty) {
  const prefix = '0'.repeat(difficulty);
  const t0 = Date.now();
  for (let nonce = 0; ; nonce++) {
    const hash = sha256(challenge + nonce);
    if (hash.startsWith(prefix)) return { nonce, hash, elapsed: Date.now() - t0 };
    if (Date.now() - t0 > 10_000) return null;
  }
}

/**
 * Solves HDRezka's Anubis challenge directly on this Cloudflare Worker instance
 * to generate an IP-matched authenticated session cookie.
 * @param {any} env
 * @returns {Promise<string | null>}
 */
export async function solveAnubisOnEdge(env) {
  try {
    const page = await fetch(BASE + '/', {
      headers: { 'user-agent': UA, 'accept-language': 'en-US,en;q=0.9' },
      redirect: 'follow',
    });
    const html = await page.text();
    const tag = html.match(/<script id="anubis_challenge"[^>]*>([\s\S]*?)<\/script>/);
    if (!tag) return null;

    const cfg = JSON.parse(tag[1]);
    const chal = typeof cfg.challenge === 'object' ? cfg.challenge : cfg;
    const chalId = chal.id || cfg.challenge;
    const randomData = chal.randomData || chalId;
    const difficulty = chal.difficulty ?? cfg.rules?.difficulty ?? 4;
    const solved = solvePoW(randomData, difficulty);
    if (!solved) return null;

    const initialCookies = (page.headers.getSetCookie?.() ?? [])
      .map((c) => c.split(';')[0])
      .filter((c) => !c.endsWith('='));

    const passUrl = new URL(BASE + '/.within.website/x/cmd/anubis/api/pass-challenge');
    passUrl.searchParams.set('id', chalId);
    passUrl.searchParams.set('response', solved.hash);
    passUrl.searchParams.set('nonce', String(solved.nonce));
    passUrl.searchParams.set('redir', '/');
    passUrl.searchParams.set('elapsedTime', String(solved.elapsed));

    const passRes = await fetch(passUrl.toString(), {
      headers: {
        'user-agent': UA,
        referer: page.url,
        cookie: initialCookies.join('; '),
      },
      redirect: 'manual',
    });

    const passGetSetCookie = passRes.headers.getSetCookie?.() ?? [];
    const passSetCookie = passRes.headers.get('set-cookie') ?? '';
    let solvedCookies = passGetSetCookie.map((c) => c.split(';')[0]);
    if (!solvedCookies.length && passSetCookie) {
      solvedCookies = passSetCookie.split(/,\s*(?=[a-zA-Z0-9_-]+=)/).map((c) => c.split(';')[0]);
    }

    const allCookies = [...initialCookies, ...solvedCookies].join('; ');
    if (allCookies && env?.STREAM_KV) {
      try {
        await env.STREAM_KV.put('anubis:cookie', allCookies, { expirationTtl: 30 * 24 * 3600 });
        await env.STREAM_KV.put('anubis:ts', String(Date.now()), { expirationTtl: 30 * 24 * 3600 });
      } catch {}
    }
    return allCookies;
  } catch {
    return null;
  }
}

/**
 * Searches HDRezka for a series/movie and returns its numeric ID.
 * @param {any} env
 * @param {string} title
 * @returns {Promise<string | null>}
 */
export async function searchRezka(env, title) {
  if (!title || typeof title !== 'string') return null;
  const clean = title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (!clean) return null;

  const cacheKey = `hdrezka:id:${clean}`;
  if (env?.STREAM_KV) {
    try {
      const cached = await env.STREAM_KV.get(cacheKey);
      if (cached) return cached;
    } catch {}
  }

  const { res } = await rezkaFetch(env, `/search/?do=search&subaction=search&q=${encodeURIComponent(title)}`);
  if (!res || !res.ok) return null;
  const html = await res.text().catch(() => '');
  if (!html || html.includes('Проверяем, что вы не бот')) return null;

  const idMatch = html.match(/data-id="(\d+)"/) || html.match(/\/(?:series|animation|cartoons|films)\/(\d+)-[a-z0-9-]+\.html/i);
  if (idMatch && idMatch[1]) {
    const foundId = idMatch[1];
    if (env?.STREAM_KV) {
      try {
        await env.STREAM_KV.put(cacheKey, foundId, { expirationTtl: 30 * 24 * 3600 });
      } catch {}
    }
    return foundId;
  }
  return null;
}

/**
 * Executes an authenticated fetch against HDRezka using cookie stored in KV or env secret.
 * @param {any} env - Cloudflare Worker environment bindings
 * @param {string} path - Upstream request path (e.g. '/ajax/get_cdn_series/')
 * @param {RequestInit} [init] - Fetch options
 * @returns {Promise<{ res: Response | null, reason?: 'no-cookie' | 'stale' | 'rejected' }>}
 */
export async function rezkaFetch(env, path, init = {}) {
  let cookie = null;
  let ts = 0;

  if (env?.STREAM_KV) {
    try {
      const [storedCookie, storedTs] = await Promise.all([
        env.STREAM_KV.get('anubis:cookie'),
        env.STREAM_KV.get('anubis:ts'),
      ]);
      cookie = storedCookie;
      ts = Number(storedTs || 0);
    } catch {}
  }

  if (!cookie && env?.HDREZKA_COOKIE) {
    cookie = env.HDREZKA_COOKIE;
    ts = Date.now();
  }

  if (!cookie) {
    cookie = await solveAnubisOnEdge(env);
  }

  if (!cookie) return { res: null, reason: 'no-cookie' };

  const headers = new Headers(init.headers || {});
  headers.set('user-agent', UA);
  headers.set('referer', `${BASE}/`);
  headers.set('accept-language', 'en-US,en;q=0.9');
  headers.set('cookie', cookie);

  let res;
  try {
    res = await fetch(BASE + path, { ...init, headers });
  } catch {
    return { res: null, reason: 'rejected' };
  }

  let isGated = res.status === 403;
  if (!isGated && res.ok) {
    const clone = res.clone();
    const sample = await clone.text().catch(() => '');
    if (sample.includes('Проверяем, что вы не бот') || sample.includes('anubis_challenge')) {
      isGated = true;
    }
  }

  if (isGated) {
    const freshCookie = await solveAnubisOnEdge(env);
    if (freshCookie) {
      headers.set('cookie', freshCookie);
      try {
        res = await fetch(BASE + path, { ...init, headers });
      } catch {
        return { res: null, reason: 'rejected' };
      }
    } else {
      return { res: null, reason: 'rejected' };
    }
  }

  return { res };
}

/**
 * Reads pre-cached Rezka metadata from KV, keyed by episode.
 * @param {any} env
 * @param {string | number} id
 * @param {number} [season] - optional season number; when provided, episode must also be set
 * @param {number} [episode] - optional episode number; when provided, season must also be set
 * @returns {Promise<{ ok: true, payload: string } | { ok: false }>}
 */
export async function hdrezkaMeta(env, id, season, episode) {
  if (!id) return { ok: false };

  // Build the key: hdrezka:meta:<id>:<season>:<episode>
  let key = `hdrezka:meta:${id}`;
  let needsValidation = false;

  if (season !== undefined && episode !== undefined) {
    key = `hdrezka:meta:${id}:${season}:${episode}`;
    needsValidation = true;
  }

  // 1. KV-first read
  if (env?.STREAM_KV) {
    try {
      const hit = await env.STREAM_KV.get(key);
      if (hit) {
        let parsed = null;
        try {
          parsed = JSON.parse(hit);
        } catch {}

        if (needsValidation) {
          if (!parsed || parsed.s !== season || parsed.e !== episode) {
            // mismatched envelope — treat as miss and fall through
            return { ok: false };
          }
        }
        return { ok: true, payload: parsed?.payload || hit };
      }
    } catch {}
  }

  // 2. On miss with env.GH_DISPATCH_TOKEN set, dispatch workflow asynchronously
  if (env?.GH_DISPATCH_TOKEN && env?.STREAM_KV) {
    try {
      const guardKey = `hdrezka:dispatch:${id}`;
      const last = Number((await env.STREAM_KV.get(guardKey)) || 0);
      if (Date.now() - last > 120_000) {
        await env.STREAM_KV.put(guardKey, String(Date.now()), { expirationTtl: 600 });
        const repo = env.GH_REPO || 'Mohit12441/anihubstream';
        fetch(`https://api.github.com/repos/${repo}/actions/workflows/hdrezka.yml/dispatches`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${env.GH_DISPATCH_TOKEN}`,
            accept: 'application/vnd.github+json',
            'user-agent': UA,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ ref: 'master', inputs: { ids: String(id) } }),
        }).catch(() => {});
      }
    } catch {}
  }

  return { ok: false };
}


/**
 * Cleans HDRezka's custom trash characters and decodes the stream payload.
 * @param {string} rawUrl
 * @returns {Array<{ quality: string, mp4: string, hls: string | null }>}
 */
export function decodeRezkaStream(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return [];

  let decoded = rawUrl;
  if (rawUrl.startsWith('#h') || !rawUrl.includes('http')) {
    let cleaned = rawUrl.replace(/^#h/, '').split('//_//').join('');

    const trashChars = ['@', '#', '!', '^', '$'];
    const trashTokens = new Set();
    for (const a of trashChars) {
      for (const b of trashChars) {
        trashTokens.add(btoa(a + b));
        for (const c of trashChars) {
          trashTokens.add(btoa(a + b + c));
        }
      }
    }

    for (const token of trashTokens) {
      cleaned = cleaned.replaceAll(token, '');
    }

    while (cleaned.length % 4 !== 0) cleaned += '=';
    try {
      decoded = atob(cleaned);
    } catch {
      return [];
    }
  }

  const regex = /\[([^\]]+)\]([^\s,\[]+(?:\s+or\s+[^\s,\[]+)?)/g;
  const streams = [];
  let match;
  while ((match = regex.exec(decoded)) !== null) {
    const [_, rawQual, linkGroup] = match;
    const quality = rawQual.replace(/<[^>]+>/g, '').trim();
    let mp4Url = '';
    let hlsUrl = null;

    if (linkGroup.includes(' or ')) {
      const parts = linkGroup.split(/\s+or\s+/);
      mp4Url = parts.find((p) => !p.includes(':hls:') && p.includes('.mp4')) || parts[0];
      hlsUrl = parts.find((p) => p.includes(':hls:') || p.includes('.m3u8')) || null;
    } else if (linkGroup.includes(':hls:')) {
      const parts = linkGroup.split(':hls:');
      mp4Url = parts[0];
      hlsUrl = parts[1] || null;
    } else {
      mp4Url = linkGroup;
      if (linkGroup.includes('.m3u8')) hlsUrl = linkGroup;
    }

    streams.push({
      quality,
      mp4: mp4Url,
      hls: hlsUrl,
    });
  }

  return streams;
}

/**
 * Parses stream URLs from either JSON get_cdn_series or fallback HTML.
 * @param {string | any} payload
 * @returns {Array<{ quality: string, url: string, container: string }>}
 */
export function parseStreams(payload) {
  let rawUrl = '';
  if (typeof payload === 'object' && payload !== null) {
    rawUrl = payload.url || payload.rawUrl || '';
  } else if (typeof payload === 'string') {
    try {
      const json = JSON.parse(payload);
      rawUrl = json.url || '';
    } catch {
      rawUrl = payload;
    }
  }

  const decoded = decodeRezkaStream(rawUrl);
  if (decoded.length > 0) {
    return decoded.map((s) => ({
      quality: s.quality,
      url: s.mp4 || s.hls || '',
      container: s.mp4 ? 'mp4' : 'hls',
    }));
  }

  // Fallback regex parser for embedded video elements
  const out = [];
  const re = /data-(?:url|player)="([^"]+)"[^>]*?data-quality="([^"]*)"/g;
  let m;
  while ((m = re.exec(String(payload)))) {
    out.push({ url: m[1], quality: m[2] || '1080p', container: m[1].includes('.mp4') ? 'mp4' : 'hls' });
  }

  return out;
}
