#!/usr/bin/env node
// @ts-check
/**
 * tools/local-sync-daemon.mjs
 *
 * Local Autonomous Synchronization Daemon for AniHubStream.
 * Orchestrates multi-provider catalog synchronization directly against the local
 * Miniflare D1 SQLite database without requiring remote Cloudflare API tokens:
 *
 *   Stage 1: Ongoing Broadcast Schedules (AniList)
 *   Stage 2: Provider Mappings & 10-Point Rating Normalization (AniKoto, HiAnime, AniWatch)
 *   Stage 3: Bidirectional Franchise Relations Graph (Sequels, Prequels, Movies)
 *   Stage 4: Episode Metadata, Synopses & Air Dates (Multi-source)
 *
 * Usage:
 *   node tools/local-sync-daemon.mjs --once          # Run a single sync pass and exit
 *   node tools/local-sync-daemon.mjs                # Run as continuous background daemon (every 30m)
 *   node tools/local-sync-daemon.mjs --interval=15  # Run every 15 minutes
 */

import { DatabaseSync } from 'node:sqlite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

import { syncOngoingSchedules } from './sync-ongoing-schedules.mjs';
import { syncTrendingRanks } from './sync-trending.mjs';
import { autoSyncProviders } from './auto-sync-providers.mjs';
import { computeFranchiseGraph, persistRelations } from './auto-sync-franchises.mjs';
import { autoSyncEpisodes } from './auto-sync-episodes.mjs';
import { discover } from './discover-titles.mjs';
import { probeTrendingStreams } from './probe-trending-streams.mjs';
import { syncAnimeToMeilisearch } from './meilisearch/sync-meilisearch.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function findSqlitePath() {
  const d1Dir = resolve(__dirname, '../.wrangler/state/v3/d1/miniflare-D1DatabaseObject');
  if (existsSync(d1Dir)) {
    const files = readdirSync(d1Dir).filter((f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite');
    if (files.length > 0) return resolve(d1Dir, files[0]);
  }
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Record sync heartbeat in D1 sync_meta table
 * @param {DatabaseSync} db
 * @param {Object} summary
 */
function recordHeartbeat(db, summary) {
  try {
    db.prepare(`
      INSERT OR REPLACE INTO sync_meta (key, value)
      VALUES ('local_sync_daemon', ?)
    `).run(JSON.stringify(summary));
  } catch {
    // sync_meta table optional
  }
}

/**
 * Stage 1: Synchronize trending ranks from AniList
 * @param {DatabaseSync} db
 * @param {boolean} quiet
 */
async function syncTrendingStage(db, quiet) {
  if (!quiet) console.log('\n[Stage 1/6] 🔥 Synchronizing Trending Ranks from AniList...');
  const res = await syncTrendingRanks({ db, limit: 50, quiet });
  return res;
}

/**
 * Stage 2: Synchronize ongoing broadcast schedules from AniList
 * @param {boolean} quiet
 */
async function syncSchedulesStage(quiet) {
  if (!quiet) console.log('\n[Stage 2/6] 📅 Synchronizing Airing Schedules from AniList...');
  const res = await syncOngoingSchedules({ isRemote: false, quiet: true });
  if (!quiet) {
    console.log(`  ✓ Updated ${res.updated} anime schedules (cleared ${res.cleared}, unchanged ${res.unchanged}) in ${res.durationMs}ms`);
  }
  return res;
}

/**
 * Stage 3: Normalize ratings and synchronize provider mappings
 * @param {boolean} quiet
 */
async function syncProvidersStage(quiet) {
  if (!quiet) console.log('\n[Stage 3/6] ⚡ Synchronizing Provider Slugs & Ratings (AniKoto, HiAnime, AniWatch)...');
  const res = await autoSyncProviders({ quiet });
  if (!quiet) {
    console.log(`  ✓ Active mappings: AniKoto=${res.providersActive.anikoto || 0}, HiAnime=${res.providersActive.hianime || 0}, AniWatch=${res.providersActive.aniwatch || 0}`);
  }
  return res;
}

/**
 * Stage 4: Recompute franchise relationship graphs
 * @param {DatabaseSync} db
 * @param {boolean} quiet
 */
async function syncFranchisesStage(db, quiet) {
  const start = Date.now();
  if (!quiet) console.log('\n[Stage 4/6] 🔗 Rebuilding Franchise Relations Graph...');

  const rows = db.prepare(`
    SELECT id, title, native, year, rating, season, kind, status, rank, alt_seasons, source_ids
    FROM anime
  `).all();

  const relations = computeFranchiseGraph(rows);
  if (relations.length > 0) {
    persistRelations(db, relations);
  }

  if (!quiet) console.log(`  ✓ Indexed ${relations.length} franchise links in ${Date.now() - start}ms`);
  return { relations: relations.length, durationMs: Date.now() - start };
}

/**
 * Stage 5: Sync episode titles and air dates
 * @param {boolean} quiet
 */
async function syncEpisodesStage(quiet) {
  if (!quiet) console.log('\n[Stage 5/6] 📺 Checking Newly Released Episode Metadata...');
  const res = await autoSyncEpisodes({ quiet });
  return res;
}

/**
 * Stage 6: Ingest new catalog titles from sources backlog or AniList discovery
 * @param {DatabaseSync} db
 * @param {boolean} quiet
 * @param {number} batchSize
 */
async function syncGrowthStage(db, quiet, batchSize = 3) {
  if (batchSize <= 0) return { added: 0, skipped: 'disabled' };
  const start = Date.now();
  if (!quiet) console.log('\n[Stage 6/6] 🌱 Expanding Catalog (Backlog & Discovery)...');

  const sourcesPath = resolve(__dirname, 'catalogue-sources.json');
  if (!existsSync(sourcesPath)) {
    return { added: 0, error: 'sources_missing' };
  }

  const sources = JSON.parse(readFileSync(sourcesPath, 'utf8'));
  const dbIds = new Set(db.prepare('SELECT id FROM anime').all().map((r) => r.id));
  const missing = sources.filter((s) => !dbIds.has(s.id) && s.kitsu && s.anilist);

  let addedCount = 0;
  const toIngest = missing.slice(0, batchSize);

  if (toIngest.length > 0) {
    for (const item of toIngest) {
      try {
        if (!quiet) console.log(`  -> Ingesting new title: ${item.id} (Kitsu: ${item.kitsu}, AniList: ${item.anilist})...`);
        execFileSync(
          process.execPath,
          [resolve(__dirname, 'sync-catalogue.mjs'), `--title=${item.id}`, '--no-skips'],
          { encoding: 'utf8', windowsHide: true, cwd: resolve(__dirname, '..') }
        );

        const seedPath = resolve(__dirname, '../seed.sql');
        if (existsSync(seedPath)) {
          const sql = readFileSync(seedPath, 'utf8');
          db.exec(sql);
          addedCount++;

          // Populate anime_id_map record for new title
          try {
            db.prepare(`
              INSERT INTO anime_id_map (anime_id, mal_id, anilist_id, kitsu_id, anikoto_slug, hianime_slug, aniwatch_slug, adb_slug, waw_slug, confidence, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
              ON CONFLICT(anime_id) DO UPDATE SET
                mal_id = coalesce(excluded.mal_id, anime_id_map.mal_id),
                anilist_id = coalesce(excluded.anilist_id, anime_id_map.anilist_id),
                kitsu_id = coalesce(excluded.kitsu_id, anime_id_map.kitsu_id),
                updated_at = datetime('now')
            `).run(
              item.id,
              item.mal ?? null,
              item.anilist ?? null,
              item.kitsu ?? null,
              item.anikoto ?? null,
              item.hianime ?? null,
              item.aniwatch ?? null,
              item.adb ?? null,
              item.waw ?? null,
              item.mal ? 1.0 : (item.anilist && item.kitsu ? 1.0 : 0.85)
            );
          } catch {}
        }
      } catch (err) {
        if (!quiet) console.warn(`  Warning: failed to ingest ${item.id}:`, err?.message || err);
      }
    }
  } else {
    // If backlog is completely caught up, check for new trending releases from AniList!
    try {
      if (!quiet) console.log('  Backlog caught up. Checking AniList for new trending releases...');
      const d = await discover({ limit: Math.min(batchSize, 2), force: false });
      addedCount = d.added?.length || 0;
    } catch (err) {
      if (!quiet) console.warn('  Discovery warning:', err?.message || err);
    }
  }

  const currentTotal = db.prepare('SELECT count(*) as c FROM anime').get().c;
  if (!quiet) {
    console.log(`  ✓ Catalog expansion complete: +${addedCount} new titles (Current Total: ${currentTotal}, Remaining Backlog: ${Math.max(0, missing.length - addedCount)}) in ${Date.now() - start}ms`);
  }

  return {
    added: addedCount,
    remainingBacklog: Math.max(0, missing.length - addedCount),
    currentTotal,
    durationMs: Date.now() - start,
  };
}

/**
 * Stage 7: Proactive stream health check & provider availability probe
 * @param {DatabaseSync} db
 * @param {boolean} quiet
 */
async function syncHealthStage(db, quiet) {
  if (!quiet) console.log('\n[Stage 7/7] 🩺 Probing Stream Health & Upstream Availability...');
  const res = await probeTrendingStreams({ limit: 10, silent: quiet });
  if (db && res.ok !== undefined) {
    try {
      db.prepare(`
        INSERT OR REPLACE INTO sync_meta (key, value)
        VALUES ('stream_health', ?)
      `).run(JSON.stringify(res));
    } catch {}
  }
  if (!quiet) {
    console.log(`  ✓ Stream Health: ${res.streamableCount} streamable, ${res.skippedCount} skipped, ${res.failedCount} failed`);
  }
  return res;
}

/**
 * Stage 8: Real-time search engine synchronization (Meilisearch)
 * @param {DatabaseSync} db
 * @param {boolean} quiet
 */
async function syncSearchStage(db, quiet) {
  if (!quiet) console.log('\n[Stage 8/8] 🔍 Checking Search Engine Index (Meilisearch)...');
  const res = await syncAnimeToMeilisearch({ db, silent: quiet });
  if (db) {
    try {
      db.prepare(`
        INSERT OR REPLACE INTO sync_meta (key, value)
        VALUES ('search_engine', ?)
      `).run(JSON.stringify({
        updatedAt: new Date().toISOString(),
        engine: res.ok ? 'meilisearch' : 'd1_fallback',
        status: res.status,
        synced: res.synced || 0,
      }));
    } catch {}
  }
  if (!quiet) {
    if (res.ok) {
      console.log(`  ✓ Search Engine: Meilisearch updated with ${res.synced} documents`);
    } else {
      console.log(`  ✓ Search Engine: D1 SQLite FTS5/LIKE fallback active (Meilisearch offline)`);
    }
  }
  return res;
}

/**
 * Execute one full synchronization cycle across all 5 stages
 * @param {Object} [options]
 * @param {boolean} [options.quiet=false]
 * @param {number} [options.expand=3]
 * @param {string|null} [options.stage=null]
 */
export async function runSyncCycle({ quiet = false, expand = 3, stage = null } = {}) {
  const cycleStart = Date.now();
  const sqlitePath = findSqlitePath();

  if (!sqlitePath) {
    console.error('[local-sync] Local D1 SQLite database not found in .wrangler/state/v3/d1');
    return { ok: false, error: 'database_not_found' };
  }

  const db = new DatabaseSync(sqlitePath);
  db.exec('PRAGMA busy_timeout = 15000;');

  if (!quiet) {
    console.log('====================================================');
    console.log(`🔄 AniHubStream Local Autonomous Sync Cycle ${stage ? `[Stage: ${stage}]` : ''}`);
    console.log(`   Target DB: ${sqlitePath}`);
    console.log(`   Timestamp: ${new Date().toISOString()}`);
    console.log('====================================================');
  }

  const metrics = {
    startedAt: new Date().toISOString(),
    trending: null,
    schedules: null,
    providers: null,
    franchises: null,
    episodes: null,
    growth: null,
    health: null,
    search: null,
    durationMs: 0,
    ok: true,
  };

  try {
    if (!stage || stage === 'trending') {
      metrics.trending = await syncTrendingStage(db, quiet).catch((e) => ({ error: e.message }));
    }
    if (!stage || stage === 'schedules') {
      metrics.schedules = await syncSchedulesStage(quiet).catch((e) => ({ error: e.message }));
    }
    if (!stage || stage === 'providers') {
      metrics.providers = await syncProvidersStage(quiet).catch((e) => ({ error: e.message }));
    }
    if (!stage || stage === 'franchises') {
      metrics.franchises = await syncFranchisesStage(db, quiet).catch((e) => ({ error: e.message }));
    }
    if (!stage || stage === 'episodes') {
      metrics.episodes = await syncEpisodesStage(quiet).catch((e) => ({ error: e.message }));
    }
    if (!stage || stage === 'growth') {
      metrics.growth = await syncGrowthStage(db, quiet, expand).catch((e) => ({ error: e.message }));
    }
    if (!stage || stage === 'health') {
      metrics.health = await syncHealthStage(db, quiet).catch((e) => ({ error: e.message }));
    }
    if (!stage || stage === 'search') {
      metrics.search = await syncSearchStage(db, quiet).catch((e) => ({ error: e.message }));
    }
  } catch (err) {
    metrics.ok = false;
    console.error('[local-sync] Cycle error:', err);
  } finally {
    metrics.durationMs = Date.now() - cycleStart;
    recordHeartbeat(db, metrics);
  }

  if (!quiet) {
    console.log('\n====================================================');
    console.log(`✅ Local Sync Cycle Complete in ${metrics.durationMs}ms`);
    console.log('====================================================\n');
  }

  return metrics;
}

// ----------------------------------------------------
// CLI & Daemon Runner
// ----------------------------------------------------
async function main() {
  const args = process.argv.slice(2);
  const isOnce = args.includes('--once');
  const isQuiet = args.includes('--quiet');
  
  const isGrowthOnly = args.includes('--growth-only');
  const stageArg = args.find((a) => a.startsWith('--stage='));
  const stage = isGrowthOnly ? 'growth' : (stageArg ? stageArg.split('=')[1] : null);

  const intervalArg = args.find((a) => a.startsWith('--interval='));
  const intervalMin = intervalArg ? Math.max(5, Number(intervalArg.split('=')[1]) || 30) : 30;
  const intervalMs = intervalMin * 60 * 1000;

  const delayArg = args.find((a) => a.startsWith('--delay='));
  const delaySec = delayArg ? Math.max(0, Number(delayArg.split('=')[1]) || 5) : 5;

  const expandArg = args.find((a) => a.startsWith('--expand='));
  const expand = expandArg ? Number(expandArg.split('=')[1]) : 3;

  if (isOnce) {
    const res = await runSyncCycle({ quiet: isQuiet, expand, stage });
    process.exit(res.ok ? 0 : 1);
  }

  console.log(`[local-sync-daemon] Starting background daemon (Interval: ${intervalMin}m, Initial delay: ${delaySec}s, Growth batch: ${expand}${stage ? `, Stage: ${stage}` : ''})...`);
  if (delaySec > 0) {
    await sleep(delaySec * 1000);
  }

  // Initial immediate cycle
  await runSyncCycle({ quiet: isQuiet, expand, stage }).catch((err) => console.error('[local-sync-daemon] Initial cycle error:', err));

  // Recurring loop
  setInterval(async () => {
    try {
      await runSyncCycle({ quiet: isQuiet, expand, stage });
    } catch (err) {
      console.error('[local-sync-daemon] Interval cycle error:', err);
    }
  }, intervalMs);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  main().catch((err) => {
    console.error('Fatal in local-sync-daemon:', err);
    process.exit(1);
  });
}
