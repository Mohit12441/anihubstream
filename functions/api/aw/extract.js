// @ts-check

let loggedCaptchaPayload = false;
const extractCache = new Map();
const EXTRACT_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_POW_DIFFICULTY = 20;

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

const be = 512;
const lt = be - 1;
const dr = 2;
const lr = 2654435761;
const hr = 2246822519;

function re(t, e) {
  return (t << e | t >>> 32 - e) >>> 0;
}
function ht(t, e) {
  return Math.imul(t, e) >>> 0;
}
function ye(t) {
  t[0] = t[0] + t[1] >>> 0;
  t[3] = re(t[3] ^ t[0], 16);
  t[2] = t[2] + t[3] >>> 0;
  t[1] = re(t[1] ^ t[2], 12);
  t[0] = t[0] + t[1] >>> 0;
  t[3] = re(t[3] ^ t[0], 8);
  t[2] = t[2] + t[3] >>> 0;
  t[1] = re(t[1] ^ t[2], 7);
}
function yr(t) {
  const e = new Uint8Array(t.length);
  for (let i = 0; i < t.length; i++) e[i] = t.charCodeAt(i) & 255;
  return e;
}
function gr(t) {
  const e = new Uint32Array([1779033703, 3144134277, 1013904242, 2773480762]);
  for (let i = 0; i < t.length; i++) {
    e[0] = e[0] + t[i] >>> 0;
    e[0] = re(e[0], 7);
    ye(e);
  }
  for (let i = 0; i < 8; i++) ye(e);
  const r = new Uint32Array(be);
  for (let i = 0; i < be; i++) {
    ye(e);
    r[i] = (e[0] ^ e[2]) >>> 0;
  }
  for (let i = 0; i < dr; i++) {
    for (let s = 0; s < be; s++) {
      const a = r[s] & lt;
      let c = r[s] + r[a] >>> 0;
      c = re(c, 13);
      c = (c ^ ht(r[(s + 1) & lt], lr)) >>> 0;
      r[s] = c;
      e[0] = (e[0] ^ c) >>> 0;
      ye(e);
    }
  }
  const n = new Uint32Array(8);
  const o = be / 8;
  for (let i = 0; i < 8; i++) {
    ye(e);
    let s = e[0];
    const a = i * o;
    for (let c = 0; c < o; c++) {
      const d = r[a + c];
      s = s + d >>> 0;
      s = re(s, 5);
      s = (s ^ ht(d, hr)) >>> 0;
    }
    n[i] = (s ^ e[2]) >>> 0;
  }
  return n;
}
function wr(t) {
  let e = 0;
  for (let r = 0; r < t.length; r++) {
    const n = t[r];
    if (n === 0) {
      e += 32;
      continue;
    }
    return e + Math.clz32(n);
  }
  return e;
}
function toHex(words) {
  let out = '';
  for (let i = 0; i < words.length; i++) out += words[i].toString(16).padStart(8, '0');
  return out;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

async function fetchWithRetry(url, options = {}, attempts = 2) {
  let lastErr = null;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetch(url, { ...options, signal: AbortSignal.timeout(20_000) });
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 400));
    }
  }
  throw lastErr || new Error('fetch failed');
}

function extractCodeAndOrigin(reqUrl, body) {
  let code = '';
  let url = '';
  if (body && typeof body === 'object') {
    code = body.code || body.id || body.embedCode || '';
    url = body.url || body.u || body.embedUrl || body.embed || '';
  }
  if (!code) code = reqUrl.searchParams.get('code') || reqUrl.searchParams.get('id') || '';
  if (!url) url = reqUrl.searchParams.get('url') || reqUrl.searchParams.get('u') || '';

  let origin = '';
  if (url) {
    try {
      const u = new URL(url);
      origin = u.origin;
      if (!code) code = u.pathname.split('/').filter(Boolean).pop() || '';
    } catch {}
  }
  if (!origin) origin = 'https://mfw09.org';
  if (!code) code = reqUrl.searchParams.get('code') || '';
  return { code: String(code || '').trim(), origin, url };
}

function b64urlToBytes(input) {
  const s = String(input || '').replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4 === 0 ? 0 : 4 - (s.length % 4);
  const bin = atob(s + '='.repeat(pad));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function selectPlaybackKeyParts(playback) {
  const parts = Array.isArray(playback?.key_parts) ? playback.key_parts : [];
  const version = Number(String(playback?.version || '').trim());
  if (!Number.isInteger(version) || version < 1 || version > 20) return parts;
  const a = version;
  const b = 31 - version;
  if (a < 1 || b < 1 || a > parts.length || b > parts.length) return parts;
  return [parts[a - 1], parts[b - 1]];
}

async function decryptPlayback(playback) {
  const parts = selectPlaybackKeyParts(playback);
  if (!parts.length) return null;
  const chunks = parts.map((p) => b64urlToBytes(p));
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const keyBytes = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { keyBytes.set(c, off); off += c.length; }
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt']);
  const iv = b64urlToBytes(playback.iv);
  const payload = b64urlToBytes(playback.payload);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, payload);
  return new TextDecoder().decode(plain);
}

