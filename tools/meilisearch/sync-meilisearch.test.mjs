// @ts-check
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  getAnimeDocumentsFromDb,
  isMeilisearchHealthy,
  syncAnimeToMeilisearch,
} from './sync-meilisearch.mjs';

describe('Meilisearch Real-Time Catalog Sync Suite', () => {
  it('extracts anime documents with complete field mappings from SQLite', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE anime (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        native TEXT,
        year INTEGER,
        rating REAL,
        season TEXT,
        kind TEXT,
        status TEXT,
        art TEXT,
        key_art TEXT,
        accent TEXT,
        synopsis TEXT,
        rank INTEGER,
        trend_rank INTEGER
      );
      INSERT INTO anime (id, title, native, year, rating, season, kind, status, art, key_art, accent, synopsis, rank, trend_rank)
      VALUES
        ('frieren', 'Frieren: Beyond Journey’s End', '葬送のフリーレン', 2023, 9.1, 'Fall 2023', 'TV', 'Finished', 'art1.jpg', 'key1.jpg', '#bbf1a1', 'Elf mage synopsis', 1, 5),
        ('solo-leveling', 'Solo Leveling', '나 혼자만 레벨업', 2024, 8.5, 'Winter 2024', 'TV', 'Finished', 'art2.jpg', 'key2.jpg', '#222222', 'Hunter synopsis', 2, NULL);
    `);

    const allDocs = getAnimeDocumentsFromDb(db);
    assert.equal(allDocs.length, 2);

    const frieren = allDocs.find((d) => d.id === 'frieren');
    assert.ok(frieren);
    assert.equal(frieren.title, 'Frieren: Beyond Journey’s End');
    assert.equal(frieren.nativeTitle, '葬送のフリーレン');
    assert.equal(frieren.year, 2023);
    assert.equal(frieren.rating, 9.1);
    assert.equal(frieren.trend_rank, 5);
    assert.deepEqual(frieren.synonyms, ['Frieren: Beyond Journey’s End']);

    db.close();
  });

  it('supports delta extraction for targeted IDs', () => {
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
        art TEXT,
        key_art TEXT,
        accent TEXT,
        synopsis TEXT,
        rank INTEGER,
        trend_rank INTEGER
      );
      INSERT INTO anime (id, title) VALUES
        ('a1', 'Title 1'),
        ('a2', 'Title 2'),
        ('a3', 'Title 3');
    `);

    const deltaDocs = getAnimeDocumentsFromDb(db, ['a2']);
    assert.equal(deltaDocs.length, 1);
    assert.equal(deltaDocs[0].id, 'a2');
    assert.equal(deltaDocs[0].title, 'Title 2');

    db.close();
  });

  it('isMeilisearchHealthy returns false when server is offline without throwing', async () => {
    // Port 7799 is an unused local port
    const isHealthy = await isMeilisearchHealthy('http://127.0.0.1:7799', 300);
    assert.equal(isHealthy, false);
  });

  it('syncAnimeToMeilisearch returns offline status cleanly when server is unreachable', async () => {
    const res = await syncAnimeToMeilisearch({
      host: 'http://127.0.0.1:7799',
      silent: true,
    });
    assert.equal(res.ok, false);
    assert.equal(res.status, 'offline');
    assert.equal(res.synced, 0);
    assert.equal(res.reason, 'meilisearch_offline');
  });
});
