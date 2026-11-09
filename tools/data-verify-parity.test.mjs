import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyDataParity } from './data-verify-parity.mjs';
import { buildLocalDatabase } from './data-build-local.mjs';
import { getLocalSqlitePath } from './data-pull-pure.mjs';
import { DatabaseSync } from 'node:sqlite';

test('data-verify-parity: verifies parity between database and data/ directory', async () => {
  const dbPath = getLocalSqlitePath();
  const db = new DatabaseSync(dbPath);
  let count = 0;
  try {
    const row = /** @type {any} */ (db.prepare('SELECT count(*) as c FROM anime').get());
    count = row?.c || 0;
  } catch {}
  db.close();

  // If running in clean CI environment without pre-populated SQLite, build from data/ first
  if (count === 0) {
    await buildLocalDatabase({ dbPath });
  }

  const report = await verifyDataParity({ source: 'local', dbPath });

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
