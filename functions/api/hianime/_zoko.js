// @ts-check

const ZOKO_XOR_KEY = 'otaku-embed-v1';

/**
 * Pure Web API ZokoAnime Payload Decryptor (Cloudflare Workers / Pages edge compatible).
 * Decodes base64 payload from `window.__P = "..."` and XORs with `otaku-embed-v1`.
 *
 * @param {string} html - Embed HTML containing window.__P
 * @returns {Record<string, any> | undefined}
 */
export function decodeZokoPayloadEdge(html) {
  if (!html || typeof html !== 'string') return undefined;
  const match = /window\.__P\s*=\s*["']([A-Za-z0-9+/=]{32,})["']/.exec(html);
  if (!match) return undefined;

  try {
    const b64 = match[1];
    const binary = atob(b64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    const keyLen = ZOKO_XOR_KEY.length;

    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i) ^ ZOKO_XOR_KEY.charCodeAt(i % keyLen);
    }

    const decoded = new TextDecoder().decode(bytes);
    return JSON.parse(decoded);
  } catch {
    return undefined;
  }
}

/**
 * Resolves a ZokoAnime embed URL into a streamable master M3U8 on Cloudflare Edge.
 *
 * @param {string} embedUrl - e.g. https://zokoanime.video/stream/mal/52991/1/sub
 * @param {Object} [options]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{ masterUrl: string, headers: Record<string, string>, defaultQuality?: string, skip?: any } | null>}
 */
export async function resolveZokoEmbedEdge(embedUrl, { signal } = {}) {
  try {
    const res = await fetch(embedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        Referer: 'https://animehot.cc/',
      },
      signal,
    });

    if (!res.ok) return null;
    const html = await res.text();
    const payload = decodeZokoPayloadEdge(html);
    if (!payload || !payload.src) return null;

    return {
      masterUrl: payload.src,
      headers: {
        Referer: 'https://zokoanime.video/',
        Origin: 'https://zokoanime.video',
      },
      defaultQuality: payload.player?.default_quality || '1080p',
      skip: payload.skip || null,
    };
  } catch {
    return null;
  }
}
