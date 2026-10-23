// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  syncAniKotoMappings,
  syncAniWatchMappings,
  syncFranchiseRelations,
  normalizeRatings,
} from './sync-providers.mjs';

test('sync-providers exports expected functions', () => {
  assert.equal(typeof syncAniKotoMappings, 'function');
  assert.equal(typeof syncAniWatchMappings, 'function');
  assert.equal(typeof syncFranchiseRelations, 'function');
  assert.equal(typeof normalizeRatings, 'function');
});
