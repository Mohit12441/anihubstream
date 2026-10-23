// @ts-check
/**
 * cloud-sync/sync-episodes.mjs
 *
 * Automated Cloud Episode Generator & Metadata Enricher:
 * 1. Scans ongoing anime and anime with missing episode rows in D1.
 * 2. Generates canonical episode shells (1..N) with proper id, runtime, and fallback art.
 * 3. Enriches episode titles, thumbnails, and airdates from Kitsu API.
 * 4. Ingests intro/outro skip markers from AniSkip API into episode.markers.
 * 5. Uses d1.mjs REST API to persist directly into remote Cloudflare D1.
 */

import { randomUUID } from 'node:crypto';
import { d1All, d1First, d1Query } from './d1.mjs';
import { acquireLease, leaseKeeper, recordRun, releaseLease } from './state.mjs';

const RUN_ID = randomUUID();
const LEASE = 'episodes';
const OWNER = `episodes-${RUN_ID}`;
const USER_AGENT = 'AniHubStream/1.0 (Episode Cloud Sync; https://anihubstream.pages.dev)';

const intEnv = (name, fallback) => {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be a positive integer, got ${raw}`);
  return n;
};

export const EPISODES_BATCH_LIMIT = intEnv('EPISODES_BATCH_LIMIT', 50);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fetch episode list from Kitsu
 */
export async function fetchKitsuEpisodes(kitsuId) {
  if (!kitsuId) return [];
  try {
    const res = await fetch(`https://kitsu.io/api/edge/episodes?filter[mediaId]=${kitsuId}&page[limit]=20&sort=number`, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/vnd.api+json' },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data?.data) ? data.data : [];
  } catch {
    return [];
  }
}

/**
 * Fetch AniSkip markers for MAL ID and Episode
 */
