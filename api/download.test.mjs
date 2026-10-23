// @ts-check
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseMasterVariants, parseMediaSegments, resolveProxyUrl, sniffContainerFormat } from '../src/lib/hlsDownloader.ts';

describe('HLS Downloader Unit Tests & Format Detection', () => {
  test('sniffContainerFormat correctly identifies MPEG-TS sync byte 0x47', () => {
    const tsChunk = new Uint8Array([0x47, 0x40, 0x00, 0x10, 0x00, 0x00, 0xb0]);
    assert.equal(sniffContainerFormat(tsChunk.buffer), 'mp2t');
  });

  test('sniffContainerFormat correctly identifies ISO BMFF MP4 ftyp box', () => {
    // 4 bytes length, then 'ftyp'
    const mp4Chunk = new Uint8Array([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
    assert.equal(sniffContainerFormat(mp4Chunk.buffer), 'mp4');
  });

  test('sniffContainerFormat returns unknown for arbitrary buffers', () => {
    const htmlChunk = new Uint8Array([0x3c, 0x21, 0x44, 0x4f, 0x43, 0x54, 0x59, 0x50, 0x45]); // <!DOCTYPE
    assert.equal(sniffContainerFormat(htmlChunk.buffer), 'unknown');
  });

  test('resolveProxyUrl avoids double-wrapping URLs already routed through /api/proxy', () => {
    const rawTarget = 'https://fetch.nexabloom.top/anime/master.m3u8';
    const proxied = resolveProxyUrl(rawTarget, 'https://megaplay.buzz/');
    assert.ok(proxied.startsWith('/api/proxy?url='));

    // Re-wrapping should return the same URL
    const rewrapped = resolveProxyUrl(proxied, 'https://megaplay.buzz/');
    assert.equal(rewrapped, proxied);

    // Full origin proxied URL should also remain intact
    const fullOrigin = 'http://127.0.0.1:8899/api/proxy?url=https%3A%2F%2Fcdn.example.com';
    assert.equal(resolveProxyUrl(fullOrigin), fullOrigin);
  });

  test('parseMasterVariants parses resolutions and orders highest quality first', () => {
    const m3u8 = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=640x360
360/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=5300000,RESOLUTION=1920x1080
1080/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720
720/index.m3u8`;

    const variants = parseMasterVariants(m3u8, 'https://example.com/hls/master.m3u8');
    assert.equal(variants.length, 3);
    assert.equal(variants[0].quality, '1080p');
    assert.equal(variants[0].url, 'https://example.com/hls/1080/index.m3u8');
    assert.equal(variants[1].quality, '720p');
    assert.equal(variants[2].quality, '360p');
  });

  test('parseMediaSegments extracts segment URLs and resolves relative paths', () => {
    const mediaM3u8 = `#EXTM3U
#EXT-X-TARGETDURATION:10
#EXTINF:9.009,
seg-1.ts
#EXTINF:9.009,
https://cdn.other.com/seg-2.ts
#EXTINF:4.5,
seg-3.ts`;

    const segments = parseMediaSegments(mediaM3u8, 'https://example.com/hls/1080/index.m3u8');
    assert.equal(segments.length, 3);
    assert.equal(segments[0], 'https://example.com/hls/1080/seg-1.ts');
    assert.equal(segments[1], 'https://cdn.other.com/seg-2.ts');
    assert.equal(segments[2], 'https://example.com/hls/1080/seg-3.ts');
  });

  test('api/download returns pipeUrl for stream downloads', async () => {
    const { onRequestGet } = await import('../functions/api/download.js');
    const req = new Request('http://127.0.0.1:8899/api/download?id=test-anime&provider=aniwatch&ep=1');
    const res = await onRequestGet({ request: req, env: {} });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.ok(Array.isArray(body.data.downloads));
  });

  test('api/download returns available: false and descriptive error when provider has no sources', async () => {
    const { onRequestGet } = await import('../functions/api/download.js');
    const req = new Request('http://127.0.0.1:8899/api/download?id=non-existent-anime&provider=watchanimeworld&ep=99');
    const res = await onRequestGet({ request: req, env: {} });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.data.available, false);
    assert.equal(body.data.downloads.length, 0);
    assert.ok(typeof body.data.error === 'string' && body.data.error.includes('not currently available'));
  });
});
