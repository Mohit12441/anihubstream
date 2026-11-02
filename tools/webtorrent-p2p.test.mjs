import test from 'node:test';
import assert from 'node:assert/strict';

import {
  deriveInfoHash,
  buildMagnetUri,
  P2PTorrentStreamer,
  WEBRTC_TRACKERS,
} from '../src/lib/webtorrentStreamer.ts';

import { getAdapter, listAdapterIds } from '../api/adapters/registry.mjs';

test('WebTorrent Streamer: deriveInfoHash generates deterministic 40-char hex hash', () => {
  const hash1 = deriveInfoHash('Solo Leveling', 1, '1080p');
  const hash2 = deriveInfoHash('Solo Leveling', 1, '1080p');
  const hashDiffEp = deriveInfoHash('Solo Leveling', 2, '1080p');

  assert.equal(typeof hash1, 'string');
  assert.equal(hash1.length, 40);
  assert.match(hash1, /^[0-9a-f]{40}$/);
  // Identical inputs yield identical swarm infoHash
  assert.equal(hash1, hash2);
  // Different episode yields distinct swarm infoHash
  assert.notEqual(hash1, hashDiffEp);
});

test('WebTorrent Streamer: buildMagnetUri embeds standard RFC 3986 WebRTC trackers', () => {
  const meta = buildMagnetUri('Frieren: Beyond Journey\'s End', 12, '1080p');

  assert.ok(meta.magnetUri.startsWith('magnet:?xt=urn:btih:'));
  assert.ok(meta.magnetUri.includes(meta.infoHash));
  assert.ok(meta.magnetUri.includes('dn=%5BAniHub%5D%20Frieren%20Beyond%20Journeys%20End'));

  // Ensure all WebRTC trackers are present
  for (const tr of WEBRTC_TRACKERS) {
    assert.ok(meta.magnetUri.includes(encodeURIComponent(tr)), `contains tracker ${tr}`);
  }
});

test('WebTorrent Streamer: P2PTorrentStreamer manages swarm state and telemetry', async () => {
  const streamer = new P2PTorrentStreamer('Chainsaw Man', 1, '1080p');
  const initialStats = streamer.getStats();

  assert.equal(initialStats.status, 'idle');
  assert.equal(initialStats.peers, 0);
  assert.ok(initialStats.swarmId.length === 40);

  let notified = false;
  const unsub = streamer.subscribe((stats) => {
    notified = true;
    assert.ok(stats.swarmId);
  });

  assert.equal(notified, true);
  unsub();
  streamer.destroy();
  assert.equal(streamer.getStats().status, 'idle');
});

test('Adapter Registry: registers torrent P2P fallback adapter', async () => {
  const adapter = getAdapter('torrent');
  assert.ok(adapter, 'torrent adapter exists in registry');
  assert.equal(adapter.id, 'torrent');
  assert.equal(adapter.name, 'P2P Swarm');
  assert.equal(adapter.defaultType, 'hls');

  const allIds = listAdapterIds();
  assert.ok(allIds.includes('torrent'), 'listAdapterIds includes torrent');

  const resolved = await adapter.resolve('magnet:?xt=urn:btih:123456');
  assert.equal(resolved.provider, 'torrent');
  assert.equal(resolved.streamUrl, 'magnet:?xt=urn:btih:123456');
});
