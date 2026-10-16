import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  streamCacheKey,
  getCachedSource,
  setCachedSource,
} from '../src/lib/streamBridge.ts';
import { onRequestGet, onRequestPost } from '../functions/api/stream/cache.js';

describe('Task 3: Playback Startup Latency & Stream Caching', () => {
  describe('streamCacheKey', () => {
    it('produces normalized stream cache keys', () => {
      assert.equal(
        streamCacheKey('Sousou no Frieren', 1, 'sub'),
        'stream:sousou-no-frieren:1:sub',
      );
      assert.equal(
        streamCacheKey('Cyberpunk: Edgerunners 2', 5, 'dub'),
        'stream:cyberpunk-edgerunners-2:5:dub',
      );
    });
  });

  describe('getCachedSource & setCachedSource', () => {
    it('caches and retrieves stream source with reused flag', () => {
      const key = 'stream:test-title:1:sub';
      const fakeSource = {
        session: 'sid-1234',
        title: 'Test Title',
        episode: { number: 1, title: 'Episode 1' },
        quality: 1080,
        variants: [1080, 720],
        audio: 'sub',
        skip: null,
        proof: { container: 'mpegts', checkedBytes: 131072 },
        master: '/stream/sid-1234/master.m3u8',
        subtitles: [],
      };

      setCachedSource(key, fakeSource);
      const hit = getCachedSource(key);
      assert.ok(hit);
      assert.equal(hit.session, 'sid-1234');
      assert.equal(hit.reused, true);
    });
  });

  describe('D1 stream cache endpoint', () => {
    const mockDb = new Map();
    const env = {
      ANIHUB: {
        prepare: (sql) => {
          return {
            bind: (...args) => ({
              first: async () => {
                if (sql.includes('SELECT')) {
                  const key = args[0];
                  const now = args[1];
                  const item = mockDb.get(key);
                  if (item && item.expires_at > now) {
                    return item;
                  }
                  return null;
                }
                return null;
              },
              run: async () => {
                if (sql.includes('INSERT')) {
                  const [key, data, expires_at] = args;
                  mockDb.set(key, { key, data, expires_at });
                } else if (sql.includes('DELETE')) {
                  const now = args[0];
                  for (const [k, v] of mockDb.entries()) {
                    if (v.expires_at < now) mockDb.delete(k);
                  }
                }
                return { success: true };
              },
            }),
          };
        },
      },
    };

    it('stores and retrieves cached stream via API endpoint', async () => {
      const key = 'stream:naruto:1:sub';
      const data = { master: 'https://cdn.example.com/master.m3u8', quality: 1080 };

      // POST
      const postReq = new Request('https://anihubstream.com/api/stream/cache', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key, data, ttlSeconds: 21600 }),
      });
      const postRes = await onRequestPost({ request: postReq, env });
      assert.equal(postRes.status, 200);
      const postJson = await postRes.json();
      assert.equal(postJson.ok, true);

      // GET hit
      const getReq = new Request(`https://anihubstream.com/api/stream/cache?key=${encodeURIComponent(key)}`);
      const getRes = await onRequestGet({ request: getReq, env });
      assert.equal(getRes.status, 200);
      const getJson = await getRes.json();
      assert.equal(getJson.hit, true);
      assert.equal(getJson.data.quality, 1080);

      // GET miss
      const missReq = new Request('https://anihubstream.com/api/stream/cache?key=stream:nonexistent:1:sub');
      const missRes = await onRequestGet({ request: missReq, env });
      assert.equal(missRes.status, 200);
      const missJson = await missRes.json();
      assert.equal(missJson.hit, false);
    });

    it('rejects invalid key formats with 400', async () => {
      const badReq = new Request('https://anihubstream.com/api/stream/cache?key=invalid_key');
      const badRes = await onRequestGet({ request: badReq, env });
      assert.equal(badRes.status, 400);
    });
  });
});
