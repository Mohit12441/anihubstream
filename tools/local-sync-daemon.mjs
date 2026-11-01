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
import { existsSync, readdirSync } from 'node:fs';

import { autoSyncProviders } from './auto-sync-providers.mjs';
import { computeFranchiseGraph, persistRelations } from './auto-sync-franchises.mjs';
import { autoSyncEpisodes } from './auto-sync-episodes.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

function findSqlitePath() {
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
 * Stage 1: Synchronize ongoing broadcast schedules from AniList
 * @param {DatabaseSync} db
 * @param {boolean} quiet
 */
async function syncSchedulesStage(db, quiet) {
  const start = Date.now();
  if (!quiet) console.log('\n[Stage 1/4] 📅 Synchronizing Airing Schedules from AniList...');

  const rows = db.prepare(`
    SELECT a.id, m.anilist_id, a.sched_day, a.sched_time, a.sched_season, a.sched_episode
    FROM anime a
    LEFT JOIN anime_id_map m ON a.id = m.anime_id
    WHERE a.status IN ('Ongoing', 'Airing') AND m.anilist_id IS NOT NULL AND m.anilist_id > 0
    LIMIT 100
  `).all();

  if (rows.length === 0) {
    if (!quiet) console.log('  No ongoing anime requiring schedule updates.');
    return { updated: 0, durationMs: Date.now() - start };
  }

  const query = `
    query ($ids: [Int]) {
      Page(page: 1, perPage: 50) {
        media(id_in: $ids, type: ANIME) {
          id
          status
          nextAiringEpisode {
            airingAt
            episode
          }
        }
      }
    }
  `;

  let updatedCount = 0;
  const BATCH_SIZE = 40;
  const WEEK = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
  const updateStmt = db.prepare(`
    UPDATE anime
    SET sched_day = ?, sched_day_label = ?, sched_date = ?, sched_time = ?, sched_episode = ?
    WHERE id = ?
  `);

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const chunk = rows.slice(i, i + BATCH_SIZE);
    // @ts-ignore
    const idMap = new Map(chunk.map((r) => [r.anilist_id, r]));
    const ids = Array.from(idMap.keys());

    try {
      const res = await fetch('https://graphql.anilist.co', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'AniHubStream/1.0 LocalSync' },
        body: JSON.stringify({ query, variables: { ids } }),
        signal: AbortSignal.timeout(10000),
      });

      if (res.ok) {
        const data = await res.json();
        const mediaList = data?.data?.Page?.media || [];
        for (const item of mediaList) {
          const next = item.nextAiringEpisode;
          const anime = idMap.get(item.id);
          if (next?.airingAt && anime) {
            const airDate = new Date(next.airingAt * 1000);
            const dayIdx = (airDate.getUTCDay() + 6) % 7;
            const dayLabel = WEEK[dayIdx];
            const dateStr = airDate.toISOString().split('T')[0];
            const timeStr = airDate.toISOString().split('T')[1].slice(0, 5);

            updateStmt.run(dayIdx, dayLabel, dateStr, timeStr, next.episode, anime.id);
            updatedCount++;
          }
        }
      }
    } catch (err) {
      if (!quiet) console.warn('  Schedule batch fetch warning:', err?.message || err);
    }
    await sleep(600);
  }

  if (!quiet) console.log(`  ✓ Updated ${updatedCount} anime schedules in ${Date.now() - start}ms`);
  return { updated: updatedCount, durationMs: Date.now() - start };
}

/**
 * Stage 2: Normalize ratings and synchronize provider mappings
 * @param {boolean} quiet
 */
async function syncProvidersStage(quiet) {
  if (!quiet) console.log('\n[Stage 2/4] ⚡ Synchronizing Provider Slugs & Ratings (AniKoto, HiAnime, AniWatch)...');
  const res = await autoSyncProviders({ quiet });
  if (!quiet) {
    console.log(`  ✓ Active mappings: AniKoto=${res.providersActive.anikoto || 0}, HiAnime=${res.providersActive.hianime || 0}, AniWatch=${res.providersActive.aniwatch || 0}`);
  }
  return res;
}

/**
 * Stage 3: Recompute franchise relationship graphs
 * @param {DatabaseSync} db
 * @param {boolean} quiet
 */
async function syncFranchisesStage(db, quiet) {
  const start = Date.now();
  if (!quiet) console.log('\n[Stage 3/4] 🔗 Rebuilding Franchise Relations Graph...');

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
 * Stage 4: Sync episode titles and air dates
 * @param {boolean} quiet
 */
async function syncEpisodesStage(quiet) {
  if (!quiet) console.log('\n[Stage 4/4] 📺 Checking Newly Released Episode Metadata...');
  const res = await autoSyncEpisodes({ quiet });
  return res;
}

/**
 * Execute one full synchronization cycle across all 4 stages
 * @param {Object} [options]
 * @param {boolean} [options.quiet=false]
 */
export async function runSyncCycle({ quiet = false } = {}) {
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
    console.log('🔄 AniHubStream Local Autonomous Sync Cycle');
    console.log(`   Target DB: ${sqlitePath}`);
    console.log(`   Timestamp: ${new Date().toISOString()}`);
    console.log('====================================================');
  }

  const metrics = {
    startedAt: new Date().toISOString(),
    schedules: null,
    providers: null,
    franchises: null,
    episodes: null,
    durationMs: 0,
    ok: true,
  };

  try {
    metrics.schedules = await syncSchedulesStage(db, quiet).catch((e) => ({ error: e.message }));
    metrics.providers = await syncProvidersStage(quiet).catch((e) => ({ error: e.message }));
    metrics.franchises = await syncFranchisesStage(db, quiet).catch((e) => ({ error: e.message }));
    metrics.episodes = await syncEpisodesStage(quiet).catch((e) => ({ error: e.message }));
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
  
  const intervalArg = args.find((a) => a.startsWith('--interval='));
  const intervalMin = intervalArg ? Math.max(5, Number(intervalArg.split('=')[1]) || 30) : 30;
  const intervalMs = intervalMin * 60 * 1000;

  const delayArg = args.find((a) => a.startsWith('--delay='));
  const delaySec = delayArg ? Math.max(0, Number(delayArg.split('=')[1]) || 5) : 5;

  if (isOnce) {
    const res = await runSyncCycle({ quiet: isQuiet });
    process.exit(res.ok ? 0 : 1);
  }

  console.log(`[local-sync-daemon] Starting background daemon (Interval: ${intervalMin}m, Initial delay: ${delaySec}s)...`);
  if (delaySec > 0) {
    await sleep(delaySec * 1000);
  }

  // Initial immediate cycle
  await runSyncCycle({ quiet: isQuiet }).catch((err) => console.error('[local-sync-daemon] Initial cycle error:', err));

  // Recurring loop
  setInterval(async () => {
    try {
      await runSyncCycle({ quiet: isQuiet });
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
