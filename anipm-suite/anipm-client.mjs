// anipm-suite/anipm-client.mjs
/**
 * AniPM / Ume.to / Ani.nz Complete Reverse-Engineered Client
 * 
 * Provides end-to-end integration for:
 * 1. Catalog & Search API (/ani-api/anime/search, /ani-api/partner/v1/series)
 * 2. Episode & Availability Metadata (Sub/Dub, Hardsub)
 * 3. Beta Server & Multi-Audio Detection (Japanese, English, Hindi, Tamil, Malayalam)
 * 4. Video Quality Ladder (1080p, 720p, 480p, 360p, 240p)
 * 5. Settlar Player Session Token Resolution
 * 6. Cryptographic Payload Decryption (HKDF + AES-GCM + Deflate)
 */

import { webcrypto } from 'node:crypto';
const crypto = webcrypto;

export const DOMAINS = {
  primary: 'https://ani.pm',
  mirror: 'https://ume.to',
  legacy: 'https://ani.nz',
  settlarEmbed: 'https://embed.settlar.io',
  settlarMedia: 'https://media.settlar.io',
  betaOrigin: 'https://beta.cno.to',
};

// Seed keys extracted from bundle index-BTf6JUMP.js ($r)
const SEED_CHUNKS = [
  '1230f6e600d3f093',
  '6630aef67a5caefd',
  '4ddb8f6ce317f3d5',
  '8b904c8f68d1160b'
];

const hexToBytes = (hex) => new Uint8Array((hex.match(/.{2}/g) || []).map((x) => parseInt(x, 16)));
const masterSeed = () => hexToBytes(SEED_CHUNKS.map((c) => [...c].reverse().join('')).join(''));
const encoder = new TextEncoder();

/**
 * Derives the AES-GCM 256-bit API decryption key via HKDF SHA-256
 */
export async function deriveSealKey() {
  const masterKey = await crypto.subtle.importKey('raw', masterSeed(), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: encoder.encode('api-seal|v1') },
    masterKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );
}

/**
 * Decrypts octet-stream responses using AES-GCM and decompressing deflate
 */
export async function decryptApiResponse(buffer) {
  const t = new Uint8Array(buffer);
  if (t.length < 29 || t[0] !== 1) {
    throw new Error(`Unexpected payload format (len: ${t.length}, byte0: ${t[0]})`);
  }
  const key = await deriveSealKey();
  const iv = t.subarray(1, 13);
  const ciphertext = t.subarray(13);

  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  const ds = new DecompressionStream('deflate');
  const stream = new Response(new Blob([decrypted]).stream().pipeThrough(ds));
  const text = await stream.text();
  return JSON.parse(text);
}

/**
 * Standard HTTP Fetcher with browser headers and auto-fallback
 */
async function apiFetch(endpoint, { base = DOMAINS.mirror, accept = 'application/json' } = {}) {
  const url = endpoint.startsWith('http') ? endpoint : `${base}${endpoint}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': accept,
      'Referer': `${base}/`,
    }
  });

  if (!res.ok) {
    throw new Error(`API call to ${url} failed with HTTP ${res.status}`);
  }

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/octet-stream')) {
    const buf = await res.arrayBuffer();
    return decryptApiResponse(buf);
  }

  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * 1. Search anime by query
 */
export async function searchAnime(query) {
  const endpoint = `/ani-api/anime/search?q=${encodeURIComponent(query)}&k=1`;
  const data = await apiFetch(endpoint);
  return data.items || [];
}

/**
 * 2. Get series metadata and full episode list
 */
export async function getSeries(anilistId) {
  const endpoint = `/ani-api/partner/v1/series/${anilistId}?adult=1&k=1`;
  const json = await apiFetch(endpoint);
  return json.data || null;
}

/**
 * 3. Get Beta Server multi-audio track routing and episode languages
 */
export async function getBetaServerInfo(anilistId) {
  const endpoint = `/api/anime/beta-server/${anilistId}`;
  return apiFetch(endpoint, { base: DOMAINS.primary });
}

/**
 * 4. Get available video quality rungs for episode
 */
export async function getQualities(anilistId, ep = 1) {
  const endpoint = `/api/anime/beta-server/${anilistId}/qualities?ep=${ep}`;
  return apiFetch(endpoint, { base: DOMAINS.primary });
}

/**
 * 5. Resolve live Settlar player session and signed token
 */
export async function resolveSettlarSession(anilistId, ep = 1, lang = 'sub') {
  const embedUrl = `${DOMAINS.primary}/embed/ani/${anilistId}/${ep}/${lang}`;
  const html = await apiFetch(embedUrl, { base: DOMAINS.primary, accept: 'text/html' });

  const configMatch = html.match(/<script[^>]*id=["']anipm-embed-config["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!configMatch) {
    throw new Error('Embed config missing in ani.pm HTML response');
  }

  const config = JSON.parse(configMatch[1]);
  const nonce = config.nonce || config.n;

  const sessionUrl = `/api/partner/v1/session?n=${encodeURIComponent(nonce)}&id=${anilistId}&ep=${ep}&lang=${lang}&adult=1`;
  const session = await apiFetch(sessionUrl, { base: DOMAINS.primary });

  return {
    nonce,
    playerOrigin: config.playerOrigin || 'https://embed.settlar.io',
    session,
  };
}
