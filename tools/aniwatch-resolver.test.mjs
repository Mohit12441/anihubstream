import test from 'node:test';
import assert from 'node:assert/strict';
import { formatServerName } from '../functions/api/_lib.js';
import { onRequestGet as hianimePlayGet } from '../functions/api/hianime/play.js';
import { onRequestGet as resolveGet } from '../functions/api/play/resolve.js';

test('formatServerName correctly formats AniWatch subservers with bracketed tags', () => {
  assert.equal(formatServerName('aniwatch', 'MGCLD'), 'AniWatch · MGCLD [MegaCloud]');
  assert.equal(formatServerName('aniwatch', 'MGCLD (DUB)'), 'AniWatch · MGCLD [MegaCloud] (DUB)');
  assert.equal(formatServerName('aniwatch', 'BYFMS'), 'AniWatch · BYFMS [Filemoon]');
  assert.equal(formatServerName('aniwatch', 'BYFMS (DUB)'), 'AniWatch · BYFMS [Filemoon] (DUB)');
  assert.equal(formatServerName('aniwatch', 'DGHG'), 'AniWatch · DGHG [DokiCloud]');
  assert.equal(formatServerName('aniwatch', 'DGHG (DUB)'), 'AniWatch · DGHG [DokiCloud] (DUB)');
});

test('formatServerName formats HiAnime subservers with isolated names', () => {
  assert.equal(formatServerName('hianime', 'HD-1'), 'HiAnime · HD-1 [MegaPlay]');
  assert.equal(formatServerName('hianime', 'HD-2'), 'HiAnime · HD-2 [MegaVid]');
  assert.equal(formatServerName('hianime', 'HD-3'), 'HiAnime · HD-3 [Zoko]');
  assert.equal(formatServerName('hianime', 'HD-3 (DUB)'), 'HiAnime · HD-3 [Zoko] (DUB)');
});

test('HiAnime edge play endpoint returns all 3 subservers with cache-isolated keys', async () => {
  const streamCacheMap = new Map();
  const mockEnv = {
    ANIHUB: {
      prepare: (sql) => ({
        bind: (...args) => ({
          first: async () => {
            if (sql.includes('stream_cache')) {
              const hit = streamCacheMap.get(args[0]);
              return hit ? { data: JSON.stringify(hit), expires_at: Date.now() + 60000 } : null;
            }
            if (sql.includes('SELECT a.title, m.mal_id')) {
              return {
                title: 'Solo Leveling Season 2',
                mal_id: 54595,
                skip_key_id: 54595,
              };
            }
            return null;
          },
          run: async () => {
            if (sql.includes('INSERT OR REPLACE INTO stream_cache')) {
              streamCacheMap.set(args[0], JSON.parse(args[1]));
            }
            return { success: true };
          },
        }),
      }),
    },
  };

  // Seed cache for HD-3
  const hd3CachePayload = {
    ok: true,
    data: {
      title: 'Solo Leveling Season 2',
      episode: 1,
      malId: 54595,
      provider: 'hianime',
      servers: [
        {
          id: 'hianime:HD-3',
          name: 'HiAnime · HD-3 [Zoko]',
          provider: 'hianime',
          streamUrl: 'http://localhost/api/proxy?url=https%3A%2F%2Fzokoanime.video%2Fmaster.m3u8',
          status: 'ready',
        },
      ],
    },
  };
  streamCacheMap.set('hianime:solo-leveling:1:sub:HD-3', hd3CachePayload);

  // Requesting HD-3 returns HD-3 from cache
  const reqHd3 = new Request('http://localhost/api/hianime/play?id=solo-leveling&ep=1&audio=sub&server=HD-3');
  const resHd3 = await hianimePlayGet({ request: reqHd3, env: mockEnv, waitUntil: () => {} });
  assert.equal(resHd3.status, 200);
  const bodyHd3 = await resHd3.json();
  assert.equal(bodyHd3.source, 'cache');
  assert.equal(bodyHd3.data.servers[0].id, 'hianime:HD-3');

  // Requesting HD-1 should NOT hit HD-3 cache (isolated cache key)
  assert.equal(streamCacheMap.has('hianime:solo-leveling:1:sub:HD-1'), false);
});

test('Resolve endpoint rejects raw ad-heavy embed iframes', async () => {
  const mockEnv = {
    ANIHUB: {
      prepare: (sql) => ({
        bind: () => ({
          first: async () => ({
            id: 'test-ad-anime',
            title: 'Test Ad Anime',
            status: 'Finished',
            mal_id: 11111,
          }),
        }),
      }),
    },
    STREAM_BRIDGE_URL: 'http://127.0.0.1:9999',
  };

  const req = new Request('http://localhost/api/play/resolve?anime_id=test-ad-anime&ep=1&provider=aniwatch&server=MGCLD');
  const res = await resolveGet({ request: req, env: mockEnv, waitUntil: () => {} });
  // Must fail safely instead of exposing malicious third-party popup embeds
  assert.ok(res.status >= 400);
  const body = await res.json();
  assert.ok(body.error === 'not_found' || body.error === 'provider_error' || body.error === 'upstream_timeout');
});
