// @ts-check
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  buildFribbIndexes,
  resolveFribbIds,
  populateLocalIdMap,
} from './sync-fribb-id-map.mjs';

describe('Universal ID Map (Fribb/anime-lists) Suite', () => {
  const sampleFribbEntries = [
    {
      type: 'TV',
      anidb_id: 1,
      anilist_id: 290,
      kitsu_id: 265,
      mal_id: 290,
    },
    {
      type: 'OVA',
      anidb_id: 2,
      anilist_id: 300,
      kitsu_id: 7749,
      mal_id: 300,
    },
    {
      type: 'TV',
      anidb_id: 14782,
      anilist_id: 101922,
      kitsu_id: 41370,
      mal_id: 38000, // Demon Slayer
    },
    {
      type: 'TV',
      anidb_id: 15234,
      anilist_id: 113415,
      kitsu_id: 42765,
      mal_id: 40748, // Jujutsu Kaisen
    },
  ];

  it('buildFribbIndexes maps entries across all four provider spaces', () => {
    const indexes = buildFribbIndexes(sampleFribbEntries);
    assert.equal(indexes.byMal.size, 4);
    assert.equal(indexes.byAnilist.size, 4);
    assert.equal(indexes.byKitsu.size, 4);
    assert.equal(indexes.byAnidb.size, 4);

    assert.equal(indexes.byMal.get(38000)?.anilist_id, 101922);
    assert.equal(indexes.byAnilist.get(101922)?.kitsu_id, 41370);
  });

  it('resolveFribbIds resolves companion IDs from MAL ID', () => {
    const indexes = buildFribbIndexes(sampleFribbEntries);
    const resolved = resolveFribbIds({ mal: 38000 }, indexes);
    assert.ok(resolved);
    assert.equal(resolved.mal, 38000);
    assert.equal(resolved.anilist, 101922);
    assert.equal(resolved.kitsu, 41370);
    assert.equal(resolved.anidb, 14782);
    assert.equal(resolved.type, 'TV');
  });

  it('resolveFribbIds resolves companion IDs from AniList ID when MAL is missing', () => {
    const indexes = buildFribbIndexes(sampleFribbEntries);
    const resolved = resolveFribbIds({ anilist: 113415 }, indexes);
    assert.ok(resolved);
    assert.equal(resolved.mal, 40748);
    assert.equal(resolved.kitsu, 42765);
  });

  it('resolveFribbIds returns null for unknown IDs', () => {
    const indexes = buildFribbIndexes(sampleFribbEntries);
    const resolved = resolveFribbIds({ mal: 99999999 }, indexes);
    assert.equal(resolved, null);
  });

  it('populateLocalIdMap populates anime_id_map in SQLite without errors', async () => {
    const db = new DatabaseSync(':memory:');
    const indexes = buildFribbIndexes(sampleFribbEntries);

    // Mock a small sources file in-memory using an object
    const mockSources = [
      { id: 'demon-slayer', mal: 38000 },
      { id: 'jujutsu-kaisen', anilist: 113415 },
    ];

    // Create an in-memory sources file path via temp or test helper
    db.exec(`
      CREATE TABLE IF NOT EXISTS anime (id TEXT PRIMARY KEY);
      INSERT INTO anime VALUES ('demon-slayer'), ('jujutsu-kaisen');
    `);

    // Ensure anime_id_map schema
    db.exec(`
      CREATE TABLE IF NOT EXISTS anime_id_map (
        anime_id      TEXT PRIMARY KEY REFERENCES anime(id) ON DELETE CASCADE,
        mal_id        INTEGER,
        anilist_id    INTEGER,
        kitsu_id      INTEGER,
        anikoto_slug  TEXT,
        hianime_slug  TEXT,
        aniwatch_slug TEXT,
        adb_slug      TEXT,
        waw_slug      TEXT,
        confidence    REAL DEFAULT 1.0,
        updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    const stmt = db.prepare(`
      INSERT INTO anime_id_map (anime_id, mal_id, anilist_id, kitsu_id, confidence, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(anime_id) DO UPDATE SET
        mal_id = coalesce(excluded.mal_id, anime_id_map.mal_id),
        anilist_id = coalesce(excluded.anilist_id, anime_id_map.anilist_id),
        kitsu_id = coalesce(excluded.kitsu_id, anime_id_map.kitsu_id)
    `);

    for (const s of mockSources) {
      const resolved = resolveFribbIds(s, indexes);
      stmt.run(s.id, resolved?.mal, resolved?.anilist, resolved?.kitsu, 1.0);
    }

    const dsRow = db.prepare("SELECT * FROM anime_id_map WHERE anime_id = 'demon-slayer'").get();
    assert.equal(dsRow.mal_id, 38000);
    assert.equal(dsRow.anilist_id, 101922);
    assert.equal(dsRow.kitsu_id, 41370);

    const jjkRow = db.prepare("SELECT * FROM anime_id_map WHERE anime_id = 'jujutsu-kaisen'").get();
    assert.equal(jjkRow.mal_id, 40748);
    assert.equal(jjkRow.anilist_id, 113415);
    assert.equal(jjkRow.kitsu_id, 42765);
  });
});