function m3u8FromPlaybackJson(json, origin) {
  try {
    const j = typeof json === 'string' ? JSON.parse(json) : json;
    const sources = Array.isArray(j?.sources) ? j.sources : [];
    for (const s of sources) {
      const url = s?.url || s?.src || s?.file;
      if (typeof url !== 'string' || !url) continue;
      const mime = String(s?.mime_type || s?.mimeType || '');
      if (/mpegurl/i.test(mime) || /\.m3u8(?:\?|$)/i.test(url)) {
        return url.startsWith('http') ? url : new URL(url, origin).href;
      }
    }
    // Fallback: any source URL is better than none.
    for (const s of sources) {
      const url = s?.url || s?.src || s?.file;
      if (typeof url === 'string' && url) return url.startsWith('http') ? url : new URL(url, origin).href;
    }
  } catch {}
  return null;
}

function extractM3u8FromText(text, origin) {
  if (!text) return null;
  let m = text.match(/https?:\/\/[^"'\s<>]+\.m3u8[^"'\s<>]*/i);
  if (m) return m[0];
  m = text.match(/["']([^"']+\.m3u8[^"']*)["']/i);
  if (m) {
    try {
      return new URL(m[1], origin).href;
    } catch {}
  }
  try {
    const j = JSON.parse(text);
    const cand = j?.m3u8 || j?.url || j?.file || j?.src || j?.data?.m3u8 || j?.data?.url || j?.data?.file || j?.playback?.url || j?.result?.url;
    if (typeof cand === 'string' && cand) {
      return cand.startsWith('http') ? cand : new URL(cand, origin).href;
    }
  } catch {}
  return null;
}

export const onRequest = async (context) => {
  const { request } = context;
  let body = null;
  if (request.method === 'POST') {
    try {
      body = await request.json();
    } catch {
      try {
        const t = await request.text();
        try { body = JSON.parse(t); } catch { body = null; }
      } catch {}
    }
  }

  const reqUrl = new URL(request.url);
  const { code, origin } = extractCodeAndOrigin(reqUrl, body);

  if (!code) {
    return json({ m3u8: null });
  }

  const cached = extractCache.get(code);
  if (cached && cached.expiresAt > Date.now()) {
    return json({ m3u8: cached.m3u8 });
  }

  const commonHeaders = {
    'User-Agent': UA,
    Origin: origin,
    Referer: `${origin}/`,
    Accept: '*/*',
  };

  let m3u8 = null;
  try {
    // 1. POST captcha challenge
    const captchaRes = await fetchWithRetry(`${origin}/api/videos/${encodeURIComponent(code)}/embed/captcha`, {
      method: 'POST',
      headers: { ...commonHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!captchaRes.ok) throw new Error('captcha challenge failed');
    const captchaJson = await captchaRes.json().catch(() => null);
    const payload = (captchaJson && (captchaJson.data || captchaJson)) || {};
    if (!loggedCaptchaPayload) {
      console.warn('[aw/extract] captcha payload', payload);
      loggedCaptchaPayload = true;
    }

    const powNonce = payload.pow_nonce ?? payload.powNonce ?? payload.nonce ?? payload.challenge ?? payload.salt ?? payload.prefix ?? payload.seed ?? '';
    const powDifficulty = Number(payload.pow_difficulty ?? payload.difficulty ?? 0);
    const powToken = payload.pow_token ?? payload.powToken ?? payload.token ?? payload.captchaToken ?? payload.captcha_token ?? '';
    if (Number.isFinite(powDifficulty) && powDifficulty > MAX_POW_DIFFICULTY) {
      console.warn('[aw/extract] difficulty too high, falling back to embed', { powDifficulty, max: MAX_POW_DIFFICULTY });
      return json({ m3u8: null });
    }
    const target = payload.target ?? payload.prefix ?? payload.hashPrefix ?? payload.difficultyTarget ?? payload.targetPrefix ?? null;
    const unitHint = payload.difficultyType ?? payload.difficulty_unit ?? payload.unit ?? payload.mode ?? payload.type ?? payload.algorithm ?? '';
    const allHints = [unitHint, payload.unit, payload.mode, payload.algorithm, payload.difficultyType, payload.difficulty_unit, payload.type].filter(Boolean).join(' ');

    let isBits = null;
    if (typeof target === 'string' && target) {
      // target mode: compare hash hex prefix directly
      isBits = null;
    } else if (/bit/i.test(allHints)) {
      isBits = true;
    } else if (/byte/i.test(allHints)) {
      isBits = false;
    } else {
      isBits = Number(powDifficulty) > 8;
    }

    // Solve PoW with custom gr hash; input = pow_nonce + ":" + solution.
    const CHUNK = 150;
    const MAX_NONCE = 5_000_000;
    const startTs = Date.now();
    async function solvePow() {
      for (let base = 0; base < MAX_NONCE; base += CHUNK) {
        const len = Math.min(CHUNK, MAX_NONCE - base);
        const nonces = Array.from({ length: len }, (_, i) => base + i);
        const hashes = await Promise.all(nonces.map((n) => gr(yr(String(powNonce) + ':' + n))));
        for (let i = 0; i < len; i++) {
          const h = hashes[i];
          let ok = false;
          if (typeof target === 'string' && target) {
            ok = toHex(h).toLowerCase().startsWith(String(target).toLowerCase().replace(/^0x/, ''));
          } else if (isBits) {
            ok = wr(h) >= Number(powDifficulty);
          } else {
            ok = toHex(h).toLowerCase().startsWith('0'.repeat(Number(powDifficulty) * 2));
          }
          if (ok) return String(nonces[i]);
        }
        if (Date.now() - startTs > 60000) return null;
      }
      return null;
    }
    const solution = await solvePow();
    if (solution === null) throw new Error('pow solve failed');

    // 2. POST verify
    const verifyPaths = [
      `${origin}/api/videos/${encodeURIComponent(code)}/embed/captcha/verify`,
    ];
    let verifyRes = null;
    for (const vp of verifyPaths) {
      const r = await fetchWithRetry(vp, {
        method: 'POST',
        headers: { ...commonHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ pow_token: powToken, solution: String(solution) }),
      });
      verifyRes = r;
      if (r.ok) break;
      if (r.status !== 404 && r.status !== 405) break;
    }
    console.warn('[aw/extract] verify status', verifyRes && verifyRes.status);
    if (!verifyRes || !verifyRes.ok) throw new Error('captcha verify failed');
    const verifyJson = await verifyRes.json().catch(() => null);
    console.warn('[aw/extract] verify json', JSON.stringify(verifyJson).slice(0, 500));
    const vpayload = (verifyJson && (verifyJson.data || verifyJson)) || {};
    // Check if verify response itself contains m3u8.
    const directM3u8 = extractM3u8FromText(JSON.stringify(vpayload), origin);
    if (directM3u8) {
      m3u8 = directM3u8;
    }

    if (!m3u8) {
      // 3. POST embed/playback with a captcha token and decrypt the payload.
      const token = String(vpayload.token || vpayload.captchaToken || vpayload.captcha_token || '');
      if (!token) throw new Error('captcha token missing');
      const playbackRes = await fetchWithRetry(`${origin}/api/videos/${encodeURIComponent(code)}/embed/playback`, {
        method: 'POST',
        headers: {
          ...commonHeaders,
          'Content-Type': 'application/json',
          'X-Captcha-Token': token,
          'X-Embed-Origin': origin,
          'X-Embed-Referer': `${origin}/e/${encodeURIComponent(code)}`,
        },
        body: JSON.stringify({ fingerprint: { token: 'x', viewer_id: 'x', device_id: 'x', confidence: 0 } }),
      });
      console.warn('[aw/extract] playback status', playbackRes.status);
      if (!playbackRes.ok) throw new Error('playback fetch failed');
      const playbackJson = await playbackRes.json().catch(() => null);
      const playback = playbackJson?.playback || playbackJson?.data?.playback || null;
      if (!playback) throw new Error('playback payload missing');
      const decrypted = await decryptPlayback(playback).catch((e) => {
        console.warn('[aw/extract] decrypt failed', e && (e.message || e));
        return null;
      });
      m3u8 = decrypted ? m3u8FromPlaybackJson(decrypted, origin) : null;
    }
  } catch (err) {
    console.warn('[aw/extract] extraction failed, falling back to embed:', err && (err.message || err));
    m3u8 = null;
  }

  console.warn('[aw/extract] result', m3u8 ? 'ok' : 'null');
  if (m3u8) extractCache.set(code, { m3u8, expiresAt: Date.now() + EXTRACT_CACHE_TTL_MS });
  return json({ m3u8 });
};

export const onRequestGet = onRequest;
export const onRequestPost = onRequest;
export const onRequestPut = onRequest;
