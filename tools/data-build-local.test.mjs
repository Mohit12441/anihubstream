import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildLocalDatabase } from './data-build-local.mjs';

test('data-build-local: compiles data/ directory into a target sqlite database', async () => {
  const tmpDbPath = path.resolve('tools/.cache/test-built-d1.sqlite');
  if (fs.existsSync(tmpDbPath)) {
    fs.rmSync(tmpDbPath, { force: true });
  }

  // Create temporary fixture data directory with 2 anime
  const tmpDataDir = path.resolve('tools/.cache/test-fixtures-data');
  fs.mkdirSync(path.join(tmpDataDir, 'catalog'), { recursive: true });
  fs.mkdirSync(path.join(tmpDataDir, 'reference'), { recursive: true });

  const sampleGenre = [
    { id: 'action', label: 'Action', tagline: 'Explosive Battles', art: 'key-demon-slayer', accent: '#ff1f4a', position: 0 }
  ];
  fs.writeFileSync(path.join(tmpDataDir, 'reference', 'genres.json'), JSON.stringify(sampleGenre), 'utf8');

  const sampleAnime = {
    id: 'test-build-anime',
    title: 'Test Build Anime',
    native: 'テスト',
    year: 2024,
    rating: 8.5,
    season: 'Spring 2024',
    kind: 'TV',
    status: 'Finished',
    art: 'https://example.com/art.jpg',
    key_art: 'https://example.com/key.jpg',
    accent: '#336699',
    synopsis: 'A test synopsis.',
    genres: ['action'],
    source_ids: { mal: 12345 },
    episode_total: 1,
    episodes: [
      {
        n: 1,
        title: 'Episode 1',
        runtime: '24:00',
        runtime_seconds: 1440,
        thumb: 'https://example.com/thumb.jpg',
        synopsis: 'Pilot episode.',
        airdate: '2024-04-01'
      }
    ]
  };
  fs.writeFileSync(path.join(tmpDataDir, 'catalog', 'test-build-anime.json'), JSON.stringify(sampleAnime), 'utf8');

  const result = await buildLocalDatabase({
    dataDir: tmpDataDir,
    dbPath: tmpDbPath
  });

  assert.equal(result.success, true);
  assert.equal(result.animeInserted, 1);
  assert.equal(result.episodesInserted, 1);

  // Verify rows exist in SQLite
  const db = new DatabaseSync(tmpDbPath);
  const animeRow = db.prepare('SELECT * FROM anime WHERE id = ?').get('test-build-anime');
  assert.ok(animeRow);
  assert.equal(/** @type {any} */ (animeRow).title, 'Test Build Anime');

  const episodeRow = db.prepare('SELECT * FROM episode WHERE anime_id = ?').get('test-build-anime');
  assert.ok(episodeRow);
  assert.equal(/** @type {any} */ (episodeRow).n, 1);

  // Cleanup
  db.close();
  fs.rmSync(tmpDbPath, { force: true });
  fs.rmSync(tmpDataDir, { recursive: true, force: true });
});
