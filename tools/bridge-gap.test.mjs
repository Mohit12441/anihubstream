// @ts-check
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startBridge, stopBridge } from '../api/bridge.mjs';
import { registerAdapter } from '../api/adapters/registry.mjs';

describe('Bridge & Edge Gap Verification Suite', () => {
  let bridgeUrl = '';

  before(async () => {
    process.env.BRIDGE_NO_AUTOSTART = '1';
    const info = await startBridge(0, '127.0.0.1');
    bridgeUrl = `http://127.0.0.1:${info.port}`;

    registerAdapter({
      id: 'mock-direct-mp4',
      name: 'MockDirectMP4',
      supportedAudio: ['sub', 'dub', 'hindi'],
      defaultType: 'mp4',
      priority: 180,
      search: async (q) => {
        if (q.includes('test-direct')) {
          return [{ id: 'mock-direct-id', slug: 'test-direct-slug', title: 'Test Direct Anime' }];
        }
        return [];
      },
      details: async (slug) => {
        if (slug === 'test-direct-slug') {
          return {
            media: { title: 'Test Direct Anime' },
            episodes: [{ number: 1, id: 'mock-direct-ep-1', title: 'Episode 1' }],
          };
        }
        return null;
      },
      sources: async (epId) => {
        if (epId === 'mock-direct-ep-1') {
          return {
            provider: 'mock-direct-mp4',
            embeds: [],
            direct: [
              {
                url: 'https://mock.direct/mp4/test.mp4',
                quality: '1080',
                container: 'mp4',
                codec: 'h264',
              },
            ],
          };
        }
        return null;
      },
      resolve: async (embed) => {
        const streamUrl = typeof embed === 'string' ? embed : embed?.url;
        return {
          provider: 'mock-direct-mp4',
          master: { url: streamUrl },
          streamUrl,
          quality: '1080p',
          variants: ['1080p'],
          subtitles: [],
          proof: { container: 'mp4', checkedBytes: 65 },
        };
      },
    });
  });

  after(async () => {
    await stopBridge();
  });

  it('1. GET /providers returns all 7+ providers with correct defaultType and supportedAudio', async () => {
    const res = await fetch(`${bridgeUrl}/providers`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);

    const provs = data.providers;
    assert.ok(Array.isArray(provs));
    assert.ok(provs.length >= 7);

    // Verify WatchAnimeWorld provider metadata
    const waw = provs.find((p) => p.id === 'watchanimeworld');
    assert.ok(waw, 'watchanimeworld should be registered');
    assert.equal(waw.defaultType, 'mp4');
    assert.ok(waw.supportedAudio.includes('hindi'));

    // Verify AnimeWave and AnimeKai
    assert.ok(provs.some((p) => p.id === 'animewave'));
    assert.ok(provs.some((p) => p.id === 'animekai'));
  });

  it('2. GET /search matches Edge functions/api/search.js contract', async () => {
    const res = await fetch(`${bridgeUrl}/search?q=test-direct&provider=mock-direct-mp4`);
    assert.equal(res.status, 200);
    const items = await res.json();

    // Edge requires a direct array response
    assert.ok(Array.isArray(items), 'search must return an array for edge parser');
    assert.equal(items.length, 1);
    assert.equal(items[0].id, 'mock-direct-id');
    assert.equal(items[0].slug, 'test-direct-slug');
    assert.equal(items[0].title, 'Test Direct Anime');
    assert.equal(items[0].provider, 'mock-direct-mp4');
  });

  it('3. GET /details and /episodes handle upstream discovery', async () => {
    const res = await fetch(`${bridgeUrl}/details?provider=mock-direct-mp4&slug=test-direct-slug`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.details.media.title, 'Test Direct Anime');

    const epRes = await fetch(`${bridgeUrl}/episodes?provider=mock-direct-mp4&slug=test-direct-slug`);
    assert.equal(epRes.status, 200);
    const epData = await epRes.json();
    assert.equal(epData.ok, true);
    assert.equal(epData.episodes.length, 1);
  });

  it('4. GET /resolve fallback cascade handles direct MP4 streams seamlessly', async () => {
    const res = await fetch(`${bridgeUrl}/resolve?title=test-direct&ep=1&audio=sub&provider=mock-direct-mp4`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.provider, 'mock-direct-mp4');
    assert.equal(data.master, 'https://mock.direct/mp4/test.mp4');
    assert.equal(data.proof.container, 'mp4');
  });

  it('5. GET /dub-check handles audio verification requests gracefully', async () => {
    const res = await fetch(`${bridgeUrl}/dub-check?sub=https://mock.sub&dub=https://mock.dub&provider=mock-direct-mp4`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.ok(typeof data.verdict === 'string');
  });
});
