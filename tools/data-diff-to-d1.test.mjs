import test from 'node:test';
import assert from 'node:assert/strict';
import { generateDeltaSqlFromDocs } from './data-diff-to-d1.mjs';

test('data-diff-to-d1: generates SQL upsert statements for modified anime doc', () => {
  const sampleDoc = {
    id: 'frieren-test',
    title: 'Frieren Test',
    year: 2023,
    rating: 9.1,
    genres: ['adventure', 'drama'],
    episodes: [
      {
        n: 1,
        title: 'Ep 1',
        runtime: '24:00',
        runtime_seconds: 1440,
        thumb: 'https://example.com/1.jpg'
      }
    ]
  };

  const delta = generateDeltaSqlFromDocs({
    modifiedDocs: [{ type: 'anime', doc: sampleDoc }],
    batchSize: 50
  });

  assert.equal(delta.success, true);
  assert.equal(delta.totalWrites, 4); // 1 anime + 2 genres + 1 episode
  assert.ok(delta.batches.length > 0);

  const fullSql = delta.batches.flat().join('\n');
  assert.ok(fullSql.includes("INSERT INTO anime"));
  assert.ok(fullSql.includes("ON CONFLICT(id) DO UPDATE SET"));
  assert.ok(fullSql.includes("INSERT OR REPLACE INTO episode"));
  assert.ok(fullSql.includes("frieren-test#1"));
});

test('data-diff-to-d1: enforces quota ceiling when writes exceed threshold', () => {
  const sampleDoc = {
    id: 'big-anime',
    title: 'Big Anime',
    year: 2024,
    rating: 8.0,
    episodes: [
      { n: 1, title: 'Ep 1' },
      { n: 2, title: 'Ep 2' },
      { n: 3, title: 'Ep 3' }
    ]
  };

  assert.throws(
    () => {
      generateDeltaSqlFromDocs({
        modifiedDocs: [{ type: 'anime', doc: sampleDoc }],
        maxWrites: 2, // low ceiling
        force: false
      });
    },
    /Write quota ceiling exceeded/
  );

  // With force=true, it should pass
  const forcedDelta = generateDeltaSqlFromDocs({
    modifiedDocs: [{ type: 'anime', doc: sampleDoc }],
    maxWrites: 2,
    force: true
  });
  assert.equal(forcedDelta.success, true);
});
