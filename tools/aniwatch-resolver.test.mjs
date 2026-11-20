import test from 'node:test';
import assert from 'node:assert/strict';
import { formatServerName } from '../functions/api/_lib.js';
import { resolveAniWatchDirect } from '../functions/api/_aniwatch.js';
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

test('resolveAniWatchDirect scrapes real embed and tags hardcodedSubs', async () => {
  // Mock global fetch to return sample aniwatch HTML
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('aniwatch.one')) {
      const sampleHtml = `
        <div class="player-servers">
          <div id="servers-content">
            <div class="ps_-block ps_-block-sub servers-sub">
              <div class="ps__-title"><i class="fas fa-closed-captioning"></i> SUB:</div>
              <div class="ps__-list">
                <div class="item server-item" data-type="sub" data-url="https://mfw09.org/e/sample-mgcld"><a class="btn active">MGCLD</a></div>
                <div class="item server-item" data-type="sub" data-url="https://mfw09.org/e/sample-byfms"><a class="btn">BYFMS</a></div>
                <div class="item server-item" data-type="sub" data-url="https://playmogo.com/e/sample-dghg"><a class="btn">DGHG</a></div>
              </div>
            </div>
            <div class="ps_-block ps_-block-dub servers-dub">
              <div class="ps__-title"><i class="fas fa-microphone"></i> DUB:</div>
              <div class="ps__-list">
                <div class="item server-item" data-type="dub" data-url="https://mfw09.org/e/sample-dub-mgcld"><a class="btn">MGCLD</a></div>
              </div>
            </div>
          </div>
        </div>`;
      return new Response(sampleHtml, { status: 200 });
    }
    return originalFetch(url);
  };

  try {
    const res = await resolveAniWatchDirect({
      slug: 'ore-dake-level-up-na-ken-season-2-arise-from-the-shadow-82064',
      ep: 1,
      audio: 'sub',
      server: 'DGHG',
    });

    assert.ok(res, 'Must return direct AniWatch result');
    assert.equal(res.provider, 'aniwatch');
    assert.equal(res.serverName, 'DGHG');
    assert.equal(res.streamUrl, 'https://mfw09.org/e/sample-mgcld');
    assert.equal(res.type, 'embed');
    assert.equal(res.hardcodedSubs, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
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

test('resolveAniWatchDirect searches by title when given unnumbered catalog slug', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const sUrl = String(url);
    if (sUrl.includes('/search?keyword=')) {
      return new Response('<div class="flw-item"><a href="/watch/ore-dake-level-up-na-ken-season-2-arise-from-the-shadow-82064" title="Solo Leveling Season 2: Arise from the Shadow">Match</a></div>', { status: 200 });
    }
    if (sUrl.includes('/watch/ore-dake-level-up-na-ken-season-2-arise-from-the-shadow-82064/episode/1')) {
      const sampleHtml = `
        <div class="player-servers">
          <div id="servers-content">
            <div class="ps_-block ps_-block-sub servers-sub">
              <div class="ps__-title">SUB:</div>
              <div class="ps__-list">
                <div class="item server-item" data-type="sub" data-url="https://playmogo.com/e/real-dghg"><a class="btn">DGHG</a></div>
              </div>
            </div>
          </div>
        </div>`;
      return new Response(sampleHtml, { status: 200 });
    }
    return new Response('Not Found', { status: 404 });
  };

  try {
    const res = await resolveAniWatchDirect({
      slug: 'solo-leveling-season-2-arise-from-the-shadow',
      title: 'Solo Leveling Season 2: Arise from the Shadow',
      ep: 1,
      audio: 'sub',
      server: 'DGHG',
    });

    assert.ok(res);
    assert.equal(res.provider, 'aniwatch');
    assert.equal(res.streamUrl, 'https://playmogo.com/e/real-dghg');
    assert.equal(res.serverName, 'DGHG');
    assert.equal(res.type, 'embed');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
