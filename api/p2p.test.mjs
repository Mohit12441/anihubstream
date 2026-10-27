// @ts-check
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { P2PEngine, buildSwarmId, normalizeSegmentKey } from '../src/lib/p2pEngine.ts';

describe('P2P Swarm & Segment Coordinator Tests', () => {
  it('buildSwarmId produces deterministic canonical swarm identifiers', () => {
    const s1 = buildSwarmId('hianime:frieren-beyond-journeys-end-12345', 1, '1080p');
    const s2 = buildSwarmId('anikoto:frieren-beyond-journeys-end', 1, '1080p');
    const s3 = buildSwarmId('Frieren: Beyond Journey\'s End', 1, '1080p');

    assert.strictEqual(s1, 'anihub:frieren-beyond-journeys-end-12345:ep1:1080p');
    assert.strictEqual(s2, 'anihub:frieren-beyond-journeys-end:ep1:1080p');
    assert.strictEqual(s3, 'anihub:frieren-beyond-journey-s-end:ep1:1080p');
  });

  it('normalizeSegmentKey strips dynamic HMAC tokens and query params from chunk URLs', () => {
    const swarm = 'anihub:frieren:ep1:1080p';
    const raw1 = 'https://fetch.nexabloom.top/anime/frieren/seg-001.ts?token=exp123.sig456';
    const raw2 = 'https://fetch.nexabloom.top/anime/frieren/seg-001.ts?token=exp789.sig999';
    const raw3 = '/api/proxy?url=https%3A%2F%2Fmegaplay.buzz%2Fseg-001.ts&referer=abc';

    const k1 = normalizeSegmentKey(swarm, raw1);
    const k2 = normalizeSegmentKey(swarm, raw2);
    const k3 = normalizeSegmentKey(swarm, raw3);

    assert.strictEqual(k1, 'anihub:frieren:ep1:1080p#seg-001.ts');
    assert.strictEqual(k2, 'anihub:frieren:ep1:1080p#seg-001.ts');
    assert.strictEqual(k1, k2, 'Chunks with different tokens for the same segment must produce identical keys');
    assert.strictEqual(k3, 'anihub:frieren:ep1:1080p#seg-001.ts', 'Proxied segment URL must resolve to actual segment filename');
  });

  it('P2PEngine blocks P2P and uploads when cellular/metered connection is detected', async () => {
    const engine = new P2PEngine(true, 'anihub:test-cellular:ep1:1080p', { forceCellular: true });
    const stats = engine.getStats();

    assert.strictEqual(stats.enabled, false, 'P2P must be disabled on cellular');
    assert.strictEqual(stats.cellularBlocked, true, 'cellularBlocked flag must be true');

    let httpCalls = 0;
    const mockHttp = async () => {
      httpCalls++;
      return new Uint8Array([1, 2, 3]).buffer;
    };

    const res = await engine.loadSegment('https://cdn.example.com/cell-chunk.ts', mockHttp);
    assert.strictEqual(res.source, 'http');
    assert.strictEqual(httpCalls, 1);

    engine.destroy();
  });

  it('P2PEngine defaults to HTTP when disabled, recording accurate byte statistics', async () => {
    const engine = new P2PEngine(false, 'anihub:test:ep1:1080p');
    let httpCalls = 0;

    const mockHttp = async () => {
      httpCalls++;
      return new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer;
    };

    const res1 = await engine.loadSegment('https://cdn.example.com/chunk-1.ts', mockHttp);
    assert.strictEqual(res1.source, 'http');
    assert.strictEqual(httpCalls, 1);

    const stats = engine.getStats();
    assert.strictEqual(stats.enabled, false);
    assert.strictEqual(stats.httpBytes, 8);
    assert.strictEqual(stats.p2pBytes, 0);
    assert.strictEqual(stats.p2pRatio, 0);

    engine.destroy();
  });

  it('P2PEngine falls back to HTTP immediately if peers timeout or fail', async () => {
    const engine = new P2PEngine(true, 'anihub:test-timeout:ep1:1080p');
    let httpCalls = 0;

    const mockHttp = async () => {
      httpCalls++;
      return new Uint8Array([10, 20, 30, 40]).buffer;
    };

    // Even if enabled, without peers in the swarm it fetches via HTTP with zero stalls
    const res = await engine.loadSegment('https://cdn.example.com/chunk-99.ts', mockHttp, 50);
    assert.strictEqual(res.source, 'http');
    assert.strictEqual(httpCalls, 1);

    const stats = engine.getStats();
    assert.strictEqual(stats.httpBytes, 4);
    assert.strictEqual(stats.p2pBytes, 0);

    engine.destroy();
  });

  it('P2PEngine serves repeated chunks from local memory cache without repeating HTTP calls', async () => {
    const engine = new P2PEngine(true, 'anihub:test-cache:ep1:1080p');
    let httpCalls = 0;

    const mockHttp = async () => {
      httpCalls++;
      return new Uint8Array([100, 200]).buffer;
    };

    const chunkUrl = 'https://cdn.example.com/loop-1.ts';
    const r1 = await engine.loadSegment(chunkUrl, mockHttp);
    const r2 = await engine.loadSegment(chunkUrl, mockHttp);

    assert.strictEqual(r1.source, 'http');
    assert.strictEqual(r2.source, 'p2p', 'Second request should hit memory cache');
    assert.strictEqual(httpCalls, 1, 'Upstream HTTP should only be called once');

    engine.destroy();
  });

  it('Cloudflare Worker + Durable Object relays WebRTC signaling over WebSockets', async () => {
    const signalingWorker = (await import('../workers/p2p-signaling/index.js')).default;
    const { SwarmDurableObject } = await import('../workers/p2p-signaling/index.js');

    // 1. Health endpoint test
    const req = new Request('http://localhost/health');
    const res = await signalingWorker.fetch(req, {});
    assert.strictEqual(res.status, 200);
    const health = await res.json();
    assert.strictEqual(health.ok, true);
    assert.strictEqual(health.service, 'anihub-p2p-signal');
    assert.strictEqual(health.hibernation, true);

    // 2. Durable Object Swarm message broadcast test
    const activeSockets = new Set();
    const mockState = {
      acceptWebSocket: (ws) => { activeSockets.add(ws); },
      getWebSockets: () => Array.from(activeSockets),
    };

    const swarmDO = new SwarmDurableObject(mockState, {});

    const sentToWsB = [];
    const mockWsA = {
      send: () => {},
      serializeAttachment: () => {},
      deserializeAttachment: () => ({ peerId: 'peer-alpha' }),
      close: () => {},
    };
    const mockWsB = {
      send: (data) => { sentToWsB.push(JSON.parse(data)); },
      serializeAttachment: () => {},
      deserializeAttachment: () => ({ peerId: 'peer-beta' }),
      close: () => {},
    };

    activeSockets.add(mockWsA);
    activeSockets.add(mockWsB);

    // Peer A sends offer -> Durable Object broadcasts to Peer B
    swarmDO.webSocketMessage(mockWsA, JSON.stringify({
      type: 'offer',
      peerId: 'peer-alpha',
      sdp: 'mock-sdp-offer',
    }));

    assert.strictEqual(sentToWsB.length, 1);
    assert.strictEqual(sentToWsB[0].type, 'offer');
    assert.strictEqual(sentToWsB[0].peerId, 'peer-alpha');

    // Peer A closes connection -> Durable Object announces 'bye' to Peer B
    swarmDO.webSocketClose(mockWsA, 1000, 'Normal Closure', true);
    assert.strictEqual(sentToWsB.length, 2);
    assert.strictEqual(sentToWsB[1].type, 'bye');
    assert.strictEqual(sentToWsB[1].peerId, 'peer-alpha');
  });
});
