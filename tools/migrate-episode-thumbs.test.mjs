// @ts-check
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrateEpisodeThumbnails } from './migrate-episode-thumbs.mjs';

describe('Episode Thumbnail Fallback Migration Suite', () => {
  it('migrates empty or null thumbnails using anime key_art or art', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE anime (
        id TEXT PRIMARY KEY,
        key_art TEXT,
        art TEXT
      );
      CREATE TABLE episode (
        id TEXT PRIMARY KEY,
        anime_id TEXT,
        thumb TEXT
      );
      INSERT INTO anime (id, key_art, art) VALUES
        ('a1', 'https://img.test/key1.jpg', 'https://img.test/art1.jpg'),
        ('a2', '', 'https://img.test/art2.jpg');

      INSERT INTO episode (id, anime_id, thumb) VALUES
        ('a1#1', 'a1', 'https://img.test/ep1.jpg'),
        ('a1#2', 'a1', ''),
        ('a2#1', 'a2', NULL);
    `);

    const res = migrateEpisodeThumbnails(db);
    assert.equal(res.beforeCount, 2);
    assert.equal(res.updated, 2);
    assert.equal(res.afterCount, 0);

    const ep1 = db.prepare("SELECT thumb FROM episode WHERE id = 'a1#1'").get();
    // @ts-ignore
    assert.equal(ep1.thumb, 'https://img.test/ep1.jpg');

    const ep2 = db.prepare("SELECT thumb FROM episode WHERE id = 'a1#2'").get();
    // @ts-ignore
    assert.equal(ep2.thumb, 'https://img.test/key1.jpg');

    const ep3 = db.prepare("SELECT thumb FROM episode WHERE id = 'a2#1'").get();
    // @ts-ignore
    assert.equal(ep3.thumb, 'https://img.test/art2.jpg');

    db.close();
  });
});
