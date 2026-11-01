// @ts-check
/**
 * Universal ID Mapping Ingestion Utility (Fribb/anime-lists)
 *
 * Downloads and caches the daily-updated cross-reference dataset (39,500+ anime)
 * mapping MyAnimeList <-> AniList <-> Kitsu <-> AniDB <-> TMDB/TVDB.
 *
 * Capabilities:
 *  1. Caches `anime-list-mini.json` locally in `tools/.cache/` for zero-network offline resolution.
 *  2. Enriches `tools/catalogue-sources.json` to eliminate missing IDs across backlog entries.
 *  3. Populates `anime_id_map` in local Miniflare D1 SQLite (`.wrangler/state/v3/d1/.../*.sqlite`).
 *  4. Exports programmatic `resolveFribbIds` and `getFribbIndexes` for sync daemon integration.
 *
 * Usage:
 *  node tools/sync-fribb-id-map.mjs                     # Ingest & enrich sources + local D1
 *  node tools/sync-fribb-id-map.mjs --refresh           # Force download fresh upstream dataset
 *  node tools/sync-fribb-id-map.mjs --dry-run           # Inspect enrichment counts without writing
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { findSqlitePath } from './discover-titles.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');

const CACHE_DIR = resolve(ROOT, 'tools/.cache');
const CACHE_FILE = resolve(CACHE_DIR, 'anime-list-mini.json');
const SOURCES_FILE = resolve(ROOT, 'tools/catalogue-sources.json');
const FRIBB_URL = 'https://raw.githubusercontent.com/Fribb/anime-lists/master/anime-list-mini.json';

/**
 * @typedef {Object} FribbEntry
 * @property {string} [type]
 * @property {number} [anidb_id]
 * @property {number} [anilist_id]
 * @property {number} [kitsu_id]
 * @property {number} [mal_id]
 * @property {any} [themoviedb_id]
 * @property {number} [tvdb_id]
 */

/**
 * @typedef {Object} FribbIndexes
 * @property {Map<number, FribbEntry>} byMal
 * @property {Map<number, FribbEntry>} byAnilist
 * @property {Map<number, FribbEntry>} byKitsu
 * @property {Map<number, FribbEntry>} byAnidb
 */

/**
 * Fetches or reads cached Fribb anime-list dataset.
 * @param {{ forceRefresh?: boolean }} [options]
 * @returns {Promise<FribbEntry[]>}
 */
export async function fetchFribbList({ forceRefresh = false } = {}) {
  if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true });
  }

  if (!forceRefresh && existsSync(CACHE_FILE)) {
    try {
      const raw = readFileSync(CACHE_FILE, 'utf8');
      const data = JSON.parse(raw);
      if (Array.isArray(data) && data.length > 0) {
        return data;
      }
    } catch (err) {
      console.warn('[fribb-sync] Cached dataset corrupted, re-downloading:', err.message);
    }
  }

  console.log(`[fribb-sync] Fetching universal anime list from ${FRIBB_URL}...`);
  const res = await fetch(FRIBB_URL, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) {
    throw new Error(`Failed to download Fribb dataset: HTTP ${res.status}`);
  }

  const list = await res.json();
  if (!Array.isArray(list)) {
    throw new Error('Unexpected Fribb dataset response format (expected array)');
  }

  writeFileSync(CACHE_FILE, JSON.stringify(list), 'utf8');
  console.log(`[fribb-sync] Cached ${list.length} cross-referenced anime entries.`);
  return list;
}

/**
 * Builds in-memory fast lookup indexes from Fribb entries.
 * @param {FribbEntry[]} list
 * @returns {FribbIndexes}
 */
export function buildFribbIndexes(list) {
  const byMal = new Map();
  const byAnilist = new Map();
  const byKitsu = new Map();
  const byAnidb = new Map();

  for (const item of list) {
    if (item.mal_id && typeof item.mal_id === 'number') {
      byMal.set(item.mal_id, item);
    }
    if (item.anilist_id && typeof item.anilist_id === 'number') {
      byAnilist.set(item.anilist_id, item);
    }
    if (item.kitsu_id && typeof item.kitsu_id === 'number') {
      byKitsu.set(item.kitsu_id, item);
    }
    if (item.anidb_id && typeof item.anidb_id === 'number') {
      byAnidb.set(item.anidb_id, item);
    }
  }

  return { byMal, byAnilist, byKitsu, byAnidb };
}

let _cachedIndexes = null;

/**
 * Lazy loads singleton in-memory indexes.
 * @param {boolean} [forceRefresh]
 * @returns {Promise<FribbIndexes>}
 */
