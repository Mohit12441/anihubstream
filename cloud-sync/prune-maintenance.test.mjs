// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pruneSyncRuns,
  pruneApiUsage,
  purgeExpiredLocks,
  selfHealSearchVectors,
  runMaintenancePass,
  PRUNE_RETENTION_DAYS,
} from './prune-maintenance.mjs';

test('prune-maintenance exports expected functions and constants', () => {
  assert.equal(typeof pruneSyncRuns, 'function');
  assert.equal(typeof pruneApiUsage, 'function');
  assert.equal(typeof purgeExpiredLocks, 'function');
  assert.equal(typeof selfHealSearchVectors, 'function');
  assert.equal(typeof runMaintenancePass, 'function');
  assert.equal(typeof PRUNE_RETENTION_DAYS, 'number');
  assert.ok(PRUNE_RETENTION_DAYS > 0);
});
