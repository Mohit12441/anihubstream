// @ts-check
/**
 * cloud-sync/sync-providers.mjs
 *
 * Automated Multi-Provider & Franchise Synchronization for Cloudflare D1.
 * 
 * Synchronizes:
 * 1. AniKoto provider mappings (`anime_provider_mapping`, `anime_id_map`)
 * 2. AniWatch provider mappings (`anime_provider_mapping`, `anime_id_map`)
 * 3. HiAnime / Source IDs alignment
 * 4. Bidirectional Franchise & Season Relations (`anime_franchise_relation`)
 * 5. Uniform 10-point rating normalization
 *
 * Can run locally against SQLite or in GitHub Actions against remote D1 using d1.mjs.
 */

import { randomUUID } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { d1All, d1First, d1Query, insertRows } from './d1.mjs';
import { acquireLease, leaseKeeper, recordRun, releaseLease } from './state.mjs';
import { computeFranchiseGraph } from '../tools/auto-sync-franchises.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUN_ID = randomUUID();
const LEASE = 'providers';
const OWNER = `providers-${RUN_ID}`;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const intEnv = (name, fallback) => {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be a positive integer, got ${raw}`);
  return n;
};

const BATCH_SIZE = intEnv('PROVIDERS_BATCH_SIZE', 50);

/**
 * Normalizes title for comparison
 */
function normalizeTitle(t) {
  return String(t || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/['‘’`"]/g, '')
    .replace(/\(.*?\)/g, ' ')
    .replace(/\b(?:season|cour|part)\s+\p{L}+\b/gu, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * @deprecated One-ID architecture resolves AniKoto dynamically via mal_id at playback time.
 */
export async function syncAniKotoMappings() {
  return 0;
}

/**
 * @deprecated One-ID architecture resolves AniWatch dynamically via MegaPlay/Zoko.
 */
export async function syncAniWatchMappings() {
  return 0;
}

/**
 * 3. Sync Franchise Relations
 */
export async function syncFranchiseRelations() {
  console.log('[sync-providers] 🔄 Computing and synchronizing franchise relations graph...');
  try {
    const rows = await d1All('SELECT id, title, year, season, kind, alt_seasons FROM anime');
    console.log(`[sync-providers] Computing franchise graph for ${rows.length} anime...`);
    const relations = computeFranchiseGraph(rows);
    console.log(`[sync-providers] Identified ${relations.length} franchise relations.`);

    // Delta check: only sync relations that do not already exist in D1
    const existingRows = await d1All('SELECT anime_id, related_id FROM anime_franchise_relation');
    const existingSet = new Set(existingRows.map((r) => `${r.anime_id}:${r.related_id}`));
    const delta = relations.filter((rel) => !existingSet.has(`${rel.anime_id}:${rel.related_id}`));

    if (delta.length === 0) {
      console.log(`[sync-providers] ✅ All ${relations.length} franchise relations already up to date.`);
      return 0;
    }

    console.log(`[sync-providers] Inserting ${delta.length} delta franchise relations...`);
    const inserted = await insertRows({
      table: 'anime_franchise_relation',
      columns: ['anime_id', 'related_id', 'relation_type', 'chronology_order', 'created_at'],
      rows: delta.map((rel) => [rel.anime_id, rel.related_id, rel.relation_type, rel.chronology_order, new Date().toISOString()]),
      conflictTarget: ['anime_id', 'related_id'],
      update: ['relation_type', 'chronology_order'],
    });

    console.log(`[sync-providers] ✅ Successfully updated ${delta.length} franchise relations across ${inserted} batch statements.`);
    return delta.length;
  } catch (err) {
    console.error('[sync-providers] Error computing franchise relations:', err.message);
    return 0;
  }
}

/**
 * 4. Normalize Ratings
 */
export async function normalizeRatings() {
  console.log('[sync-providers] 🔄 Normalizing catalog ratings to 10-point scale...');
  try {
    const res = await d1Query('UPDATE anime SET rating = round(rating / 10.0, 1) WHERE rating > 10');
    console.log(`[sync-providers] ✅ Normalized ratings (changes: ${res?.meta?.changes || 0}).`);
    return res?.meta?.changes || 0;
  } catch (err) {
    console.warn('[sync-providers] Note on rating normalization:', err.message);
    return 0;
  }
}

/**
 * Main Orchestrator
 */
export async function runProvidersSync({ force = false } = {}) {
  console.log(`[sync-providers] Starting Multi-Provider Sync Run ${RUN_ID}...`);
  let leaseHeld = false;
  if (!force) {
    leaseHeld = await acquireLease(LEASE, OWNER);
    if (!leaseHeld) {
      console.warn(`[sync-providers] Lease '${LEASE}' is held by another runner; exiting cleanly.`);
      return { status: 'skipped', reason: 'lease_held' };
    }
  }

  const keeper = leaseKeeper(LEASE, OWNER);
  const results = {
    franchises: 0,
    ratings: 0,
  };

  try {
    await keeper();
    results.ratings = await normalizeRatings();

    await keeper();
    results.franchises = await syncFranchiseRelations();

    await recordRun(OWNER, Date.now(), {
      status: 'success',
      ...results,
    });
    console.log('[sync-providers] 🎉 Metadata & Franchise Graph Sync Completed successfully:', results);
    return { status: 'success', results };
  } catch (err) {
    console.error('[sync-providers] Fatal error during provider sync:', err);
    await recordRun(OWNER, Date.now(), { status: 'error', error: err.message }).catch(() => null);
    throw err;
  } finally {
    if (leaseHeld) {
      await releaseLease(LEASE, OWNER).catch(() => null);
    }
  }
}

// Direct CLI invocation
if (process.argv[1] && process.argv[1].endsWith('sync-providers.mjs')) {
  runProvidersSync({ force: process.argv.includes('--force') })
    .then((res) => {
      console.log('Result:', res);
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
