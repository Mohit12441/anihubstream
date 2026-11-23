// @ts-check
/**
 * tools/pulse-airing.mjs
 *
 * Lightweight, fast (~10s) hourly airing pulse for development:
 * 1. Refreshes next airing countdowns and schedules from AniList for ongoing anime.
 * 2. Checks and stamps newly released episode titles/metadata for airing shows.
 * 3. Enforces zero D1 write amplification — skips unchanged slots.
 *
 * Usage:
 *   npm run sync:pulse
 *   node tools/pulse-airing.mjs
 *   node tools/pulse-airing.mjs --remote
 */

import { syncTrendingRanks } from './sync-trending.mjs';
import { syncOngoingSchedules } from './sync-ongoing-schedules.mjs';
import { autoSyncEpisodes } from './auto-sync-episodes.mjs';

async function main() {
  const isRemote = process.argv.includes('--remote');
  // Trending ranks are enabled by default for remote D1 runs or when --trending is passed
  const includeTrending = process.argv.includes('--trending') || (isRemote && !process.argv.includes('--no-trending'));
  const start = Date.now();

  console.log('====================================================');
  console.log(`⏱️ AniHubStream Airing Pulse (Mode: ${isRemote ? 'Remote D1' : 'Local SQLite'}, Trending: ${includeTrending ? 'Enabled' : 'Skipped'})`);
  console.log('====================================================\n');

  // Stage 1: Global Trending Ranks (AniList GraphQL, runs daily via --trending)
  let trendRes = { totalTrending: 0 };
  if (includeTrending) {
    console.log('► Stage 1: Syncing global trending ranks from AniList (24h Daily Cadence)...');
    trendRes = await syncTrendingRanks({ isRemote, quiet: false });
  } else {
    console.log('► Stage 1: Skipped trending ranks (scheduled on 24-hour daily cadence; use --trending to force).');
  }

  // Stage 2: Airing schedule delta from AniList (~5s, hourly)
  console.log('\n► Stage 2: Checking broadcast airing slots (Hourly AniList Sync)...');
  const schedRes = await syncOngoingSchedules({ isRemote, quiet: false });

  // Stage 3: Newly released episodes delta (~10s)
  if (!isRemote) {
    console.log('\n► Stage 3: Checking newly released episodes...');
    const epRes = await autoSyncEpisodes({ limit: 20, quiet: false });
    console.log(`\n✓ Episode check complete: ${epRes.episodesUpdated} episodes updated.`);
  }

  const durationSec = ((Date.now() - start) / 1000).toFixed(1);
  console.log('\n====================================================');
  console.log(`✅ Hourly Airing Pulse finished in ${durationSec}s!`);
  console.log(`   - Trending shows ranked: ${trendRes.totalTrending || 0}`);
  console.log(`   - Schedules written: ${schedRes.updated}`);
  console.log(`   - Unchanged titles skipped: ${schedRes.unchanged}`);
  console.log('====================================================\n');
}

main().catch((err) => {
  console.error('Fatal error during hourly pulse:', err);
  process.exit(1);
});
