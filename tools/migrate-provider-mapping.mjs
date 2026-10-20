// @ts-check
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';

const D1_DIR = './.wrangler/state/v3/d1/miniflare-D1DatabaseObject';
const files = fs.readdirSync(D1_DIR).filter(f => f.endsWith('.sqlite') && f !== 'metadata.sqlite');
if (files.length === 0) {
  console.error('No D1 SQLite database found in', D1_DIR);
  process.exit(1);
}

const dbPath = path.join(D1_DIR, files[0]);
console.log('Target Local SQLite Database:', dbPath);
const db = new DatabaseSync(dbPath);

console.log('1. Creating anime_provider_mapping table...');
db.exec(`
  CREATE TABLE IF NOT EXISTS anime_provider_mapping (
    anime_id       TEXT NOT NULL,
    provider_id    TEXT NOT NULL,
    provider_slug  TEXT NOT NULL,
    media_id       TEXT,
    dub_available  INTEGER DEFAULT 0,
    confidence     REAL DEFAULT 1.0,
    updated_at     TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (anime_id, provider_id),
    FOREIGN KEY (anime_id) REFERENCES anime(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_provider_reverse 
  ON anime_provider_mapping(provider_id, provider_slug);

  CREATE INDEX IF NOT EXISTS idx_provider_anime 
  ON anime_provider_mapping(anime_id);
`);

console.log('2. Migrating existing provider slugs into anime_provider_mapping...');

// Migrate anikoto
const anikotoIns = db.prepare(`
  INSERT INTO anime_provider_mapping (anime_id, provider_id, provider_slug, confidence)
  SELECT anime_id, 'anikoto', anikoto_slug, coalesce(confidence, 1.0)
  FROM anime_id_map
  WHERE anikoto_slug IS NOT NULL AND anikoto_slug != ''
  ON CONFLICT(anime_id, provider_id) DO UPDATE SET
    provider_slug = excluded.provider_slug,
    confidence = excluded.confidence,
    updated_at = datetime('now')
`);
const anikotoResult = anikotoIns.run();

// Migrate hianime
const hianimeIns = db.prepare(`
  INSERT INTO anime_provider_mapping (anime_id, provider_id, provider_slug, confidence)
  SELECT anime_id, 'hianime', hianime_slug, coalesce(confidence, 1.0)
  FROM anime_id_map
  WHERE hianime_slug IS NOT NULL AND hianime_slug != ''
  ON CONFLICT(anime_id, provider_id) DO UPDATE SET
    provider_slug = excluded.provider_slug,
    confidence = excluded.confidence,
    updated_at = datetime('now')
`);
const hianimeResult = hianimeIns.run();

// Migrate any other providers if present
const count = db.prepare('SELECT count(*) as c, provider_id FROM anime_provider_mapping GROUP BY provider_id').all();
console.log('anime_provider_mapping migrated counts:', count);

const total = db.prepare('SELECT count(*) as c FROM anime_provider_mapping').get().c;
console.log(`✓ Total mapped provider relations: ${total.toLocaleString()}`);
