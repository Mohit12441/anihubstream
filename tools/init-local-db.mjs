// @ts-check
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';

const ROOT = path.resolve(import.meta.dirname, '..');
const D1_DIR = path.join(ROOT, '.wrangler', 'state', 'v3', 'd1', 'miniflare-D1DatabaseObject');
const SCHEMA_FILE = path.join(ROOT, 'schema.sql');

export function initLocalDatabase() {
  if (!fs.existsSync(D1_DIR)) {
    fs.mkdirSync(D1_DIR, { recursive: true });
  }

  let files = fs.readdirSync(D1_DIR).filter((f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite');
  let dbPath = '';

  if (files.length === 0) {
    // Generate standard Miniflare D1 hash filename if completely fresh
    const defaultHash = 'c9fc89a7d1503de9966d667e6f96a3aa931cd48bcd765060548934038357609a.sqlite';
    dbPath = path.join(D1_DIR, defaultHash);
    console.log(`[db:init] Fresh environment detected. Creating ${defaultHash}`);
  } else {
    dbPath = path.join(D1_DIR, files[0]);
    console.log(`[db:init] Using existing local D1 database: ${path.basename(dbPath)}`);
  }

  const db = new DatabaseSync(dbPath);
  const schemaSql = fs.readFileSync(SCHEMA_FILE, 'utf8');

  // Execute schema
  db.exec(schemaSql);

  // Verify critical tables
  const requiredTables = [
    'anime',
    'genre',
    'anime_genre',
    'episode',
    'anime_id_map',
    'anime_provider_mapping',
    'stream_cache',
    'viewer',
    'library',
    'position',
  ];

  const existingRows = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  const existingSet = new Set(existingRows.map((r) => /** @type {any} */ (r).name));

  const missing = requiredTables.filter((t) => !existingSet.has(t));
  if (missing.length > 0) {
    throw new Error(`[db:init] Failed to create tables: ${missing.join(', ')}`);
  }

  console.log(`[db:init] Schema verified: all ${requiredTables.length} critical tables present (including stream_cache and anime_provider_mapping).`);
  return { dbPath, tables: Array.from(existingSet) };
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  try {
    initLocalDatabase();
    process.exit(0);
  } catch (err) {
    console.error('[db:init] Initialization failed:', err);
    process.exit(1);
  }
}
