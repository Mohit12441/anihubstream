// @ts-check
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isMegaplayTokenValid } from '../functions/api/anikoto/_megaplay.js';
import { onRequestGet as onHomeGet } from '../functions/api/anikoto/home.js';
import { onRequestGet as onSearchGet } from '../functions/api/anikoto/search.js';
import { onRequestGet as onDetailsGet } from '../functions/api/anikoto/[id].js';
import { onRequestGet as onPlayGet } from '../functions/api/anikoto/play.js';

describe('AniKoto Isolated Subsystem & Edge Tests', () => {
  describe('MegaPlay WebCrypto Edge Validator (_megaplay.js)', () => {
    it('validates fresh MegaPlay HMAC tokens', () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const msg = `${nowSec}|anime/test/path`;
      const b64 = Buffer.from(msg).toString('base64url');
      const token = `${b64}.mockSignature`;
      const url = `https://fetch.nexabloom.top/master.m3u8?token=${token}`;

      assert.equal(isMegaplayTokenValid(url, 1800), true);
    });

    it('identifies expired MegaPlay tokens beyond max age', () => {
      const pastSec = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
      const msg = `${pastSec}|anime/test/path`;
      const b64 = Buffer.from(msg).toString('base64url');
      const token = `${b64}.mockSignature`;
      const url = `https://fetch.nexabloom.top/master.m3u8?token=${token}`;

      assert.equal(isMegaplayTokenValid(url, 1800), false);
    });

    it('gracefully handles malformed token strings without throwing', () => {
      assert.equal(isMegaplayTokenValid('', 1800), false);
      assert.equal(isMegaplayTokenValid('https://fetch.nexabloom.top/master.m3u8', 1800), true);
    });
  });

  describe('AniKoto Edge API Handlers', () => {
    it('home handler returns structured shelves even with null db', async () => {
      const res = await onHomeGet({ env: {} });
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.ok, true);
      assert.equal(json.provider, 'anikoto');
      assert.ok(Array.isArray(json.data.spotlight));
      assert.ok(Array.isArray(json.data.trending));
    });

    it('search handler returns empty array on empty query', async () => {
      const req = new Request('http://127.0.0.1:8899/api/anikoto/search?q=');
      const res = await onSearchGet({ request: req, env: {} });
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.ok, true);
      assert.deepEqual(json.data, []);
    });

    it('details handler rejects empty id parameter with 400', async () => {
      const res = await onDetailsGet({ params: { id: '' }, env: {} });
      assert.equal(res.status, 400);
      const json = await res.json();
      assert.equal(json.error, 'bad_request');
    });

    it('play handler rejects missing id parameter with 400', async () => {
      const req = new Request('http://127.0.0.1:8899/api/anikoto/play');
      const res = await onPlayGet({ request: req, env: {} });
      assert.equal(res.status, 400);
      const json = await res.json();
      assert.equal(json.error, 'bad_request');
    });
  });
});
