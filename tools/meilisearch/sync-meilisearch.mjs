// @ts-check
/**
 * Meilisearch Catalog Sync Script
 * Extracts anime records from the catalogue (live D1 SQLite database or seed.sql)
 * and synchronizes them into Meilisearch with real-time delta and full-sync support.
 *
 * Run with: node tools/meilisearch/sync-meilisearch.mjs
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const SEED_FILE = resolve(ROOT, 'seed.sql');
const MEILISEARCH_HOST = process.env.MEILISEARCH_HOST || 'http://127.0.0.1:7700';
const MEILISEARCH_KEY = process.env.MEILISEARCH_KEY || '';
const INDEX_UID = 'anime';
const BATCH_SIZE = 100;

export function findSqlitePath() {
  const d1Dir = resolve(ROOT, '.wrangler/state/v3/d1/miniflare-D1DatabaseObject');
  if (existsSync(d1Dir)) {
    const files = readdirSync(d1Dir).filter((f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite');
    if (files.length > 0) return resolve(d1Dir, files[0]);
  }
  return null;
}

/**
 * Checks whether Meilisearch server is reachable and healthy.
 * @param {string} [host]
 * @param {number} [timeoutMs]
 * @returns {Promise<boolean>}
 */
export async function isMeilisearchHealthy(host = MEILISEARCH_HOST, timeoutMs = 1200) {
  try {
    const res = await fetch(`${host}/health`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Extracts structured anime documents directly from D1 SQLite database.
 * @param {DatabaseSync} db
 * @param {string[]|null} [ids]
 * @returns {Array<any>}
 */
export function getAnimeDocumentsFromDb(db, ids = null) {
  let query = `
    SELECT id, title, native, year, rating, season, kind, status, art, key_art, accent, synopsis, rank, trend_rank
    FROM anime
  `;
  const params = [];
  if (Array.isArray(ids) && ids.length > 0) {
    const placeholders = ids.map(() => '?').join(',');
    query += ` WHERE id IN (${placeholders})`;
    params.push(...ids);
  } else {
    query += ` ORDER BY id ASC`;
  }

  const rows = db.prepare(query).all(...params);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    romajiTitle: r.title,
    nativeTitle: r.native || '',
    year: Number(r.year) || 0,
    rating: Number(r.rating) || 0,
    season: r.season || '',
    kind: r.kind || 'TV',
    status: r.status || 'Finished',
    art: r.art || '',
    key_art: r.key_art || '',
    accent: r.accent || '#ff1f4a',
    synopsis: r.synopsis || '',
    rank: r.rank !== null ? Number(r.rank) : null,
    trend_rank: r.trend_rank !== null ? Number(r.trend_rank) : null,
    synonyms: [r.title],
  }));
}

/**
 * Parses anime INSERT statements from seed.sql.
 * @param {string} [seedPath]
 * @returns {Array<any>}
 */
