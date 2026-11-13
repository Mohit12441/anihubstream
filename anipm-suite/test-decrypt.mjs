// anipm-suite/test-decrypt.mjs
// Verifies the reverse-engineered AniPM / ume.to API decryption protocol

import { webcrypto } from 'node:crypto';
const crypto = webcrypto;

const $r = [
  '1230f6e600d3f093',
  '6630aef67a5caefd',
  '4ddb8f6ce317f3d5',
  '8b904c8f68d1160b'
];

const ei = (e) => new Uint8Array((e.match(/.{2}/g) || []).map((x) => parseInt(x, 16)));
const ti = () => ei($r.map((e) => [...e].reverse().join('')).join(''));
const ni = new TextEncoder();

async function deriveSealKey() {
  const masterKey = await crypto.subtle.importKey('raw', ti(), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: ni.encode('api-seal|v1') },
    masterKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );
}

async function decryptApiResponse(buffer) {
  const t = new Uint8Array(buffer);
  if (t.length < 29 || t[0] !== 1) {
    throw new Error(`Unexpected payload format (len: ${t.length}, byte0: ${t[0]})`);
  }
  const key = await deriveSealKey();
  const iv = t.subarray(1, 13);
  const ciphertext = t.subarray(13);

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext
  );

  // Decompress deflate
  const ds = new DecompressionStream('deflate');
  const stream = new Response(new Blob([decrypted]).stream().pipeThrough(ds));
  const text = await stream.text();
  return JSON.parse(text);
}

async function testEndpoint(endpoint) {
  const url = `https://ume.to${endpoint}`;
  console.log(`\n[test] Requesting: ${url}`);
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'application/json',
      'Referer': 'https://ume.to/',
    }
  });

  console.log('[test] HTTP Status:', res.status);
  console.log('[test] Content-Type:', res.headers.get('content-type'));

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/octet-stream')) {
    const buf = await res.arrayBuffer();
    console.log('[test] Encrypted octet-stream bytes:', buf.byteLength);
    const data = await decryptApiResponse(buf);
    console.log('[test] Decrypted JSON Success!');
    console.log('[test] Keys:', Object.keys(data));
    console.log('[test] Sample data:', JSON.stringify(data).slice(0, 300));
    return data;
  } else {
    const text = await res.text();
    console.log('[test] Plain response:', text.slice(0, 300));
    try { return JSON.parse(text); } catch { return text; }
  }
}

async function main() {
  console.log('--- TESTING ANIPM / UME.TO API PROTOCOL ---');
  await testEndpoint('/ani-api/anime/search?q=solo&k=1');
  await testEndpoint('/ani-api/anime/home-bootstrap?counts=exact-audio-v1&k=1');
}

main().catch(console.error);
