import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { resolveFranchiseSeasons } from '../functions/api/_lib.js';

test('resolveFranchiseSeasons extracts chronological order, poster, rating, and relationType from D1 relations', async () => {
  const db = new DatabaseSync(':memory:');

  db.exec(`
    CREATE TABLE anime (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      season TEXT,
      year INTEGER,
      kind TEXT,
      art TEXT,
      key_art TEXT,
      rating REAL,
      alt_seasons TEXT
    );

    CREATE TABLE anime_franchise_relation (
      anime_id TEXT NOT NULL,
      related_id TEXT NOT NULL,
      relation_type TEXT NOT NULL,
      chronology_order INTEGER DEFAULT 0,
      PRIMARY KEY (anime_id, related_id)
    );
  `);

  // Mock a franchise: Attack on Titan (Season 1, Season 2, Movie, Final Season)
  db.exec(`
    INSERT INTO anime (id, title, season, year, kind, art, rating) VALUES
      ('aot-s1', 'Attack on Titan Season 1', 'Spring 2013', 2013, 'TV', '/art/aot1.jpg', 8.5),
      ('aot-s2', 'Attack on Titan Season 2', 'Spring 2017', 2017, 'TV', '/art/aot2.jpg', 8.7),
      ('aot-movie', 'Attack on Titan: Chronicle', 'Summer 2020', 2020, 'Movie', '/art/aot-m.jpg', 7.9),
      ('aot-final', 'Attack on Titan The Final Season', 'Winter 2021', 2021, 'TV', '/art/aot-final.jpg', 9.0);

    INSERT INTO anime_franchise_relation (anime_id, related_id, relation_type, chronology_order) VALUES
      ('aot-s2', 'aot-s1', 'prequel', 2013),
      ('aot-s2', 'aot-movie', 'movie', 2020),
      ('aot-s2', 'aot-final', 'sequel', 2021);
  `);

  // Adapt db.prepare to return { all(), first() } expected by D1 wrapper in _lib.js
  const d1Mock = {
    prepare(sql) {
      const stmt = db.prepare(sql);
      return {
        bind(...args) {
          return {
            async all() {
              const rows = stmt.all(...args);
              return { results: rows };
            },
            async first() {
              return stmt.get(...args) || null;
            },
          };
        },
      };
    },
  };

  const currentCard = {
    id: 'aot-s2',
    title: 'Attack on Titan Season 2',
    season: 'Spring 2017',
    year: 2017,
    kind: 'TV',
    art: '/art/aot2.jpg',
    rating: 8.7,
  };

  const seasons = await resolveFranchiseSeasons(d1Mock, currentCard);

  assert.ok(Array.isArray(seasons), 'seasons is an array');
  assert.equal(seasons.length, 4, 'resolves all 4 franchise titles');

  // Verify chronology sort order: 2013 -> 2017 -> 2020 -> 2021
  assert.equal(seasons[0].id, 'aot-s1');
  assert.equal(seasons[0].year, 2013);
  assert.equal(seasons[0].relationType, 'prequel');
  assert.equal(seasons[0].isCurrent, false);

  assert.equal(seasons[1].id, 'aot-s2');
  assert.equal(seasons[1].year, 2017);
  assert.equal(seasons[1].relationType, 'current');
  assert.equal(seasons[1].isCurrent, true);
  assert.equal(seasons[1].rating, 8.7);
  assert.equal(seasons[1].poster, '/art/aot2.jpg');

  assert.equal(seasons[2].id, 'aot-movie');
  assert.equal(seasons[2].year, 2020);
  assert.equal(seasons[2].relationType, 'movie');

  assert.equal(seasons[3].id, 'aot-final');
  assert.equal(seasons[3].year, 2021);
  assert.equal(seasons[3].relationType, 'sequel');
});

test('resolveFranchiseSeasons returns empty array for isolated title with no relations or alt seasons', async () => {
  const d1Mock = {
    prepare() {
      return {
        bind() {
          return {
            async all() { return { results: [] }; },
            async first() { return null; },
          };
        },
      };
    },
  };

  const soloAnime = {
    id: 'standalone-movie',
    title: 'Standalone Single Movie',
    year: 2024,
    kind: 'Movie',
  };

  const seasons = await resolveFranchiseSeasons(d1Mock, soloAnime);
  assert.deepEqual(seasons, [], 'standalone titles without relations return empty array');
});