export function parseAnimeFromSeed(seedPath = SEED_FILE) {
  if (!existsSync(seedPath)) {
    throw new Error(`seed.sql not found at ${seedPath}`);
  }

  const content = readFileSync(seedPath, 'utf8');
  /** @type {Map<string, any>} */
  const docMap = new Map();

  const insertRegex = /INSERT INTO anime\s*\([^)]+\)\s*VALUES\s*\(([\s\S]*?)\)\s*(?:ON CONFLICT|;)/gi;
  let match;

  while ((match = insertRegex.exec(content)) !== null) {
    const rawValues = match[1];
    const tokens = [];
    let cur = '';
    let inQuote = false;

    for (let i = 0; i < rawValues.length; i++) {
      const ch = rawValues[i];
      if (ch === "'") {
        if (inQuote && rawValues[i + 1] === "'") {
          cur += "'";
          i++;
        } else {
          inQuote = !inQuote;
        }
      } else if (ch === ',' && !inQuote) {
        tokens.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    if (cur.trim()) tokens.push(cur.trim());

    if (tokens.length >= 12) {
      const unquote = (v) => {
        if (!v || v === 'NULL') return null;
        if (v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1);
        return v;
      };

      const id = unquote(tokens[0]);
      const title = unquote(tokens[1]);
      const native = unquote(tokens[2]);
      const year = Number.parseInt(unquote(tokens[3]) || '0', 10);
      const rating = Number.parseFloat(unquote(tokens[4]) || '0');
      const season = unquote(tokens[5]) || '';
      const kind = unquote(tokens[6]) || '';
      const status = unquote(tokens[7]) || '';
      const art = unquote(tokens[8]) || '';
      const keyArt = unquote(tokens[9]) || '';
      const accent = unquote(tokens[10]) || '';
      const synopsis = unquote(tokens[11]) || '';

      if (id && title) {
        docMap.set(id, {
          id,
          title,
          romajiTitle: title,
          nativeTitle: native,
          year,
          rating,
          season,
          kind,
          status,
          art,
          key_art: keyArt,
          accent,
          synopsis,
          synonyms: [title],
        });
      }
    }
  }

  const sourcesPath = resolve(ROOT, 'tools/catalogue-sources.json');
  if (existsSync(sourcesPath)) {
    try {
      const sources = JSON.parse(readFileSync(sourcesPath, 'utf8'));
      for (const item of sources) {
        if (item.id && !docMap.has(item.id)) {
          const title = item.id
            .split('-')
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(' ');
          docMap.set(item.id, {
            id: item.id,
            title,
            romajiTitle: title,
            nativeTitle: null,
            year: 2024,
            rating: 8.0,
            season: 'Fall 2024',
            kind: 'TV',
            status: 'Finished',
            art: `https://media.kitsu.app/anime/poster_images/${item.kitsu || 1}/medium.jpg`,
            key_art: '',
            accent: '#ff1f4a',
            synopsis: `Catalogue anime entry for ${title}.`,
            synonyms: [title],
          });
        }
      }
    } catch {}
  }

  return Array.from(docMap.values());
}

/**
 * Uploads documents to Meilisearch in batches.
 * @param {Array<any>} documents
 * @param {string} [host]
 * @param {string} [apiKey]
 */
export async function syncDocumentsToMeilisearch(
  documents,
  host = MEILISEARCH_HOST,
  apiKey = MEILISEARCH_KEY
) {
  if (!documents.length) {
    return { count: 0, taskUids: [] };
  }

  const headers = {
    'Content-Type': 'application/json',
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };

  const taskUids = [];

  for (let i = 0; i < documents.length; i += BATCH_SIZE) {
    const chunk = documents.slice(i, i + BATCH_SIZE);
    const res = await fetch(`${host}/indexes/${INDEX_UID}/documents`, {
      method: 'POST',
      headers,
      body: JSON.stringify(chunk),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Meilisearch document upload failed at batch ${i}: ${errText}`);
    }

    const task = await res.json();
    taskUids.push(task.taskUid);
  }

  return { count: documents.length, taskUids };
}

/**
 * Synchronizes anime records from D1 or seed.sql to Meilisearch with health check.
 * @param {Object} [options]
 * @param {DatabaseSync|null} [options.db]
 * @param {string} [options.host]
 * @param {string} [options.apiKey]
 * @param {string[]|null} [options.ids]
 * @param {boolean} [options.silent]
 */
export async function syncAnimeToMeilisearch({
  db = null,
  host = MEILISEARCH_HOST,
  apiKey = MEILISEARCH_KEY,
  ids = null,
  silent = false,
} = {}) {
  const healthy = await isMeilisearchHealthy(host);
  if (!healthy) {
    if (!silent) {
      console.log(`[Meilisearch] Host ${host} offline. Active search fallback: D1 SQLite FTS5/LIKE.`);
    }
    return { ok: false, status: 'offline', synced: 0, reason: 'meilisearch_offline' };
  }

  let localDb = db;
  let closeDb = false;
  if (!localDb) {
    const p = findSqlitePath();
    if (p) {
      localDb = new DatabaseSync(p);
      closeDb = true;
    }
  }

  let docs = [];
  if (localDb) {
    docs = getAnimeDocumentsFromDb(localDb, ids);
  } else {
    docs = parseAnimeFromSeed();
    if (Array.isArray(ids) && ids.length > 0) {
      const idSet = new Set(ids);
      docs = docs.filter((d) => idSet.has(d.id));
    }
  }

  if (closeDb && localDb) {
    try {
      localDb.close();
    } catch {}
  }

  if (docs.length === 0) {
    return { ok: true, status: 'empty', synced: 0 };
  }

  try {
    const result = await syncDocumentsToMeilisearch(docs, host, apiKey);
    if (!silent) {
      console.log(`[Meilisearch] Synchronized ${result.count} anime documents successfully.`);
    }
    return { ok: true, status: 'synced', synced: result.count, taskUids: result.taskUids };
  } catch (err) {
    if (!silent) {
      console.warn(`[Meilisearch] Sync error:`, err.message);
    }
    return { ok: false, status: 'error', synced: 0, error: err.message };
  }
}

if (process.argv[1] && process.argv[1].endsWith('sync-meilisearch.mjs')) {
  syncAnimeToMeilisearch({ silent: false })
    .then((res) => {
      if (res.ok) {
        console.log(`Meilisearch sync completed successfully.`);
      } else {
        console.log(`Meilisearch sync finished: ${res.status} (${res.reason || res.error || 'skipped'})`);
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error('Error during Meilisearch sync:', err.message);
      process.exit(1);
    });
}
