// @ts-check
/**
 * tools/sync-episodes.mjs
 *
 * Universal Episode & Metadata Synchronizer (Kitsu Master Head):
 * 1. Synchronizes official episode metadata (canonical titles, synopses, thumbnails, runtimes)
 *    exclusively from Kitsu REST JSON:API with automatic multi-page traversal.
 * 2. Multi-tier artwork fallback (Kitsu original -> Kitsu medium -> key_art -> art).
 * 3. Pre-bakes official intro (OP) and outro (ED) skip markers from AniSkip API into `episode.markers`.
 * 4. Strictly protects against phantom episodes for Upcoming / unreleased shows.
 *
 * Runs locally against .wrangler/state/v3/d1/.../miniflare-D1DatabaseObject/*.sqlite or provided db.
 * 100% Free, Zero Web Scraping, Pure Community REST.
 */

import { DatabaseSync } from 'node:sqlite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findSqlitePath } from './discover-titles.mjs';

export { findSqlitePath };

let _db = null;
export function getDb() {
  if (_db) return _db;
  const sqlitePath = findSqlitePath();
  if (!sqlitePath) return null;
  _db = new DatabaseSync(sqlitePath);
  _db.exec('PRAGMA journal_mode = WAL;');
  _db.exec('PRAGMA busy_timeout = 15000;');
  return _db;
}

const USER_AGENT = 'AniHubStream/1.0 (Episode Synchronizer; https://anihubstream.com)';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fetch paginated episode list from Kitsu JSON:API
 * @param {number|string} kitsuId
 * @param {{ maxPages?: number, fetchFn?: typeof fetch, pageLimit?: number }} [options]
 */
export async function fetchEpisodesFromKitsu(kitsuId, { maxPages = 50, fetchFn = fetch, pageLimit = 20 } = {}) {
  if (!kitsuId) return [];

  const episodes = [];
  let offset = 0;
  let pageCount = 0;
  let hasMore = true;

  while (hasMore && pageCount < maxPages) {
    pageCount++;
    const url = `https://kitsu.io/api/edge/episodes?filter[mediaId]=${encodeURIComponent(kitsuId)}&page[limit]=${pageLimit}&page[offset]=${offset}&sort=number`;

    try {
      const res = await fetchFn(url, {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'application/vnd.api+json',
        },
        signal: AbortSignal.timeout(5000),
      });

      if (!res.ok) break;
      const data = await res.json();
      const list = Array.isArray(data?.data) ? data.data : [];
      if (list.length === 0) break;

      for (const item of list) {
        const num = Number(item.attributes?.number);
        if (!Number.isInteger(num) || num <= 0) continue;

        const canonicalTitle = (
          item.attributes?.canonicalTitle ||
          item.attributes?.titles?.en_us ||
          item.attributes?.titles?.en ||
          item.attributes?.titles?.ja_jp ||
          ''
        ).trim();

        const lengthMin = Number(item.attributes?.length) || 24;
        const thumb = item.attributes?.thumbnail?.original || item.attributes?.thumbnail?.medium || '';
        const synopsis = (item.attributes?.synopsis || '').trim();
        const airdate = item.attributes?.airdate || null;
        const externalId = item.id ? String(item.id) : null;

        episodes.push({
          num,
          title: canonicalTitle,
          synopsis,
          thumb,
          lengthMin,
          airdate,
          externalId,
        });
      }

      if (list.length < pageLimit || !data?.links?.next) {
        hasMore = false;
      } else {
        offset += list.length;
        if (pageCount < maxPages) {
          await sleep(150);
        }
      }
    } catch {
      break;
    }
  }

  // Deduplicate and sort monotonically by episode number
  const uniqueByNum = new Map();
  for (const ep of episodes) {
    if (!uniqueByNum.has(ep.num)) {
      uniqueByNum.set(ep.num, ep);
    }
  }

  return Array.from(uniqueByNum.values()).sort((a, b) => a.num - b.num);
}

/**
 * Fetch AniSkip markers for MAL ID and Episode number
 * @param {number|string} malId
 * @param {number} ep
 * @param {{ fetchFn?: typeof fetch }} [options]
 */
