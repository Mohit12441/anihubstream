// @ts-check

/**
 * Pure WebCrypto AES-256-CBC Decryption
 */
async function decryptAes256Cbc(base64Cipher) {
  const keyBuf = new Uint8Array(32);
  const ivBuf = new Uint8Array(16);
  new TextEncoder().encodeInto('i?LMTAx0Q6,:}50U', keyBuf);
  new TextEncoder().encodeInto("W0;27ToaUpl_P%'c", ivBuf);

  const cryptoKey = await crypto.subtle.importKey('raw', keyBuf, { name: 'AES-CBC' }, false, ['decrypt']);

  const binary = atob(base64Cipher.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  const decrypted = await crypto.subtle.decrypt({ name: 'AES-CBC', iv: ivBuf }, cryptoKey, bytes);
  return new TextDecoder().decode(decrypted);
}

/**
 * Pure WebCrypto HMAC-SHA256 Directory-Scoped Token Signer
 */
async function buildToken(fileUrl, nowSec = Math.floor(Date.now() / 1000)) {
  let path = '';
  try {
    path = new URL(fileUrl).pathname.slice(1);
  } catch {
    return '';
  }
  const dir = path.replace(/\/[^/]*\.m3u8$/i, '');
  if (!dir || dir === path) return '';

  const message = `${nowSec}|${dir}`;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode('MpCdnT0k3n!9f2K#xQ7vL5mR8wN1pY4s'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sigBuf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const msgB64 = btoa(message).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  return `${msgB64}.${sigB64}`;
}

/**
 * Edge Resolver: Resolves Megaplay stream directly using Web standards
 * @param {{ malId: number, ep: number, audio?: string }} param0
 */
export async function resolveMegaplayDirect({ malId, ep = 1, audio = 'sub' }) {
  if (!malId || malId <= 0) return null;

  const lang = audio === 'dub' ? 'dub' : 'sub';
  const embedUrl = `https://megaplay.buzz/stream/mal/${malId}/${ep}/${lang}`;

  const embedRes = await fetch(embedUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      Referer: 'https://anikoto.cz/',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    signal: AbortSignal.timeout(6000),
  });

  if (!embedRes.ok) return null;
  const html = await embedRes.text();
  const dataId = html.match(/id="megaplay-player"[^>]*data-id="([^"]+)"/i)?.[1];
  if (!dataId) return null;

  const sourcesUrl = `https://megaplay.buzz/stream/getSources?id=${encodeURIComponent(dataId)}&platform=OTHER`;
  const sourcesRes = await fetch(sourcesUrl, {
    headers: {
      Referer: embedUrl,
      'X-Requested-With': 'XMLHttpRequest',
      Accept: 'application/json, text/javascript, */*; q=0.01',
    },
    signal: AbortSignal.timeout(6000),
  });

  if (!sourcesRes.ok) return null;
  const payload = await sourcesRes.json().catch(() => null);
  if (!payload?.enc) return null;

  const decrypted = await decryptAes256Cbc(payload.enc);
  let fileUrl = '';
  try {
    const parsed = JSON.parse(decrypted);
    fileUrl = parsed.file || '';
  } catch {
    return null;
  }
  if (!fileUrl) return null;

  const token = await buildToken(fileUrl);
  const streamUrl = token ? `${fileUrl}?token=${token}` : fileUrl;

  const subtitles = (payload.tracks || [])
    .filter((t) => t.kind === 'captions' || t.kind === 'subtitles' || t.file?.endsWith('.vtt'))
    .map((t, idx) => ({
      id: `sub-${idx}`,
      language: t.label?.slice(0, 3)?.toLowerCase() || 'en',
      label: t.label || 'English',
      url: t.file,
      default: t.default === true || idx === 0,
    }));

  return {
    streamUrl,
    quality: '1080p',
    subtitles,
    intro: payload.intro || null,
    outro: payload.outro || null,
    provider: 'anikoto',
  };
}
