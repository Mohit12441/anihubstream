import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const D1_DIR = './.wrangler/state/v3/d1/miniflare-D1DatabaseObject';
const DUMP_FILE = './remote-anihub-dump.sql';

if (!fs.existsSync(DUMP_FILE)) {
  console.error('Dump file not found:', DUMP_FILE);
  process.exit(1);
}

// Find sqlite file
const files = fs.readdirSync(D1_DIR).filter(f => f.endsWith('.sqlite') && f !== 'metadata.sqlite');
if (files.length === 0) {
  console.error('No D1 SQLite database found in', D1_DIR);
  process.exit(1);
}

const dbPath = path.join(D1_DIR, files[0]);
console.log('Target Local SQLite Database:', dbPath);

const db = new DatabaseSync(dbPath);

console.log('Reading dump file...');
let dump = fs.readFileSync(DUMP_FILE, 'utf8');

// Replace CREATE TABLE with CREATE TABLE IF NOT EXISTS or drop old tables
db.exec('PRAGMA foreign_keys = OFF;');
db.exec(`
  DROP TABLE IF EXISTS anime_genre;
  DROP TABLE IF EXISTS episode;
  DROP TABLE IF EXISTS genre;
  DROP TABLE IF EXISTS anime_id_map;
  DROP TABLE IF EXISTS anime;
`);

console.log('Executing dump into local SQLite...');
const t0 = Date.now();
db.exec(dump);
console.log(`Dump executed in ${((Date.now() - t0) / 1000).toFixed(2)}s`);

// Now check if anime_fts exists and repopulate
try {
  const ftsCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='anime_fts'").get();
  if (ftsCheck) {
    console.log('Rebuilding anime_fts full-text index...');
    db.exec(`
      DELETE FROM anime_fts;
      INSERT INTO anime_fts(id, title, native, synopsis, search_text)
      SELECT id, title, native, synopsis, coalesce(search_text, '') FROM anime;
    `);
    console.log('anime_fts rebuilt successfully.');
  }
} catch (err) {
  console.warn('Could not populate anime_fts:', err.message);
}

// Print summary
console.log('\n--- Local D1 Table Verification ---');
const tables = ['anime', 'genre', 'anime_genre', 'episode', 'anime_id_map', 'anime_fts'];
for (const t of tables) {
  try {
    const res = db.prepare(`SELECT count(*) as count FROM ${t}`).get();
    console.log(`✓ ${t.padEnd(16)}: ${res.count.toLocaleString()} rows`);
  } catch (e) {
    console.log(`✗ ${t.padEnd(16)}: ${e.message}`);
  }
}