export async function fetchAniSkipMarkers(malId, ep, { fetchFn = fetch } = {}) {
  const numericMalId = Number(malId);
  if (!numericMalId || numericMalId <= 0 || !ep || ep <= 0) return [];

  try {
    const url = `https://api.aniskip.com/v2/skip-times/${numericMalId}/${ep}?types[]=op&types[]=ed&types[]=mixed-op&types[]=mixed-ed&types[]=recap&episodeLength=1440`;
    const res = await fetchFn(url, {
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
        const skipType = String(r.skipType || '').toLowerCase();
        const kind = skipType === 'recap' ? 'recap' : skipType.includes('op') ? 'intro' : 'outro';
        const label = skipType === 'recap' ? 'Recap' : skipType.includes('op') ? 'Opening' : 'Ending';
        markers.push({ kind, start: Math.round(intv.startTime), end: Math.round(intv.endTime), label });
      }
    }
    return markers;
  } catch {
    return [];
  }
}

/**
 * Synchronize episodes for a single anime title
 */
export async function syncAnime(anime, { dbInstance = null, skipAniSkip = false, quiet = false, fetchFn = fetch } = {}) {
  const db = dbInstance || getDb();
  if (!db) {
    throw new Error('Database not initialized for syncAnime.');
  }

  const isUpcoming = anime.status === 'Upcoming' || anime.status === 'NOT_YET_RELEASED';
  if (isUpcoming) {
    if (!quiet) console.log(`  ℹ Skipping upcoming anime [${anime.id}] (0 released episodes).`);
    return { synced: 0, kitsuCount: 0 };
  }

  if (!quiet) console.log(`\n► Syncing [${anime.id}]: "${anime.title}"`);
  const fallbackArt = anime.key_art || anime.art || '';
  const malId = anime.mal_id || anime.skip_key_id;

  // 1. Fetch canonical episodes from Kitsu
  let kitsuEps = [];
  if (anime.kitsu_id) {
    kitsuEps = await fetchEpisodesFromKitsu(anime.kitsu_id, { fetchFn });
    if (!quiet && kitsuEps.length > 0) {
      console.log(`  ✓ Kitsu: Found ${kitsuEps.length} catalog episodes`);
    }
  }

  const upsertEpisode = db.prepare(`
    INSERT INTO episode (
      id, anime_id, n, title, runtime, runtime_seconds, thumb, synopsis, markers, airdate, external_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(anime_id, n) DO UPDATE SET
      title = coalesce(nullif(excluded.title, ''), episode.title),
      runtime = excluded.runtime,
      runtime_seconds = excluded.runtime_seconds,
      thumb = case when episode.thumb = '' or episode.thumb is null then excluded.thumb else episode.thumb end,
      synopsis = coalesce(nullif(excluded.synopsis, ''), episode.synopsis),
      airdate = coalesce(nullif(excluded.airdate, ''), episode.airdate),
      markers = case when excluded.markers != '[]' then excluded.markers else episode.markers end,
      external_id = coalesce(excluded.external_id, episode.external_id)
  `);

  const isFinished = anime.status?.toLowerCase().includes('finish');
  const now = new Date();
  const kitsuAiredCount = kitsuEps.filter((k) => k.airdate && new Date(k.airdate) <= now).length;

  const totalCount = isFinished
    ? Math.max(anime.episode_total || 1, kitsuEps.length)
    : Math.max(1, Math.min(anime.episode_total || 2000, kitsuAiredCount || kitsuEps.length || 1));

  const plannedTotal = Math.max(anime.episode_total || 0, kitsuEps.length, totalCount);
  const kitsuByNum = new Map(kitsuEps.map((e) => [e.num, e]));

  db.exec('BEGIN TRANSACTION');
  try {
    for (let n = 1; n <= totalCount; n++) {
      const epId = `${anime.id}#${n}`;
      const kt = kitsuByNum.get(n);

      const canonicalTitle = (kt?.title || '').trim();
      let epTitle = `Episode ${n}`;
      if (canonicalTitle && canonicalTitle.toLowerCase() !== `episode ${n}`) {
        epTitle = canonicalTitle;
      }

      const lenMin = kt?.lengthMin || 24;
      const runtime = `${lenMin}:00`;
      const runtimeSeconds = lenMin * 60;

      const thumb = kt?.thumb || fallbackArt;
      const synopsis = kt?.synopsis || '';
      const airdate = kt?.airdate || null;
      const externalId = kt?.externalId || null;

      // AniSkip markers (up to first 12 episodes or aired limit)
      let markers = [];
      if (!skipAniSkip && malId && n <= Math.max(kitsuEps.length, 12)) {
        markers = await fetchAniSkipMarkers(malId, n, { fetchFn });
      }
      const markersStr = JSON.stringify(markers);

      upsertEpisode.run(
        epId,
        anime.id,
        n,
        epTitle,
        runtime,
        runtimeSeconds,
        thumb,
        synopsis,
        markersStr,
        airdate,
        externalId
      );
    }

    // Update anime total if newly discovered
    db.prepare(`
      UPDATE anime
      SET episode_total = max(coalesce(episode_total, 0), ?)
      WHERE id = ?
    `).run(plannedTotal, anime.id);

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  if (!quiet) {
    console.log(`  ✓ Synced ${totalCount} canonical episodes (${plannedTotal} planned total) for "${anime.title}"`);
  }

  return { synced: totalCount, kitsuCount: kitsuEps.length };
}

/**
 * Synchronize episodes across candidate anime in SQLite
 */
export async function syncEpisodes({ dbInstance = null, targetAnimeId = null, limit = 50, skipAniSkip = false, quiet = false, fetchFn = fetch } = {}) {
  const db = dbInstance || getDb();
  if (!db) {
    console.warn('[sync-episodes] SQLite database not found; skipping local episode sync.');
    return { candidatesCount: 0, syncedCount: 0 };
  }

  let candidates = [];
  if (targetAnimeId) {
    candidates = db.prepare(`
      SELECT a.id, a.title, a.art, a.key_art, a.episode_total, a.status, a.skip_key_id,
             m.kitsu_id, m.mal_id
      FROM anime a
      LEFT JOIN anime_id_map m ON m.anime_id = a.id
      WHERE a.id = ?
    `).all(targetAnimeId);
  } else {
    // Select ongoing or top anime needing episode sync, excluding upcoming
    candidates = db.prepare(`
      SELECT a.id, a.title, a.art, a.key_art, a.episode_total, a.status, a.skip_key_id,
             m.kitsu_id, m.mal_id
      FROM anime a
      LEFT JOIN anime_id_map m ON m.anime_id = a.id
      WHERE (m.kitsu_id IS NOT NULL OR a.skip_key_id IS NOT NULL OR m.mal_id IS NOT NULL)
        AND (a.status IS NULL OR a.status NOT IN ('Upcoming', 'NOT_YET_RELEASED'))
      ORDER BY (CASE WHEN a.status = 'Ongoing' THEN 0 ELSE 1 END), a.rating DESC
      LIMIT ?
    `).all(limit);
  }

  if (!quiet) console.log(`Found ${candidates.length} candidate anime to synchronize.`);

  let syncedCount = 0;
  for (let i = 0; i < candidates.length; i++) {
    const res = await syncAnime(candidates[i], { dbInstance: db, skipAniSkip, quiet, fetchFn });
    syncedCount += res.synced || 0;
    if (i < candidates.length - 1) {
      await sleep(100);
    }
  }

  return { candidatesCount: candidates.length, syncedCount };
}

async function main() {
  const args = process.argv.slice(2);
  const targetAnimeId = args.includes('--anime') ? args[args.indexOf('--anime') + 1] : null;
  const batchLimit = Number(args.includes('--limit') ? args[args.indexOf('--limit') + 1] : 50) || 50;
  const skipAniSkip = args.includes('--skip-aniskip');

  console.log('🚀 AniHubStream Universal Episode & Metadata Synchronizer (Kitsu Master Head)');
  const res = await syncEpisodes({ targetAnimeId, limit: batchLimit, skipAniSkip, quiet: false });

  const db = getDb();
  if (db) {
    const finalEpCount = db.prepare('SELECT count(1) as c FROM episode').get().c;
    const animeWithEpisodes = db.prepare('SELECT count(distinct anime_id) as c FROM episode').get().c;
    console.log(`\n========================================`);
    console.log(`✓ Synchronizer completed successfully!`);
    console.log(`Processed ${res.candidatesCount} anime (${res.syncedCount} episodes written).`);
    console.log(`Total episodes in database: ${finalEpCount} across ${animeWithEpisodes} anime.`);
    console.log(`========================================\n`);
  }
}

const isCli = process.argv[1] && (
  process.argv[1].endsWith('sync-episodes.mjs') ||
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
);

if (isCli) {
  main().catch((err) => {
    console.error('Fatal error during episode sync:', err);
    process.exit(1);
  });
}
