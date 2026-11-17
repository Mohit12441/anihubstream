// @ts-check
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const BASE = 'https://hdrezka-home.tv';
const MAX_AGE = 6 * 3600 * 1000;

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

  if (!cookie) return { res: null, reason: 'no-cookie' };
  if (ts > 0 && Date.now() - ts > MAX_AGE) return { res: null, reason: 'stale' };

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

  if (res.status === 403) {
    try { await env?.STREAM_KV?.delete?.('anubis:cookie'); } catch {}
    return { res: null, reason: 'rejected' };
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
