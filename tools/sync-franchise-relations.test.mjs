import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  TokenBucketLimiter,
  normalizeRelationType,
  parseAnilistRelations,
  parseJikanRelations,
  persistFranchiseRelations,
  mergeFranchiseRelations,
} from './sync-franchise-relations.mjs';

test('TokenBucketLimiter: enforces pacing between requests', async () => {
  const limiter = new TokenBucketLimiter(50);
  const start = Date.now();
  await limiter.wait();
  await limiter.wait();
  const elapsed = Date.now() - start;
  assert.ok(elapsed >= 45, `Expected elapsed >= 45ms, got ${elapsed}ms`);
});

test('normalizeRelationType: maps upstream relation formats correctly', () => {
  assert.equal(normalizeRelationType('PREQUEL'), 'prequel');
  assert.equal(normalizeRelationType('SEQUEL'), 'sequel');
  assert.equal(normalizeRelationType('SIDE_STORY'), 'side_story');
  assert.equal(normalizeRelationType('SPIN_OFF'), 'spin_off');
  assert.equal(normalizeRelationType('PARENT'), 'parent');
  assert.equal(normalizeRelationType('ALTERNATIVE'), 'alternative');
  assert.equal(normalizeRelationType('SUMMARY'), 'summary');
  assert.equal(normalizeRelationType('CHARACTER', 'MOVIE'), 'movie');
  assert.equal(normalizeRelationType('Side story'), 'side_story');
  assert.equal(normalizeRelationType('Prequel'), 'prequel');
});

test('parseAnilistRelations: converts AniList edges into internal relation records', () => {
  const anilistToSlug = new Map([
    [101922, 'demon-slayer'],
    [113415, 'jujutsu-kaisen'],
    [131573, 'jujutsu-kaisen-0'],
    [145064, 'jujutsu-kaisen-2nd-season'],
  ]);

  const mockEdges = [
    {
      relationType: 'PREQUEL',
      node: { id: 131573, seasonYear: 2021, format: 'MOVIE' },
    },
    {
      relationType: 'SEQUEL',
      node: { id: 145064, seasonYear: 2023, format: 'TV' },
    },
    {
      relationType: 'ADAPTATION',
      node: { id: 999999, seasonYear: 2018 }, // Not in catalog
    },
  ];

  const relations = parseAnilistRelations(113415, mockEdges, anilistToSlug, 'jujutsu-kaisen');
  assert.equal(relations.length, 2);

  assert.deepEqual(relations[0], {
    anime_id: 'jujutsu-kaisen',
    related_id: 'jujutsu-kaisen-0',
    relation_type: 'movie',
    chronology_order: 2021,
  });

  assert.deepEqual(relations[1], {
    anime_id: 'jujutsu-kaisen',
    related_id: 'jujutsu-kaisen-2nd-season',
    relation_type: 'sequel',
    chronology_order: 2023,
  });
});

test('parseJikanRelations: converts Jikan v4 payload into internal relation records', () => {
  const malToSlug = new Map([
    [40748, 'jujutsu-kaisen'],
    [48569, 'jujutsu-kaisen-0'],
    [51009, 'jujutsu-kaisen-2nd-season'],
  ]);

  const mockJikan = [
    {
      relation: 'Prequel',
      entry: [{ mal_id: 48569, type: 'anime', name: 'Jujutsu Kaisen 0 Movie' }],
    },
    {
      relation: 'Sequel',
      entry: [{ mal_id: 51009, type: 'anime', name: 'Jujutsu Kaisen 2nd Season' }],
    },
    {
      relation: 'Manga',
      entry: [{ mal_id: 113138, type: 'manga', name: 'Jujutsu Kaisen' }], // Manga excluded
    },
  ];

  const relations = parseJikanRelations(40748, mockJikan, malToSlug, 'jujutsu-kaisen');
  assert.equal(relations.length, 2);

  assert.equal(relations[0].anime_id, 'jujutsu-kaisen');
  assert.equal(relations[0].related_id, 'jujutsu-kaisen-0');
  assert.equal(relations[0].relation_type, 'prequel');

  assert.equal(relations[1].anime_id, 'jujutsu-kaisen');
  assert.equal(relations[1].related_id, 'jujutsu-kaisen-2nd-season');
  assert.equal(relations[1].relation_type, 'sequel');
});

test('persistFranchiseRelations: writes relations to SQLite database transactionally', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE anime (id TEXT PRIMARY KEY, title TEXT);
    INSERT INTO anime VALUES ('jujutsu-kaisen', 'Jujutsu Kaisen'), ('jujutsu-kaisen-2nd-season', 'Jujutsu Kaisen Season 2');
  `);

  const relations = [
    {
      anime_id: 'jujutsu-kaisen',
      related_id: 'jujutsu-kaisen-2nd-season',
      relation_type: 'sequel',
      chronology_order: 2023,
    },
    {
      anime_id: 'jujutsu-kaisen-2nd-season',
      related_id: 'jujutsu-kaisen',
      relation_type: 'prequel',
      chronology_order: 2020,
    },
  ];

  const inserted = persistFranchiseRelations(db, relations);
  assert.equal(inserted, 2);

  const rows = db.prepare('SELECT * FROM anime_franchise_relation ORDER BY chronology_order ASC').all();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].anime_id, 'jujutsu-kaisen-2nd-season');
  assert.equal(rows[0].relation_type, 'prequel');
  assert.equal(rows[1].anime_id, 'jujutsu-kaisen');
  assert.equal(rows[1].relation_type, 'sequel');
});

test('mergeFranchiseRelations: overrides heuristic relations with authoritative sources', () => {
  const heuristic = [
    { anime_id: 'a', related_id: 'b', relation_type: 'sequel', chronology_order: 1 },
    { anime_id: 'a', related_id: 'c', relation_type: 'sequel', chronology_order: 2 },
  ];

  const authoritative = [
    { anime_id: 'a', related_id: 'b', relation_type: 'movie', chronology_order: 2021 },
    { anime_id: 'a', related_id: 'd', relation_type: 'prequel', chronology_order: 2019 },
  ];

  const merged = mergeFranchiseRelations(heuristic, authoritative);
  assert.equal(merged.length, 3);

  const ab = merged.find((r) => r.anime_id === 'a' && r.related_id === 'b');
  assert.equal(ab?.relation_type, 'movie');
  assert.equal(ab?.chronology_order, 2021);

  const ac = merged.find((r) => r.anime_id === 'a' && r.related_id === 'c');
  assert.equal(ac?.relation_type, 'sequel');

  const ad = merged.find((r) => r.anime_id === 'a' && r.related_id === 'd');
  assert.equal(ad?.relation_type, 'prequel');
});
