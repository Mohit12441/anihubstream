import test from 'node:test';
import assert from 'node:assert/strict';
import { computeFranchiseGraph, autoSyncFranchises } from './auto-sync-franchises.mjs';
import { DatabaseSync } from 'node:sqlite';

test('auto-sync-franchises: computeFranchiseGraph', async (t) => {
  await t.test('computes bidirectional relations across a multi-season TV franchise', () => {
    const mockCatalog = [
      { id: 'sample-show', title: 'Sample Show', year: 2020, season: 'Fall 2020', kind: 'TV', alt_seasons: null },
      { id: 'sample-show-season-2', title: 'Sample Show Season 2', year: 2022, season: 'Winter 2022', kind: 'TV', alt_seasons: null },
      { id: 'sample-show-season-3', title: 'Sample Show Season 3', year: 2024, season: 'Spring 2024', kind: 'TV', alt_seasons: null },
    ];

    const graph = computeFranchiseGraph(mockCatalog);
    assert.equal(graph.length, 6); // 3 * 2 bidirectional combinations

    // Check relations from sample-show (Season 1)
    const fromS1 = graph.filter((r) => r.anime_id === 'sample-show');
    assert.equal(fromS1.length, 2);
    assert.ok(fromS1.some((r) => r.related_id === 'sample-show-season-2' && r.relation_type === 'sequel'));
    assert.ok(fromS1.some((r) => r.related_id === 'sample-show-season-3' && r.relation_type === 'sequel'));

    // Check relations from sample-show-season-2 (Season 2)
    const fromS2 = graph.filter((r) => r.anime_id === 'sample-show-season-2');
    assert.equal(fromS2.length, 2);
    assert.ok(fromS2.some((r) => r.related_id === 'sample-show' && r.relation_type === 'prequel'));
    assert.ok(fromS2.some((r) => r.related_id === 'sample-show-season-3' && r.relation_type === 'sequel'));
  });

  await t.test('identifies canon movies in franchise clusters', () => {
    const mockCatalog = [
      { id: 'magic-battles', title: 'Magic Battles', year: 2020, season: 'Fall 2020', kind: 'TV', alt_seasons: null },
      { id: 'magic-battles-the-movie', title: 'Magic Battles: The Movie', year: 2021, season: 'Year 2021', kind: 'Movie', alt_seasons: null },
    ];

    const graph = computeFranchiseGraph(mockCatalog);
    assert.equal(graph.length, 2);

    const fromShow = graph.find((r) => r.anime_id === 'magic-battles' && r.related_id === 'magic-battles-the-movie');
    assert.ok(fromShow);
    assert.equal(fromShow.relation_type, 'movie');
  });

  await t.test('extracts relations from direct alt_seasons strings', () => {
    const mockCatalog = [
      {
        id: 'original-series',
        title: 'Original Series',
        year: 2018,
        season: 'Spring 2018',
        kind: 'TV',
        alt_seasons: JSON.stringify(['Another Arc (2020)']),
      },
      {
        id: 'another-arc-id',
        title: 'Another Arc',
        year: 2020,
        season: 'Summer 2020',
        kind: 'TV',
        alt_seasons: null,
      },
    ];

    const graph = computeFranchiseGraph(mockCatalog);
    assert.ok(graph.some((r) => r.anime_id === 'original-series' && r.related_id === 'another-arc-id'));
    assert.ok(graph.some((r) => r.anime_id === 'another-arc-id' && r.related_id === 'original-series'));
  });

  await t.test('autoSyncFranchises merges authoritative franchise relations into D1 table', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE anime (id TEXT PRIMARY KEY, title TEXT, year INTEGER, season TEXT, kind TEXT, alt_seasons TEXT);
      INSERT INTO anime VALUES
        ('solo-leveling', 'Solo Leveling', 2024, 'Winter 2024', 'TV', NULL),
        ('solo-leveling-season-2', 'Solo Leveling Season 2: Arise from the Shadow', 2025, 'Winter 2025', 'TV', NULL);
    `);

    const authoritative = [
      { anime_id: 'solo-leveling', related_id: 'solo-leveling-season-2', relation_type: 'sequel', chronology_order: 2025 },
      { anime_id: 'solo-leveling-season-2', related_id: 'solo-leveling', relation_type: 'prequel', chronology_order: 2024 },
    ];

    const res = autoSyncFranchises(db, { authoritativeRelations: authoritative });
    assert.ok(res.length >= 2);

    const rows = db.prepare('SELECT * FROM anime_franchise_relation ORDER BY chronology_order ASC').all();
    assert.equal(rows.length, 2);
    assert.equal(rows[0].relation_type, 'prequel');
    assert.equal(rows[1].relation_type, 'sequel');
  });
});