export async function fetchAniSkipMarkers(malId, ep) {
  if (!malId || malId <= 0) return [];
  try {
    const res = await fetch(`https://api.aniskip.com/v2/skip-times/${malId}/${ep}?types[]=op&types[]=ed&types[]=mixed-op&types[]=mixed-ed&types[]=recap&episodeLength=1440`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    if (!data?.found || !Array.isArray(data.results)) return [];

    const markers = [];
    for (const r of data.results) {
      const intv = r.interval;
      if (intv?.startTime != null && intv?.endTime != null) {
        const kind = r.skipType === 'recap' ? 'recap' : r.skipType.includes('op') ? 'intro' : 'outro';
        const label = r.skipType === 'recap' ? 'Recap' : r.skipType.includes('op') ? 'Opening' : 'Ending';
        markers.push({ kind, start: Math.round(intv.startTime), end: Math.round(intv.endTime), label });
      }
    }
    return markers;
  } catch {
    return [];
  }
}

/**
 * Executes one bounded episode synchronization pass
 */
export async function syncEpisodes({ limit = EPISODES_BATCH_LIMIT, force = false } = {}) {
  console.log(`[sync-episodes] Starting run ${RUN_ID} (budget: ${limit} episodes)...`);
  let leaseHeld = false;
  if (!force) {
    leaseHeld = await acquireLease(LEASE, OWNER);
    if (!leaseHeld) {
      console.warn(`[sync-episodes] Lease '${LEASE}' is held by another runner; exiting cleanly.`);
      return { status: 'skipped', reason: 'lease_held' };
    }
  }

  const keeper = leaseKeeper(LEASE, OWNER);
  let createdCount = 0;
  let enrichedCount = 0;

  try {
    await keeper();

    // 1. Find anime needing episode generation:
    // Prioritize ongoing anime, then recently added anime where episode count < episode_total
    const animeNeedingEps = await d1All(`
      SELECT a.id, a.title, a.kind, a.art, a.key_art, a.synopsis, a.source_ids, a.episode_total,
             (SELECT count(*) FROM episode e WHERE e.anime_id = a.id) as current_episodes
      FROM anime a
      WHERE COALESCE(a.episode_total, 1) > (SELECT count(*) FROM episode e WHERE e.anime_id = a.id)
      ORDER BY (CASE WHEN a.status = 'Ongoing' THEN 0 ELSE 1 END), a.rating DESC
      LIMIT 10
    `);

    console.log(`[sync-episodes] Found ${animeNeedingEps.length} candidate anime needing episode generation.`);

    for (const anime of animeNeedingEps) {
      if (createdCount >= limit) break;

      let sources = {};
      try {
        sources = typeof anime.source_ids === 'string' ? JSON.parse(anime.source_ids) : anime.source_ids || {};
      } catch {}

      const malId = Number(sources.mal) || null;
      const kitsuId = sources.kitsu || null;

      const targetTotal = Math.min(Math.max(anime.episode_total || 1, 1), 50);
      const startEp = (anime.current_episodes || 0) + 1;

      // Fetch Kitsu episodes for enrichment if available
      let kitsuEpisodes = [];
      if (kitsuId) {
        kitsuEpisodes = await fetchKitsuEpisodes(kitsuId);
      }

      for (let n = startEp; n <= targetTotal && createdCount < limit; n++) {
        await keeper();

        const epId = `${anime.id}#${n}`;
        let epTitle = `Episode ${n}`;
        if (targetTotal === 1 || anime.kind === 'Movie' || /movie/i.test(anime.title)) {
          epTitle = anime.title;
        }

        let thumb = anime.key_art || anime.art || '';
        let synopsis = anime.synopsis || '';
        let airdate = null;

        // Enrich from Kitsu if present
        const kMatch = kitsuEpisodes.find((ke) => Number(ke?.attributes?.number) === n);
        if (kMatch?.attributes) {
          const attr = kMatch.attributes;
          if (attr.canonicalTitle) epTitle = String(attr.canonicalTitle).trim();
          if (attr.thumbnail?.original) thumb = attr.thumbnail.original;
          if (attr.synopsis) synopsis = String(attr.synopsis).trim();
          if (attr.airdate) airdate = attr.airdate;
        }

        // Fetch AniSkip markers
        let markers = [];
        if (malId) {
          markers = await fetchAniSkipMarkers(malId, n);
          if (markers.length > 0) enrichedCount++;
        }

        const markersJson = JSON.stringify(markers);

        await d1Query(
          `INSERT INTO episode (
            id, anime_id, n, title, runtime, runtime_seconds, thumb, synopsis, markers, airdate, external_id
          ) VALUES (?1, ?2, ?3, ?4, '24m', 1440, ?5, ?6, ?7, ?8, 'cloud-sync')
          ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            thumb = COALESCE(NULLIF(excluded.thumb, ''), episode.thumb),
            synopsis = COALESCE(NULLIF(excluded.synopsis, ''), episode.synopsis),
            markers = CASE WHEN excluded.markers != '[]' THEN excluded.markers ELSE episode.markers END,
            airdate = COALESCE(excluded.airdate, episode.airdate)`,
          [epId, anime.id, n, epTitle, thumb, synopsis, markersJson, airdate]
        );

        createdCount++;
        await sleep(100);
      }
    }

    console.log(`[sync-episodes] ✅ Completed pass: Created/updated ${createdCount} episodes (${enrichedCount} with AniSkip markers).`);

    await recordRun(OWNER, Date.now(), {
      status: 'success',
      episodes_created: createdCount,
      markers_enriched: enrichedCount,
    });

    return { status: 'success', created: createdCount, enriched: enrichedCount };
  } catch (err) {
    console.error('[sync-episodes] Fatal error in episode sync:', err);
    await recordRun(OWNER, Date.now(), { status: 'error', error: err.message }).catch(() => null);
    throw err;
  } finally {
    if (leaseHeld) {
      await releaseLease(LEASE, OWNER).catch(() => null);
    }
  }
}

// CLI entry point
if (process.argv[1] && process.argv[1].endsWith('sync-episodes.mjs')) {
  syncEpisodes({ force: process.argv.includes('--force') })
    .then((res) => {
      console.log('Result:', res);
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