export async function getFribbIndexes(forceRefresh = false) {
  if (!_cachedIndexes || forceRefresh) {
    const list = await fetchFribbList({ forceRefresh });
    _cachedIndexes = buildFribbIndexes(list);
  }
  return _cachedIndexes;
}

/**
 * Resolves companion IDs given any known provider ID.
 * @param {{ mal?: number|null, anilist?: number|null, kitsu?: number|null, anidb?: number|null }} ids
 * @param {FribbIndexes} indexes
 * @returns {{ mal: number|null, anilist: number|null, kitsu: number|null, anidb: number|null, type?: string|null } | null}
 */
export function resolveFribbIds(ids, indexes) {
  let matched = null;

  if (ids.mal && indexes.byMal.has(Number(ids.mal))) {
    matched = indexes.byMal.get(Number(ids.mal));
  } else if (ids.anilist && indexes.byAnilist.has(Number(ids.anilist))) {
    matched = indexes.byAnilist.get(Number(ids.anilist));
  } else if (ids.mal && Number(ids.mal) > 70000 && indexes.byAnilist.has(Number(ids.mal))) {
    // Heuristic: If mal > 70000 and not in byMal, it is an AniList ID misplaced into the mal field
    matched = indexes.byAnilist.get(Number(ids.mal));
  } else if (ids.kitsu && indexes.byKitsu.has(Number(ids.kitsu))) {
    matched = indexes.byKitsu.get(Number(ids.kitsu));
  } else if (ids.anidb && indexes.byAnidb.has(Number(ids.anidb))) {
    matched = indexes.byAnidb.get(Number(ids.anidb));
  }

  if (!matched) return null;

  return {
    mal: matched.mal_id || (ids.mal && Number(ids.mal) < 70000 ? Number(ids.mal) : null),
    anilist: matched.anilist_id || (ids.anilist ? Number(ids.anilist) : (ids.mal && Number(ids.mal) > 70000 ? Number(ids.mal) : null)),
    kitsu: matched.kitsu_id || (ids.kitsu ? Number(ids.kitsu) : null),
    anidb: matched.anidb_id || (ids.anidb ? Number(ids.anidb) : null),
    type: matched.type || null,
  };
}

/**
 * Enriches `catalogue-sources.json` with missing IDs from Fribb indexes.
 * @param {{ sourcesPath?: string, indexes?: FribbIndexes, dryRun?: boolean }} [options]
 * @returns {Promise<{ total: number, enriched: number, missingAfter: number }>}
 */
export async function enrichCatalogueSources({
  sourcesPath = SOURCES_FILE,
  indexes = null,
  dryRun = false,
} = {}) {
  const fribbIndexes = indexes || (await getFribbIndexes());
  if (!existsSync(sourcesPath)) {
    throw new Error(`Catalogue sources file not found at ${sourcesPath}`);
  }

  const raw = readFileSync(sourcesPath, 'utf8');
  const sources = JSON.parse(raw);

  let enriched = 0;
  let missingAfter = 0;

  for (const s of sources) {
    const wasIncomplete = !s.kitsu || !s.anilist || !s.mal;
    if (!wasIncomplete) continue;

    const resolved = resolveFribbIds(
      { mal: s.mal, anilist: s.anilist, kitsu: s.kitsu, anidb: s.anidb },
      fribbIndexes
    );

    if (resolved) {
      let changed = false;
      if (s.mal && Number(s.mal) > 70000 && resolved.anilist === Number(s.mal)) {
        s.anilist = Number(s.mal);
        s.mal = resolved.mal || null;
        changed = true;
      }
      if (!s.mal && resolved.mal) {
        s.mal = resolved.mal;
        changed = true;
      }
      if (!s.anilist && resolved.anilist) {
        s.anilist = resolved.anilist;
        changed = true;
      }
      if (!s.kitsu && resolved.kitsu) {
        s.kitsu = resolved.kitsu;
        changed = true;
      }
      if (changed) enriched++;
    }

    if (!s.kitsu || !s.anilist) {
      missingAfter++;
    }
  }

  if (!dryRun && enriched > 0) {
    writeFileSync(sourcesPath, JSON.stringify(sources, null, 2) + '\n', 'utf8');
    console.log(`[fribb-sync] Enriched ${enriched} catalogue source titles in ${sourcesPath}`);
  }

  return { total: sources.length, enriched, missingAfter };
}

/**
 * Ingests cross-referenced IDs directly into local SQLite `anime_id_map`.
 * @param {DatabaseSync} [dbInstance]
 * @param {{ sourcesPath?: string, indexes?: FribbIndexes }} [options]
 * @returns {Promise<{ insertedOrUpdated: number }>}
 */
