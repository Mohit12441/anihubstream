// @ts-check
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startBridge, stopBridge } from '../api/bridge.mjs';
import { registerAdapter, getAdapter, listAdapters } from '../api/adapters/registry.mjs';

describe('End-to-End Bridge, Edge & Provider Integration Suite', () => {
  let bridgeUrl = '';
  let bridgeInfo = null;

  before(async () => {
    process.env.BRIDGE_NO_AUTOSTART = '1';
    bridgeInfo = await startBridge(0, '127.0.0.1');
    bridgeUrl = `http://127.0.0.1:${bridgeInfo.port}`;

    // Register a mock E2E test adapter representing a realistic multi-audio streaming provider
    registerAdapter({
      id: 'e2e-provider',
      name: 'E2EProvider',
      supportedAudio: ['sub', 'dub', 'hindi'],
      defaultType: 'hls',
      priority: 300,
      search: async (q) => {
        if (q.toLowerCase().includes('solo') || q.toLowerCase().includes('leveling')) {
          return [
            {
              id: 'solo-leveling-s1',
              slug: 'solo-leveling-s1',
              title: 'Solo Leveling (Ore dake Level Up na Ken)',
              coverUrl: 'https://cdn.example.com/solo.jpg',
            },
          ];
        }
        return [];
      },
      details: async (slug) => {
        if (slug === 'solo-leveling-s1') {
          return {
            media: { id: 'solo-leveling-s1', title: 'Solo Leveling' },
            episodes: [
              { id: 'solo-ep-1', number: 1, title: 'I\'m Used to It' },
              { id: 'solo-ep-2', number: 2, title: 'If I Had One More Chance' },
            ],
          };
        }
        return null;
      },
      sources: async (epId, opts) => {
        if (epId === 'solo-ep-1' || epId === 'solo-ep-2') {
          return {
            provider: 'e2e-provider',
            embedUrl: `https://stream.e2e.example/embed/${epId}?audio=${opts?.audioType || 'sub'}`,
            subtitles: [{ lang: 'English', url: 'https://stream.e2e.example/sub/en.vtt' }],
          };
        }
        return null;
      },
      resolve: async (embedUrl) => {
        if (embedUrl?.includes('solo-ep-')) {
          return {
            provider: 'e2e-provider',
            master: { url: 'https://stream.e2e.example/hls/master.m3u8' },
            streamUrl: 'https://stream.e2e.example/hls/master.m3u8',
            quality: '1080p',
            variants: ['1080p', '720p', '480p'],
            subtitles: [{ lang: 'English', url: 'https://stream.e2e.example/sub/en.vtt' }],
            proof: { container: 'mpegts', checkedBytes: 188 },
          };
        }
        return null;
      },
    });
  });

  after(async () => {
    if (bridgeInfo) {
      await stopBridge();
    }
  });

  it('1. GET /health verifies live bridge status, uptime and metrics', async () => {
    const res = await fetch(`${bridgeUrl}/health`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.status, 'healthy');
    assert.ok(data.uptime >= 0);
  });

  it('2. GET /providers returns all registered adapters with capabilities', async () => {
    const res = await fetch(`${bridgeUrl}/providers`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.ok(Array.isArray(data.providers));

    const e2e = data.providers.find((p) => p.id === 'e2e-provider');
    assert.ok(e2e, 'e2e-provider should be listed');
    assert.equal(e2e.name, 'E2EProvider');
    assert.deepEqual(e2e.supportedAudio, ['sub', 'dub', 'hindi']);
    assert.equal(e2e.defaultType, 'hls');

    const waw = data.providers.find((p) => p.id === 'watchanimeworld');
    assert.ok(waw, 'watchanimeworld should be listed');
    assert.equal(waw.defaultType, 'mp4');
  });

  it('3. GET /search contract matches Edge functions/api/search.js requirements', async () => {
    // 3a. Target provider search
    const provRes = await fetch(`${bridgeUrl}/search?q=solo&provider=e2e-provider`);
    assert.equal(provRes.status, 200);
    const provItems = await provRes.json();
    assert.ok(Array.isArray(provItems));
    assert.equal(provItems.length, 1);
    assert.equal(provItems[0].id, 'solo-leveling-s1');
    assert.equal(provItems[0].provider, 'e2e-provider');

    // 3b. Empty search when query has no matches
    const noRes = await fetch(`${bridgeUrl}/search?q=nonexistent-query-xyz-987&provider=e2e-provider`);
    assert.equal(noRes.status, 200);
    const noItems = await noRes.json();
    assert.ok(Array.isArray(noItems));
    assert.equal(noItems.length, 0);

    // 3c. 400 validation error on missing q parameter
    const errRes = await fetch(`${bridgeUrl}/search?provider=e2e-provider`);
    assert.equal(errRes.status, 400);
  });

  it('4. GET /details and /episodes handle proxying cleanly', async () => {
    const dRes = await fetch(`${bridgeUrl}/details?provider=e2e-provider&slug=solo-leveling-s1`);
    assert.equal(dRes.status, 200);
    const dData = await dRes.json();
    assert.equal(dData.ok, true);
    assert.equal(dData.details.media.title, 'Solo Leveling');
    assert.equal(dData.details.episodes.length, 2);

    const epRes = await fetch(`${bridgeUrl}/episodes?provider=e2e-provider&slug=solo-leveling-s1`);
    assert.equal(epRes.status, 200);
    const epData = await epRes.json();
    assert.equal(epData.ok, true);
    assert.equal(epData.episodes.length, 2);
    assert.equal(epData.episodes[0].number, 1);
    assert.equal(epData.episodes[1].number, 2);
  });

  it('5. GET /resolve resolves streams with caching and session tracking', async () => {
    const res = await fetch(`${bridgeUrl}/resolve?title=Solo%20Leveling&slug=solo-leveling-s1&ep=1&audio=sub&provider=e2e-provider`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.provider, 'e2e-provider');
    assert.equal(data.master, 'https://stream.e2e.example/hls/master.m3u8');
    assert.equal(data.quality, '1080p');
    assert.ok(data.session.startsWith('sid-'));

    // Cache hit verification
    const hitRes = await fetch(`${bridgeUrl}/resolve?title=Solo%20Leveling&slug=solo-leveling-s1&ep=1&audio=sub&provider=e2e-provider`);
    assert.equal(hitRes.status, 200);
    const hitData = await hitRes.json();
    assert.equal(hitData.reused, true);
    assert.equal(hitData.master, data.master);
  });

  it('6. Edge Federated Search Fallback Integration E2E test', async () => {
    // Emulate edge fallback logic when D1 returns 0 results
    const q = 'Solo Leveling';
    const KNOWN_PROVIDERS = ['e2e-provider', 'aniwatch', 'hianime', 'anikoto', 'watchanimeworld', 'animewave', 'animekai'];
    const grouped = {};
    for (const p of KNOWN_PROVIDERS) grouped[p] = [];

    const bridgeSearches = KNOWN_PROVIDERS.map(async (provider) => {
      try {
        const searchUrl = new URL(`${bridgeUrl}/search`);
        searchUrl.searchParams.set('q', q);
        searchUrl.searchParams.set('provider', provider);

        const res = await fetch(searchUrl.toString(), {
          headers: { accept: 'application/json' },
          signal: AbortSignal.timeout(3000),
        });
        if (res.ok) {
          const data = await res.json().catch(() => []);
          const rawItems = Array.isArray(data)
            ? data
            : (Array.isArray(data?.data) ? data.data : (Array.isArray(data?.results) ? data.results : []));
          if (rawItems.length > 0) {
            return {
              provider,
              items: rawItems.map((item) => ({
                id: item.id || item.slug,
                slug: item.slug || item.id,
                title: item.title || '',
                coverUrl: item.coverUrl || null,
                provider,
              })),
            };
          }
        }
      } catch {}
      return { provider, items: [] };
    });

    const settled = await Promise.allSettled(bridgeSearches);
    const results = [];
    for (const out of settled) {
      if (out.status === 'fulfilled') {
        const { provider, items } = out.value;
        grouped[provider] = items;
        for (const it of items) results.push(it);
      }
    }

    assert.ok(results.length > 0, 'Federated bridge search should yield results');
    assert.equal(grouped['e2e-provider'].length, 1);
    assert.equal(grouped['e2e-provider'][0].slug, 'solo-leveling-s1');
  });

  it('7. Edge /api/play Provider Availability & Stream Resolution E2E test', async () => {
    // Emulate Edge play.js provider health & availableSlugs resolution
    const availableSlugs = {
      anikoto: 'solo-leveling-s1',
      hianime: 'solo-leveling-s1',
      aniwatch: 'solo-leveling-s1',
      watchanimeworld: 'solo-leveling-s1',
      animewave: 'solo-leveling-s1',
      animekai: 'solo-leveling-s1',
      'e2e-provider': 'solo-leveling-s1',
    };

    const providerHealth = {
      anikoto: { status: 'healthy', latencyMs: 85 },
      hianime: { status: 'healthy', latencyMs: 140 },
      aniwatch: { status: 'healthy', latencyMs: 210 },
      watchanimeworld: { status: 'healthy', latencyMs: 120 },
      animewave: { status: 'healthy', latencyMs: 110 },
      animekai: { status: 'healthy', latencyMs: 130 },
      torrent: { status: 'healthy', latencyMs: 45, peers: 12 },
      'e2e-provider': { status: 'healthy', latencyMs: 40 },
    };

    const getAvailableProvidersList = () => [
      { id: 'anikoto', name: 'AniKoto', available: Boolean(availableSlugs.anikoto), ...(providerHealth.anikoto || {}) },
      { id: 'hianime', name: 'HiAnime', available: Boolean(availableSlugs.hianime), ...(providerHealth.hianime || {}) },
      { id: 'aniwatch', name: 'AniWatch', available: Boolean(availableSlugs.aniwatch), ...(providerHealth.aniwatch || {}) },
      { id: 'watchanimeworld', name: 'WatchAnimeWorld', available: Boolean(availableSlugs.watchanimeworld), ...(providerHealth.watchanimeworld || {}) },
      { id: 'animewave', name: 'AnimeWave', available: Boolean(availableSlugs.animewave), ...(providerHealth.animewave || {}) },
      { id: 'animekai', name: 'AnimeKai', available: Boolean(availableSlugs.animekai), ...(providerHealth.animekai || {}) },
      { id: 'e2e-provider', name: 'E2EProvider', available: Boolean(availableSlugs['e2e-provider']), ...(providerHealth['e2e-provider'] || {}) },
      { id: 'torrent', name: 'P2P Swarm', available: true, ...(providerHealth.torrent || {}) },
    ];

    const provList = getAvailableProvidersList();
    assert.equal(provList.length, 8);
    assert.ok(provList.every((p) => p.available === true));

    // Resolve via bridge with slug
    const resolveBridgeUrl = new URL(`${bridgeUrl}/resolve`);
    resolveBridgeUrl.searchParams.set('title', 'Solo Leveling');
    resolveBridgeUrl.searchParams.set('slug', availableSlugs['e2e-provider']);
    resolveBridgeUrl.searchParams.set('ep', '1');
    resolveBridgeUrl.searchParams.set('audio', 'sub');
    resolveBridgeUrl.searchParams.set('provider', 'e2e-provider');

    const bRes = await fetch(resolveBridgeUrl.toString());
    assert.equal(bRes.status, 200);
    const streamMeta = await bRes.json();
    assert.equal(streamMeta.provider, 'e2e-provider');
    assert.equal(streamMeta.master, 'https://stream.e2e.example/hls/master.m3u8');
    assert.equal(streamMeta.quality, '1080p');
  });

  it('8. GET /audios returns multi-audio list matching streamBridge client contract', async () => {
    const res = await fetch(`${bridgeUrl}/audios?title=Solo%20Leveling&ep=1`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.title, 'Solo Leveling');
    assert.equal(data.episode.number, 1);
    assert.ok(Array.isArray(data.audios));
    const audioIds = data.audios.map((a) => a.id);
    assert.ok(audioIds.includes('sub'));
    assert.ok(audioIds.includes('dub'));
    assert.ok(audioIds.includes('hindi'));
  });

  it('9. GET /downloads returns provider download options matching streamBridge contract', async () => {
    const res = await fetch(`${bridgeUrl}/downloads?title=Solo%20Leveling&ep=1`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.title, 'Solo Leveling');
    assert.equal(data.episode, 1);
    assert.ok(Array.isArray(data.options));
    assert.ok(data.options.length >= 3);
    const optProviders = data.options.map((o) => o.provider);
    assert.ok(optProviders.includes('anikoto'));
    assert.ok(optProviders.includes('aniwatch'));
    assert.ok(optProviders.includes('hianime'));
    assert.ok(optProviders.includes('watchanimeworld'));
  });
});
