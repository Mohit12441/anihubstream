import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyDataParity } from './data-verify-parity.mjs';

test('data-verify-parity: verifies parity between database and data/ directory', async () => {
  const report = await verifyDataParity({ source: 'local' });

  assert.equal(typeof report.isPureParity, 'boolean');
  assert.equal(typeof report.mismatches, 'number');
  assert.ok(Array.isArray(report.tableChecks));

  // Should have checked anime, episode, and genre
  const animeCheck = report.tableChecks.find(c => c.table === 'anime');
  assert.ok(animeCheck, 'Should include anime table check');
  assert.equal(animeCheck.dbCount, animeCheck.dataCount);
  assert.equal(animeCheck.discrepancy, 0);

  assert.equal(report.isPureParity, true);
  assert.equal(report.mismatches, 0);
});
