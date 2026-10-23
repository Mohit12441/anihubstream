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
import { d1All, d1First, d1Query } from './d1.mjs';
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
 * 1. Sync AniKoto Slugs
 */
export async function syncAniKotoMappings() {
  console.log('[sync-providers] 🔄 Synchronizing AniKoto provider mappings...');
  const slugsFile = resolve(__dirname, '../tools/anikoto-slugs.json');
  if (!existsSync(slugsFile)) {
    console.warn('[sync-providers] tools/anikoto-slugs.json not found, skipping static slug set.');
    return 0;
  }

  let mappedCount = 0;
  try {
    const rawData = JSON.parse(readFileSync(slugsFile, 'utf8'));
    const entries = Object.entries(rawData).filter(([animeId, slug]) => slug && slug !== animeId);

    for (let i = 0; i < entries.length; i += BATCH_SIZE) {
      const chunk = entries.slice(i, i + BATCH_SIZE);
      for (const [animeId, slug] of chunk) {
        try {
          await d1Query(
            `INSERT INTO anime_provider_mapping (anime_id, provider_id, provider_slug, confidence, updated_at)
             VALUES (?1, 'anikoto', ?2, 1.0, unixepoch())
             ON CONFLICT(anime_id, provider_id) DO UPDATE SET
               provider_slug = excluded.provider_slug,
               confidence = excluded.confidence,
               updated_at = unixepoch()`,
            [animeId, slug]
          );

          await d1Query(
            `INSERT INTO anime_id_map (anime_id, anikoto_slug, confidence, updated_at)
             VALUES (?1, ?2, 1.0, datetime('now'))
             ON CONFLICT(anime_id) DO UPDATE SET
               anikoto_slug = excluded.anikoto_slug,
               confidence = excluded.confidence,
               updated_at = datetime('now')`,
            [animeId, slug]
          );
          mappedCount++;
        } catch (e) {
          // ignore single item failure
        }
      }
    }
    console.log(`[sync-providers] ✅ Synced ${mappedCount} AniKoto provider mappings.`);
  } catch (err) {
    console.error('[sync-providers] Error syncing AniKoto mappings:', err.message);
  }
  return mappedCount;
}

/**
 * 2. Sync AniWatch Catalog
 */
export async function syncAniWatchMappings() {
  console.log('[sync-providers] 🔄 Synchronizing AniWatch provider mappings...');
  let mappedCount = 0;
  try {
    const res = await fetch('https://aniwatch.co.at/anime-sitemap.xml', {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      console.warn(`[sync-providers] AniWatch sitemap returned HTTP ${res.status}`);
      return 0;
    }

    const xml = await res.text();
    const locMatches = [...xml.matchAll(/<loc>(https?:\/\/[^<]+)<\/loc>/gi)];
    const slugs = locMatches
      .map((m) => {
        try {
          const url = new URL(m[1]);
          const segs = url.pathname.split('/').filter(Boolean);
          return segs[segs.length - 1];
        } catch {
          return null;
        }
      })
      .filter((s) => s && s !== 'anime' && !s.endsWith('.xml') && !s.includes('sitemap'));

    console.log(`[sync-providers] Found ${slugs.length} AniWatch sitemap entries.`);

    // Match each against anime table in D1
    const animeRows = await d1All('SELECT id, title, source_ids FROM anime');
    const byId = new Map(animeRows.map((r) => [r.id, r]));
    const byTitle = new Map(animeRows.map((r) => [normalizeTitle(r.title), r]));

    for (const slug of slugs) {
      let matched = byId.get(slug);
      if (!matched) {
        matched = byTitle.get(normalizeTitle(slug.replace(/-/g, ' ')));
      }

      if (matched) {
        try {
          await d1Query(
            `INSERT INTO anime_provider_mapping (anime_id, provider_id, provider_slug, confidence, updated_at)
             VALUES (?1, 'aniwatch', ?2, 0.95, unixepoch())
             ON CONFLICT(anime_id, provider_id) DO UPDATE SET
               provider_slug = excluded.provider_slug,
               confidence = excluded.confidence,
               updated_at = unixepoch()`,
            [matched.id, slug]
          );

          await d1Query(
            `INSERT INTO anime_id_map (anime_id, aniwatch_slug, confidence, updated_at)
             VALUES (?1, ?2, 0.95, datetime('now'))
             ON CONFLICT(anime_id) DO UPDATE SET
               aniwatch_slug = excluded.aniwatch_slug,
               confidence = excluded.confidence,
               updated_at = datetime('now')`,
            [matched.id, slug]
          );
          mappedCount++;
        } catch {}
      }
    }
    console.log(`[sync-providers] ✅ Synced ${mappedCount} AniWatch provider mappings.`);
  } catch (err) {
    console.warn('[sync-providers] Note: AniWatch sitemap unreachable or timed out:', err.message);
  }
  return mappedCount;
}

/**
 * 3. Sync Franchise Relations
 */
export async function syncFranchiseRelations() {
  console.log('[sync-providers] 🔄 Computing and synchronizing franchise relations graph...');
  let syncedRelations = 0;
  try {
    const rows = await d1All('SELECT id, title, year, season, kind, alt_seasons FROM anime');
    console.log(`[sync-providers] Computing franchise graph for ${rows.length} anime...`);
    const relations = computeFranchiseGraph(rows);
    console.log(`[sync-providers] Identified ${relations.length} franchise relations.`);

    for (let i = 0; i < relations.length; i += BATCH_SIZE) {
      const chunk = relations.slice(i, i + BATCH_SIZE);
      for (const rel of chunk) {
        try {
          await d1Query(
            `INSERT OR REPLACE INTO anime_franchise_relation (anime_id, related_id, relation_type, chronology_order, created_at)
             VALUES (?1, ?2, ?3, ?4, datetime('now'))`,
            [rel.anime_id, rel.related_id, rel.relation_type, rel.chronology_order]
          );
          syncedRelations++;
        } catch {}
      }
    }
    console.log(`[sync-providers] ✅ Successfully updated ${syncedRelations} franchise relations.`);
  } catch (err) {
    console.error('[sync-providers] Error computing franchise relations:', err.message);
  }
  return syncedRelations;
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
    anikoto: 0,
    aniwatch: 0,
    franchises: 0,
    ratings: 0,
  };

  try {
    await keeper();
    results.ratings = await normalizeRatings();
    
    await keeper();
    results.anikoto = await syncAniKotoMappings();

    await keeper();
    results.aniwatch = await syncAniWatchMappings();

    await keeper();
    results.franchises = await syncFranchiseRelations();

    await recordRun(OWNER, Date.now(), {
      status: 'success',
      ...results,
    });
    console.log('[sync-providers] 🎉 Multi-Provider Sync Completed successfully:', results);
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
