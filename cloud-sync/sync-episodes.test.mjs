// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  syncEpisodes,
  fetchKitsuEpisodes,
  fetchAniSkipMarkers,
  EPISODES_BATCH_LIMIT,
} from './sync-episodes.mjs';

test('sync-episodes exports expected functions and batch limits', () => {
  assert.equal(typeof syncEpisodes, 'function');
  assert.equal(typeof fetchKitsuEpisodes, 'function');
  assert.equal(typeof fetchAniSkipMarkers, 'function');
  assert.equal(typeof EPISODES_BATCH_LIMIT, 'number');
  assert.ok(EPISODES_BATCH_LIMIT > 0);
});

test('fetchKitsuEpisodes returns empty array when kitsuId is null', async () => {
  const eps = await fetchKitsuEpisodes(null);
  assert.deepEqual(eps, []);
});

test('fetchAniSkipMarkers returns empty array when malId is null or non-positive', async () => {
  const m1 = await fetchAniSkipMarkers(null, 1);
  const m2 = await fetchAniSkipMarkers(-5, 1);
  assert.deepEqual(m1, []);
  assert.deepEqual(m2, []);
});
