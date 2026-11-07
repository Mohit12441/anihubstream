import test from 'node:test';
import assert from 'node:assert/strict';
import { getAdapter, listAdapters, listAdapterIds } from './adapters/registry.mjs';

test('Provider Latency Tiers: Adapters sorted by speed and latency tiers', () => {
  const adapters = listAdapters();
  const ids = listAdapterIds();

  // Active providers priority
  assert.ok(getAdapter('anipm').priority >= 115, 'AniPM must have priority >= 115');
  assert.ok(getAdapter('aniwatch').priority >= 75, 'AniWatch must have priority >= 75');
  assert.ok(getAdapter('hianime').priority >= 70, 'HiAnime must have priority >= 70');
  assert.ok(getAdapter('anikoto').priority >= 65, 'AniKoto must have priority >= 65');
  assert.ok(getAdapter('torrent').priority >= 60, 'Torrent must have priority >= 60');

  // Check hierarchy order
  const anipmIdx = ids.indexOf('anipm');
  const aniwatchIdx = ids.indexOf('aniwatch');
  const hianimeIdx = ids.indexOf('hianime');
  const anikotoIdx = ids.indexOf('anikoto');
  const torrentIdx = ids.indexOf('torrent');

  assert.ok(anipmIdx < aniwatchIdx, 'AniPM before AniWatch');
  assert.ok(aniwatchIdx < hianimeIdx, 'AniWatch before HiAnime');
  assert.ok(hianimeIdx < anikotoIdx, 'HiAnime before AniKoto');
  assert.ok(anikotoIdx < torrentIdx, 'AniKoto before Torrent');
});
