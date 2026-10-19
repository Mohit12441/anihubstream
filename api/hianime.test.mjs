// @ts-check
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeZokoPayload,
  audioOfEmbed,
  parseVariants,
  sniffContainer,
  normalizeUnicodeToAscii,
  buildMegaPlayToken,
  fetchDownloads,
  home,
  search,
  details,
  sources,
  resolve,
} from './hianime.mjs';

describe('HiAnime Provider & Protocol Tests', () => {
  describe('decodeZokoPayload', () => {
    it('decodes base64 payload XORed with otaku-embed-v1', () => {
      const payload = {
        src: 'https://hls.dramahot.top/master.m3u8',
        player: { engine: 'jwplayer', default_quality: '1080p' },
        skip: { intro: { start: 90, end: 175 } },
      };
      const jsonStr = JSON.stringify(payload);
      const key = 'otaku-embed-v1';
      const buf = Buffer.alloc(jsonStr.length);
      for (let i = 0; i < jsonStr.length; i++) {
        buf[i] = jsonStr.charCodeAt(i) ^ key.charCodeAt(i % key.length);
      }
      const b64 = buf.toString('base64');
      const html = `<script>window.__P="${b64}";</script>`;

      const decoded = decodeZokoPayload(html);
      assert.deepEqual(decoded, payload);
    });

    it('returns undefined when window.__P is absent or malformed', () => {
      assert.equal(decodeZokoPayload('<div>No player here</div>'), undefined);
      assert.equal(decodeZokoPayload('window.__P="short";'), undefined);
    });
  });

  describe('audioOfEmbed', () => {
    it('detects sub and dub from embed path', () => {
      assert.equal(audioOfEmbed('https://zokoanime.video/stream/mal/52299/1/sub?autostart=false'), 'sub');
      assert.equal(audioOfEmbed('https://zokoanime.video/stream/mal/52299/1/dub'), 'dub');
      assert.equal(audioOfEmbed('https://megaplay.buzz/stream/mal/52299/1/sub'), 'sub');
      assert.equal(audioOfEmbed('https://megaplay.buzz/stream/mal/52299/1/dub'), 'dub');
      assert.equal(audioOfEmbed('https://zokoanime.video/embed/player'), undefined);
    });
  });

  describe('parseVariants', () => {
    it('parses master HLS variants with resolution and bandwidth', () => {
      const masterM3u8 = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=5300000,RESOLUTION=1920x1080
1080/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=640x360
360/index.m3u8
#EXT-X-I-FRAME-STREAM-INF:BANDWIDTH=150000,URI="thumbnails.m3u8"
`;
      const variants = parseVariants(masterM3u8, 'https://hls.dramahot.top/stream/master.m3u8');
      assert.equal(variants.length, 2);
      assert.equal(variants[0].height, 1080);
      assert.equal(variants[0].width, 1920);
      assert.equal(variants[0].bandwidth, 5300000);
      assert.equal(variants[0].url, 'https://hls.dramahot.top/stream/1080/index.m3u8');

      assert.equal(variants[1].height, 360);
      assert.equal(variants[1].width, 640);
      assert.equal(variants[1].bandwidth, 900000);
      assert.equal(variants[1].url, 'https://hls.dramahot.top/stream/360/index.m3u8');
    });
  });

  describe('sniffContainer', () => {
    it('identifies MPEG-TS and MP4 containers', () => {
      const mpegTs = Buffer.alloc(188 * 5);
      for (let i = 0; i < 5; i++) mpegTs[i * 188] = 0x47;
      assert.equal(sniffContainer(mpegTs), 'mpegts');

      const mp4 = Buffer.alloc(32);
      mp4.write('ftyp', 4, 4, 'ascii');
      assert.equal(sniffContainer(mp4), 'mp4');

      const m3u8 = Buffer.from('#EXTM3U\n#EXTINF:10.0\n');
      assert.equal(sniffContainer(m3u8), 'm3u8');

      const html = Buffer.from('<!DOCTYPE html><html><body>Error</body></html>');
      assert.equal(sniffContainer(html), 'html');
    });
  });

  describe('normalizeUnicodeToAscii', () => {
    it('replaces typographic quotes, dashes, and invisible characters', () => {
      const raw = '“Solo Leveling” – Season 1’s Journey\u200B';
      const clean = normalizeUnicodeToAscii(raw);
      assert.equal(clean, '"Solo Leveling" - Season 1\'s Journey');
    });
  });

  describe('buildMegaPlayToken', () => {
    it('generates a signed fresh token for MegaPlay directories', () => {
      const fileUrl = 'https://megaplay.buzz/cdn/anime/ep1/master.m3u8';
      const token = buildMegaPlayToken(fileUrl, () => 1700000000000);
      assert.ok(token);
      assert.ok(token.includes('.'));
    });
  });

  describe('fetchDownloads', () => {
    it('parses embed target URL and fetches direct downloads', async () => {
      const embedUrl = 'https://zokoanime.video/stream/mal/52299/1/sub';
      const downloads = await fetchDownloads(embedUrl, { signal: AbortSignal.timeout(15_000) });
      assert.ok(Array.isArray(downloads));
      if (downloads.length > 0) {
        assert.ok(downloads.some((d) => d.quality === '1080p' || d.label === '1080p'));
        assert.ok(downloads[0].url.startsWith('http'));
        assert.equal(downloads[0].provider, 'hianime');
      }
    });

    it('returns empty array on invalid target', async () => {
      const invalid = await fetchDownloads('https://invalid.com/video');
      assert.deepEqual(invalid, []);
    });
  });

  describe('home endpoint', () => {
    it('fetches featured, trending, popular, and latest episodes', async () => {
      const feed = await home({ signal: AbortSignal.timeout(20_000) });
      assert.ok(feed);
      assert.ok(Array.isArray(feed.featured));
      assert.ok(Array.isArray(feed.trending));
      assert.ok(Array.isArray(feed.latestEpisodes));
      assert.ok(feed.featured.length > 0);
      assert.ok(feed.featured[0].title);
      assert.ok(feed.featured[0].slug);
    });
  });
});