export async function populateLocalIdMap(dbInstance, { sourcesPath = SOURCES_FILE, indexes = null } = {}) {
  let db = dbInstance;
  let shouldClose = false;

  if (!db) {
    const sqlitePath = findSqlitePath();
    if (!sqlitePath) {
      throw new Error('Local SQLite database not found. Run "npm run pages:dev" or "npm run db:init" first.');
    }
    db = new DatabaseSync(sqlitePath);
    shouldClose = true;
  }

  const fribbIndexes = indexes || (await getFribbIndexes());
  const sources = JSON.parse(readFileSync(sourcesPath, 'utf8'));

  // Ensure anime_id_map table exists
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
    CREATE INDEX IF NOT EXISTS id_map_by_mal ON anime_id_map(mal_id);
    CREATE INDEX IF NOT EXISTS id_map_by_anilist ON anime_id_map(anilist_id);
    CREATE INDEX IF NOT EXISTS id_map_by_kitsu ON anime_id_map(kitsu_id);
  `);

  // Query existing anime in database to respect FOREIGN KEY constraint
  const existingRows = db.prepare('SELECT id FROM anime').all();
  const existingIds = new Set(existingRows.map((r) => r.id));

  const stmt = db.prepare(`
    INSERT INTO anime_id_map (anime_id, mal_id, anilist_id, kitsu_id, anikoto_slug, hianime_slug, aniwatch_slug, adb_slug, waw_slug, confidence, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(anime_id) DO UPDATE SET
      mal_id = coalesce(excluded.mal_id, anime_id_map.mal_id),
      anilist_id = coalesce(excluded.anilist_id, anime_id_map.anilist_id),
      kitsu_id = coalesce(excluded.kitsu_id, anime_id_map.kitsu_id),
      anikoto_slug = coalesce(excluded.anikoto_slug, anime_id_map.anikoto_slug),
      hianime_slug = coalesce(excluded.hianime_slug, anime_id_map.hianime_slug),
      aniwatch_slug = coalesce(excluded.aniwatch_slug, anime_id_map.aniwatch_slug),
      confidence = excluded.confidence,
      updated_at = datetime('now')
  `);

  let count = 0;
  db.exec('BEGIN TRANSACTION');
  try {
    for (const s of sources) {
      if (!existingIds.has(s.id)) {
        continue;
      }

      const resolved = resolveFribbIds(
        { mal: s.mal, anilist: s.anilist, kitsu: s.kitsu, anidb: s.anidb },
        fribbIndexes
      );

      const malId = resolved?.mal ?? s.mal ?? null;
      const anilistId = resolved?.anilist ?? s.anilist ?? null;
      const kitsuId = resolved?.kitsu ?? s.kitsu ?? null;
      const confidence = malId ? 1.0 : (anilistId && kitsuId ? 1.0 : 0.85);

      stmt.run(
        s.id,
        malId,
        anilistId,
        kitsuId,
        s.anikoto ?? null,
        s.hianime ?? null,
        s.aniwatch ?? null,
        s.adb ?? null,
        s.waw ?? null,
        confidence
      );
      count++;
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    if (shouldClose) {
      db.close();
    }
  }

  console.log(`[fribb-sync] Populated ${count} active anime records into anime_id_map in local SQLite.`);
  return { insertedOrUpdated: count };
}

// CLI runner
if (process.argv[1] && resolve(process.argv[1]) === resolve(__filename)) {
  const forceRefresh = process.argv.includes('--refresh');
  const dryRun = process.argv.includes('--dry-run');

  try {
    console.log('[fribb-sync] Starting Universal ID Map synchronization...');
    const indexes = await getFribbIndexes(forceRefresh);
    console.log(`[fribb-sync] Indexed: MAL=${indexes.byMal.size}, AniList=${indexes.byAnilist.size}, Kitsu=${indexes.byKitsu.size}`);

    const enrichStats = await enrichCatalogueSources({ indexes, dryRun });
    console.log(`[fribb-sync] Enrichment summary: ${enrichStats.enriched} enriched, ${enrichStats.missingAfter} still missing out of ${enrichStats.total} titles.`);

    if (!dryRun) {
      const dbStats = await populateLocalIdMap(null, { indexes });
      console.log(`[fribb-sync] Database sync complete: ${dbStats.insertedOrUpdated} records committed to anime_id_map.`);
    }

    console.log('[fribb-sync] SUCCESS: Universal ID Map synchronization completed.');
    process.exit(0);
  } catch (err) {
    console.error('[fribb-sync] FATAL:', err.message);
    process.exit(1);
  }
}
