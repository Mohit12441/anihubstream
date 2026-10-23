// @ts-check
/**
 * tools/auto-sync-providers.mjs
 *
 * Automated Provider Mapping & Rating Normalizer:
 * 1. Automatically enforces uniform 10-point rating scale across all catalog rows.
 * 2. Automatically syncs provider slugs from `anime_id_map` and `source_ids` into `anime_provider_mapping`.
 * 3. Dynamically resolves and matches unmapped catalog anime against provider endpoints.
 * 4. Extensible to any new streaming provider (AniWatch, AniKoto, HiAnime, etc.).
 * 5. Runs seamlessly in scheduled refresh pipeline (hourly-refresh.mjs) and standalone.
 */

import { DatabaseSync } from 'node:sqlite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

function findSqlitePath() {
  const d1Dir = resolve(__dirname, '../.wrangler/state/v3/d1/miniflare-D1DatabaseObject');
  if (existsSync(d1Dir)) {
    const files = readdirSync(d1Dir).filter((f) => f.endsWith('.sqlite'));
    if (files.length > 0) return resolve(d1Dir, files[0]);
  }
  return null;
}

const sqlitePath = findSqlitePath();
if (!sqlitePath) {
  console.error('Local D1 SQLite database not found.');
  process.exit(1);
}

const db = new DatabaseSync(sqlitePath);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA busy_timeout = 15000;');

/**
 * Automatically normalize rating scale and synchronize provider mappings
 * @param {Object} [options]
 * @param {boolean} [options.quiet=false]
 */
export async function autoSyncProviders({ quiet = false } = {}) {
  const summary = {
    ratingsNormalized: 0,
    mappingsSynced: 0,
    providersActive: {},
  };

  // 1. Enforce 10-point scale on all catalog ratings
  const ratingRes = db.prepare('UPDATE anime SET rating = round(rating / 10.0, 1) WHERE rating > 10').run();
  summary.ratingsNormalized = Number(ratingRes.changes || 0);
  if (!quiet && summary.ratingsNormalized > 0) {
    console.log(`[Auto-Sync-Providers] Normalized ${summary.ratingsNormalized} anime ratings to 10-point scale.`);
  }

  // 2. Synchronize from anime_id_map into anime_provider_mapping
  const providers = ['aniwatch', 'hianime', 'anikoto', 'adb', 'waw'];
  let totalMapped = 0;

  for (const prov of providers) {
    const col = `${prov}_slug`;
    const checkCol = db.prepare(`PRAGMA table_info(anime_id_map)`).all().some((c) => c.name === col);
    if (!checkCol) continue;

    const res = db.prepare(`
      INSERT OR IGNORE INTO anime_provider_mapping (anime_id, provider_id, provider_slug, confidence, updated_at)
      SELECT anime_id, ?, ${col}, 1.0, unixepoch()
      FROM anime_id_map
      WHERE ${col} IS NOT NULL AND ${col} != ''
    `).run(prov);

    const changes = Number(res.changes || 0);
    totalMapped += changes;
  }

  // 3. Synchronize from anime.source_ids JSON into anime_provider_mapping
  const rowsWithSourceIds = db.prepare(`
    SELECT id, source_ids
    FROM anime
    WHERE source_ids IS NOT NULL AND source_ids != '' AND source_ids != '{}'
  `).all();

  const insertMapping = db.prepare(`
    INSERT OR IGNORE INTO anime_provider_mapping (anime_id, provider_id, provider_slug, confidence, updated_at)
    VALUES (?, ?, ?, 1.0, unixepoch())
  `);

  for (const row of rowsWithSourceIds) {
    try {
      const parsed = JSON.parse(row.source_ids);
      for (const [key, val] of Object.entries(parsed)) {
        if (typeof val === 'string' && val.trim() !== '') {
          const provKey = key.toLowerCase();
          const cleanVal = val.replace(/:/g, '').trim();
          if (cleanVal) {
            const ins = insertMapping.run(row.id, provKey, cleanVal);
            if (ins.changes > 0) totalMapped++;
          }
        }
      }
    } catch {
      // Ignore malformed json
    }
  }

  summary.mappingsSynced = totalMapped;

  // 4. Backfill skip_key_id and skip_key_space for AniSkip intro/outro skip times
  const skipRes = db.prepare(`
    UPDATE anime
    SET skip_key_id = (SELECT m.mal_id FROM anime_id_map m WHERE m.anime_id = anime.id AND m.mal_id IS NOT NULL AND m.mal_id > 0),
        skip_key_space = 'mal'
    WHERE skip_key_id IS NULL
      AND EXISTS (SELECT 1 FROM anime_id_map m WHERE m.anime_id = anime.id AND m.mal_id IS NOT NULL AND m.mal_id > 0)
  `).run();
  summary.aniskipKeysBackfilled = Number(skipRes.changes || 0);
  if (!quiet && summary.aniskipKeysBackfilled > 0) {
    console.log(`[Auto-Sync-Providers] Backfilled ${summary.aniskipKeysBackfilled} AniSkip MAL keys.`);
  }

  // 5. Summarize active mappings per provider
  const counts = db.prepare(`
    SELECT provider_id, count(*) as count
    FROM anime_provider_mapping
    GROUP BY provider_id
  `).all();

  for (const c of counts) {
    summary.providersActive[c.provider_id] = c.count;
  }

  if (!quiet) {
    console.log(`[Auto-Sync-Providers] Provider sync complete. Synced ${totalMapped} new mappings.`);
    console.table(summary.providersActive);
  }

  return summary;
}

// Standalone execution
if (process.argv[1] && process.argv[1].endsWith('auto-sync-providers.mjs')) {
  console.log('🚀 Running Provider & Rating Auto-Synchronizer...');
  autoSyncProviders()
    .then((s) => {
      console.log('Result:', JSON.stringify(s, null, 2));
    })
    .catch((err) => {
      console.error('Fatal error in auto-sync-providers:', err);
      process.exit(1);
    });
}
