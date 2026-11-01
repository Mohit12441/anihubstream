// @ts-check
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startBridge, stopBridge, clearSessionCache, getSessionCacheSize } from './bridge.mjs';
import { registerAdapter } from './adapters/registry.mjs';

describe('Stream Bridge Microservice Suite (:8795)', () => {
  let bridgeUrl = '';

  before(async () => {
    process.env.BRIDGE_NO_AUTOSTART = '1';
    // Bind to port 0 for dynamic free OS port
    const info = await startBridge(0, '127.0.0.1');
    bridgeUrl = `http://127.0.0.1:${info.port}`;

    // Register a mock fallback adapter with priority 200
    registerAdapter({
      id: 'mock-cascade-provider',
      name: 'MockCascade',
      supportedAudio: ['sub', 'dub'],
      defaultType: 'hls',
      priority: 200,
      search: async (q) => {
        if (q.includes('test-cascade')) {
          return [{ id: 'mock-test-id', slug: 'test-cascade-slug', title: 'Test Cascade Anime' }];
        }
        return [];
      },
      details: async (slug) => {
        if (slug === 'test-cascade-slug') {
          return {
            media: { title: 'Test Cascade Anime' },
            episodes: [{ number: 1, id: 'mock-ep-1', title: 'Episode 1' }],
          };
        }
        return null;
      },
      sources: async (epId) => {
        if (epId === 'mock-ep-1') {
          return { embedUrl: 'https://mock.stream/embed/test-1' };
        }
        return null;
      },
      resolve: async (embedUrl) => {
        if (embedUrl === 'https://mock.stream/embed/test-1') {
          return {
            master: { url: 'https://mock.stream/hls/master.m3u8' },
            streamUrl: 'https://mock.stream/hls/master.m3u8',
            quality: '1080p',
            variants: ['1080p', '720p'],
            proof: { container: 'mpegts', checkedBytes: 188 },
          };
        }
        return null;
      },
    });
  });

  after(async () => {
    clearSessionCache();
    await stopBridge();
  });

  it('GET /health reports healthy status and zero-error metrics', async () => {
    const res = await fetch(`${bridgeUrl}/health`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.status, 'healthy');
    assert.ok(typeof data.uptime === 'number');
    assert.ok(data.mal);
    assert.equal(typeof data.mal.hits, 'number');
    assert.equal(typeof data.mal.misses, 'number');
  });

  it('GET /cache and POST /cache/clear operate correctly', async () => {
    const res1 = await fetch(`${bridgeUrl}/cache`);
    assert.equal(res1.status, 200);
    const data1 = await res1.json();
    assert.equal(data1.ok, true);

    const res2 = await fetch(`${bridgeUrl}/cache/clear`, { method: 'POST' });
    assert.equal(res2.status, 200);
    const data2 = await res2.json();
    assert.equal(data2.ok, true);
    assert.equal(data2.cleared, true);
    assert.equal(data2.size, 0);
  });

  it('GET /resolve rejects impossible title with 404', async () => {
    const res = await fetch(`${bridgeUrl}/resolve?title=unresolvable-bogus-title-xyz-12345&fallback=false`);
    assert.equal(res.status, 404);
    const data = await res.json();
    assert.equal(data.error, 'not_found');
  });

  it('GET /resolve cascades to mock adapter and returns validated stream payload', async () => {
    const res = await fetch(`${bridgeUrl}/resolve?title=test-cascade&ep=1&audio=sub&provider=mock-cascade-provider`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.provider, 'mock-cascade-provider');
    assert.equal(data.master, 'https://mock.stream/hls/master.m3u8');
    assert.equal(data.quality, '1080p');
    assert.equal(data.proof.container, 'mpegts');

    // Second call should return reused: true from in-memory session cache
    const cachedRes = await fetch(`${bridgeUrl}/resolve?title=test-cascade&ep=1&audio=sub&provider=mock-cascade-provider`);
    assert.equal(cachedRes.status, 200);
    const cachedData = await cachedRes.json();
    assert.equal(cachedData.reused, true);
    assert.equal(cachedData.master, 'https://mock.stream/hls/master.m3u8');
  });

  it('GET /resolve supports direct slug parameter lookup', async () => {
    const res = await fetch(`${bridgeUrl}/resolve?title=test-cascade&slug=test-cascade-slug&ep=1&provider=mock-cascade-provider`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.master, 'https://mock.stream/hls/master.m3u8');
  });

  it('OPTIONS preflight returns 204 with CORS headers', async () => {
    const res = await fetch(`${bridgeUrl}/resolve`, { method: 'OPTIONS' });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
  });
});
