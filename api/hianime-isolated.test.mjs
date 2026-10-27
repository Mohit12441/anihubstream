// @ts-check
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { decodeZokoPayloadEdge } from '../functions/api/hianime/_zoko.js';
import { onRequestGet as onHomeGet } from '../functions/api/hianime/home.js';
import { onRequestGet as onSearchGet } from '../functions/api/hianime/search.js';
import { onRequestGet as onDetailsGet } from '../functions/api/hianime/[id].js';
import { onRequestGet as onPlayGet } from '../functions/api/hianime/play.js';

describe('HiAnime Isolated Subsystem & Edge Tests', () => {
  describe('ZokoAnime Edge Decryptor (_zoko.js)', () => {
    it('decodes base64 payload XORed with otaku-embed-v1 using standard Web APIs', () => {
      const payload = {
        src: 'https://hls.dramahot.top/p/demo/master.m3u8',
        player: { engine: 'jwplayer', default_quality: '1080p' },
        skip: { intro: { start: 90, end: 175 } },
      };
      const jsonStr = JSON.stringify(payload);
      const key = 'otaku-embed-v1';
      let xorStr = '';
      for (let i = 0; i < jsonStr.length; i++) {
        xorStr += String.fromCharCode(jsonStr.charCodeAt(i) ^ key.charCodeAt(i % key.length));
      }
      const b64 = btoa(xorStr);
      const html = `<script>window.__P="${b64}";</script>`;

      const decoded = decodeZokoPayloadEdge(html);
      assert.deepEqual(decoded, payload);
    });

    it('returns undefined when window.__P is missing or malformed', () => {
      assert.equal(decodeZokoPayloadEdge('<div>No script tag here</div>'), undefined);
      assert.equal(decodeZokoPayloadEdge('window.__P="too-short";'), undefined);
      assert.equal(decodeZokoPayloadEdge(''), undefined);
    });
  });

  describe('HiAnime Edge API Handlers', () => {
    it('search handler rejects missing query parameter with 400', async () => {
      const req = new Request('http://127.0.0.1:8899/api/hianime/search');
      const res = await onSearchGet({ request: req, env: {} });
      assert.equal(res.status, 400);
      const json = await res.json();
      assert.equal(json.error, 'bad_request');
    });

    it('details handler rejects empty id parameter with 400', async () => {
      const res = await onDetailsGet({ params: { id: '' }, env: {} });
      assert.equal(res.status, 400);
      const json = await res.json();
      assert.equal(json.error, 'bad_request');
    });

    it('play handler rejects missing id parameter with 400', async () => {
      const req = new Request('http://127.0.0.1:8899/api/hianime/play');
      const res = await onPlayGet({ request: req, env: {} });
      assert.equal(res.status, 400);
      const json = await res.json();
      assert.equal(json.error, 'bad_request');
    });
  });
});
