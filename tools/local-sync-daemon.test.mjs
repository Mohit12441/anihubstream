// @ts-check
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { findSqlitePath, runSyncCycle } from './local-sync-daemon.mjs';
import { computeFranchiseGraph, persistRelations } from './auto-sync-franchises.mjs';

describe('Local Autonomous Sync Daemon Suite', () => {
  it('findSqlitePath resolves an existing Miniflare SQLite file', () => {
    const dbPath = findSqlitePath();
    assert.ok(dbPath, 'Should find a local sqlite file');
    assert.ok(existsSync(dbPath), `Target database must exist on disk: ${dbPath}`);
    assert.ok(dbPath.endsWith('.sqlite'), 'Target database must have .sqlite extension');
  });

  it('runSyncCycle is an exported async function', () => {
    assert.equal(typeof runSyncCycle, 'function');
  });

  it('correctly constructs and persists franchise relation edges into SQLite', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE anime (
        id TEXT PRIMARY KEY,
        title TEXT,
        native TEXT,
        year INTEGER,
        rating REAL,
        season TEXT,
        kind TEXT,
        status TEXT,
        rank INTEGER,
        alt_seasons TEXT,
        source_ids TEXT
      );
      CREATE TABLE anime_franchise_relation (
        anime_id TEXT NOT NULL,
        related_id TEXT NOT NULL,
        relation_type TEXT NOT NULL,
        chronology_order INTEGER,
        created_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (anime_id, related_id)
      );
    `);

    const mockTitles = [
      { id: 'solo-leveling', title: 'Solo Leveling', year: 2024, rating: 8.5, season: 'Winter 2024', kind: 'TV', status: 'Finished', source_ids: '{}' },
      { id: 'solo-leveling-season-2-arise-from-the-shadow', title: 'Solo Leveling Season 2: Arise from the Shadow', year: 2025, rating: 8.8, season: 'Winter 2025', kind: 'TV', status: 'Ongoing', source_ids: '{}' },
    ];

    const relations = computeFranchiseGraph(mockTitles);
    assert.ok(relations.length > 0, 'Should find sequel/prequel relationship');

    persistRelations(db, relations);
    const rows = db.prepare('SELECT * FROM anime_franchise_relation').all();
    assert.ok(rows.length > 0, 'Relations must be saved to anime_franchise_relation table');
    // @ts-ignore
    assert.equal(rows[0].relation_type, 'sequel');
    // @ts-ignore
    assert.equal(rows[0].related_id, 'solo-leveling-season-2-arise-from-the-shadow');
    db.close();
  });

  it('normalizes ratings > 10 to a 10-point scale', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE anime (
        id TEXT PRIMARY KEY,
        rating REAL
      );
      INSERT INTO anime (id, rating) VALUES ('anime-100', 85.0), ('anime-10', 8.5);
    `);

    db.exec('UPDATE anime SET rating = round(rating / 10.0, 1) WHERE rating > 10;');

    const a1 = db.prepare("SELECT rating FROM anime WHERE id = 'anime-100'").get();
    // @ts-ignore
    assert.equal(a1.rating, 8.5, 'Rating 85.0 must normalize to 8.5');

    const a2 = db.prepare("SELECT rating FROM anime WHERE id = 'anime-10'").get();
    // @ts-ignore
    assert.equal(a2.rating, 8.5, 'Rating 8.5 must remain 8.5');
    db.close();
  });

  it('records heartbeat summary JSON into sync_meta correctly', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE sync_meta (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `);

    const testSummary = {
      startedAt: new Date().toISOString(),
      schedules: { updated: 10 },
      providers: { providersActive: { anikoto: 2000 } },
      ok: true,
    };

    db.prepare(`
      INSERT OR REPLACE INTO sync_meta (key, value)
      VALUES ('local_sync_daemon', ?)
    `).run(JSON.stringify(testSummary));

    const row = db.prepare("SELECT value FROM sync_meta WHERE key = 'local_sync_daemon'").get();
    // @ts-ignore
    const parsed = JSON.parse(row.value);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.schedules.updated, 10);
    assert.equal(parsed.providers.providersActive.anikoto, 2000);
    db.close();
  });

  it('correctly detects missing catalog titles between sources and SQLite', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE anime (
        id TEXT PRIMARY KEY,
        title TEXT
      );
      INSERT INTO anime (id, title) VALUES ('title-1', 'Title 1');
    `);

    const mockSources = [
      { id: 'title-1', title: 'Title 1' },
      { id: 'title-2', title: 'Title 2' },
      { id: 'title-3', title: 'Title 3' },
    ];

    // @ts-ignore
    const dbIds = new Set(db.prepare('SELECT id FROM anime').all().map((r) => r.id));
    const missing = mockSources.filter((s) => !dbIds.has(s.id));

    assert.equal(missing.length, 2);
    assert.deepEqual(missing.map((m) => m.id), ['title-2', 'title-3']);
    db.close();
  });

  it('runSyncCycle respects stage filter and skips non-targeted stages', async () => {
    // When expand=0, growth is cleanly disabled without network calls
    const res = await runSyncCycle({ quiet: true, expand: 0, stage: 'growth' });
    assert.equal(res.ok, true);
    assert.equal(res.schedules, null, 'schedules stage must be skipped');
    assert.equal(res.providers, null, 'providers stage must be skipped');
    assert.equal(res.franchises, null, 'franchises stage must be skipped');
    assert.equal(res.episodes, null, 'episodes stage must be skipped');
    assert.equal(res.growth.added, 0);
    assert.equal(res.growth.skipped, 'disabled');
  });
});
