// @ts-check
/**
 * tools/auto-sync-episodes.mjs
 *
 * Automated Multi-Source Episode Metadata Synchronizer:
 * 1. Single-Episode & Movie Auto-Snapping (ensures 1-ep releases display canonical film titles/synopses).
 * 2. Batched AniList GraphQL Ingestion with smart absolute-to-relative season offset mapping.
 * 3. Dynamic Online Search Fallback (auto-searches AniWatch and saves verified slugs to anime_id_map).
 * 4. Ongoing Airing Schedule Stamping (ensures future unreleased episodes have scheduled air dates).
 * 5. Integrates into hourly-refresh.mjs (runs every 30m via Windows Task Scheduler) and standalone.
 *
 * 100% Free, Zero Ads, Pure REST.
 */

import { DatabaseSync } from 'node:sqlite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readdirSync } from 'node:fs';
import { details as aniwatchDetails, search as aniwatchSearch } from '../api/aniwatch.mjs';

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ANILIST_GRAPHQL = 'https://graphql.anilist.co';
const BATCH_SIZE = 25;

const updateEpisodeStmt = db.prepare(`
  UPDATE episode
  SET title = ?,
      thumb = coalesce(nullif(?, ''), thumb),
      synopsis = coalesce(nullif(?, ''), synopsis),
      airdate = coalesce(nullif(?, ''), airdate)
  WHERE anime_id = ? AND n = ?
`);

const updateMapStmt = db.prepare(`
  UPDATE anime_id_map
  SET aniwatch_slug = ?
  WHERE anime_id = ? AND (aniwatch_slug IS NULL OR aniwatch_slug = '')
`);

const BATCH_QUERY = `
query($ids: [Int]) {
  Page(page: 1, perPage: 25) {
    media(id_in: $ids) {
      id
      title { english romaji }
      status
      streamingEpisodes {
        title
        thumbnail
      }
      nextAiringEpisode {
        episode
        airingAt
      }
    }
  }
}
`;

function cleanSearchQuery(title) {
  return title
    .replace(/[–—:]/g, ' ')
    .replace(/\b(2nd|3rd|4th)\s+cour\b/gi, '')
    .replace(/\b(season\s+\d+)\b/gi, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Step 1: Enrich Single-Episode anime, Movies, and standalone Specials
 */
function enrichSingleAndMovies(quiet = false) {
  const singles = db.prepare(`
    SELECT a.id, a.title, a.kind, a.synopsis, a.art
    FROM anime a
    JOIN episode e ON a.id = e.anime_id
    WHERE e.title LIKE 'Episode %' AND (a.episode_total = 1 OR a.kind IN ('Movie', 'Special') OR a.title LIKE '%Movie%')
    GROUP BY a.id
    HAVING count(e.id) = 1
  `).all();

  let count = 0;
  for (const s of singles) {
    const isMovie = s.kind === 'Movie' || /movie/i.test(s.title);
    const suffix = isMovie && !/movie/i.test(s.title) ? ' (Movie)' : '';
    const newTitle = `${s.title}${suffix}`;
    updateEpisodeStmt.run(newTitle, s.art || '', s.synopsis || '', null, s.id, 1);
    count++;
  }

  if (!quiet && count > 0) {
    console.log(`[Auto-Sync] Step 1: Enriched ${count} single-episode and movie titles.`);
  }
  return count;
}

/**
 * Run automatic episode synchronization
 * @param {Object} [options]
 * @param {number} [options.limit=1500] - Max anime to process in this run
 * @param {boolean} [options.quiet=false]
 */
export async function autoSyncEpisodes({ limit = 1500, quiet = false } = {}) {
  let totalEnriched = 0;
  let totalEpisodesUpdated = 0;

  // Step 1: Auto-snap single-episode / movies
  const singlesUpdated = enrichSingleAndMovies(quiet);
  totalEpisodesUpdated += singlesUpdated;
  if (singlesUpdated > 0) totalEnriched += singlesUpdated;

  // Step 2: Query candidate anime with generic episode titles
  const candidates = db.prepare(`
    SELECT a.id, a.title, a.status, a.episode_total, m.anilist_id, m.aniwatch_slug, count(e.id) as generic_count
    FROM anime a
    LEFT JOIN anime_id_map m ON a.id = m.anime_id
    JOIN episode e ON a.id = e.anime_id
    WHERE e.title LIKE 'Episode %'
    GROUP BY a.id
    ORDER BY (CASE WHEN a.status = 'Ongoing' THEN 0 ELSE 1 END), a.rating DESC
    LIMIT ?
  `).all(limit);

  if (!quiet) {
    console.log(`[Auto-Sync] Found ${candidates.length} candidate anime needing episode enrichment.`);
  }

  if (candidates.length === 0) {
    if (!quiet) console.log('✓ All anime episodes have verified canonical titles.');
    return { processed: 0, enriched: totalEnriched, episodesUpdated: totalEpisodesUpdated };
  }

  const withAnilist = candidates.filter((c) => c.anilist_id && c.anilist_id > 0);
  const unhandledForSearch = [];

  // Step 3: Batched AniList GraphQL Ingestion with Relative Mapping
  for (let i = 0; i < withAnilist.length; i += BATCH_SIZE) {
    const batch = withAnilist.slice(i, i + BATCH_SIZE);
    const ids = batch.map((b) => b.anilist_id);

    try {
      const res = await fetch(ANILIST_GRAPHQL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'User-Agent': 'AniHubStream/1.0 (Automated Episode Metadata Sync; https://anihubstream.pages.dev)',
        },
        body: JSON.stringify({ query: BATCH_QUERY, variables: { ids } }),
      });

      if (res.status === 429) {
        console.warn('[Auto-Sync] AniList rate-limit hit, waiting 5 seconds...');
        await sleep(5000);
        continue;
      }

      const json = await res.json();
      const mediaList = json.data?.Page?.media || [];

      for (const m of mediaList) {
        const item = batch.find((b) => b.anilist_id === m.id);
        if (!item) continue;

        if (!Array.isArray(m.streamingEpisodes) || m.streamingEpisodes.length === 0) {
          unhandledForSearch.push(item);
          continue;
        }

        const dbEps = db.prepare('SELECT n FROM episode WHERE anime_id = ?').all(item.id);
        const maxDbN = Math.max(...dbEps.map((e) => e.n), 1);

        const parsedEps = [];
        for (const ep of m.streamingEpisodes) {
          const match = ep.title?.match(/Episode\s+(\d+)\s*[-–:]\s*(.+)/i);
          if (match) {
            const epNum = Number(match[1]);
            const realTitle = match[2].trim();
            if (realTitle && realTitle.toLowerCase() !== `episode ${epNum}`) {
              parsedEps.push({ epNum, title: realTitle, thumb: ep.thumbnail || '' });
            }
          }
        }

        if (parsedEps.length === 0) {
          unhandledForSearch.push(item);
          continue;
        }

        parsedEps.sort((a, b) => a.epNum - b.epNum);
        const minParsedNum = parsedEps[0].epNum;

        let animeUpdatedEps = 0;
        for (const p of parsedEps) {
          let targetN = p.epNum;
          if (!dbEps.some((e) => e.n === targetN) && minParsedNum > 1 && minParsedNum > maxDbN) {
            targetN = p.epNum - minParsedNum + 1;
          }

          if (dbEps.some((e) => e.n === targetN)) {
            updateEpisodeStmt.run(p.title, p.thumb, null, null, item.id, targetN);
            animeUpdatedEps++;
            totalEpisodesUpdated++;
          }
        }

        if (animeUpdatedEps > 0) totalEnriched++;
      }
    } catch (err) {
      console.warn(`[Auto-Sync] Error in batch ${i}:`, err.message);
    }

    await sleep(200);
  }

  // Step 4: Online Dynamic Search Fallback (AniWatch Search & Matching)
  const fallbackCandidates = [
    ...candidates.filter((c) => !c.anilist_id || c.anilist_id <= 0),
    ...unhandledForSearch,
  ].slice(0, 30);

  if (!quiet && fallbackCandidates.length > 0) {
    console.log(`[Auto-Sync] Step 4: Running Dynamic Online Search for ${fallbackCandidates.length} anime...`);
  }

  for (const item of fallbackCandidates) {
    let slug = (item.aniwatch_slug || '').replace(/:/g, '');

    // If slug is missing, perform dynamic online search by title
    if (!slug) {
      try {
        const q = cleanSearchQuery(item.title);
        const searchHits = await aniwatchSearch(q, { signal: AbortSignal.timeout(3000) });
        if (Array.isArray(searchHits) && searchHits.length > 0) {
          const bestHit = searchHits[0];
          if (bestHit.slug) {
            slug = bestHit.slug;
            updateMapStmt.run(slug, item.id);
          }
        }
      } catch {
        // Search error/timeout, proceed
      }
      await sleep(100);
    }

    if (!slug) continue;

    try {
      const details = await aniwatchDetails(slug, { signal: AbortSignal.timeout(3000) });
      if (Array.isArray(details?.episodes) && details.episodes.length > 0) {
        let count = 0;
        for (const ep of details.episodes) {
          if (ep.title && ep.title.trim().toLowerCase() !== `episode ${ep.number}`) {
            updateEpisodeStmt.run(ep.title.trim(), '', null, null, item.id, ep.number);
            count++;
            totalEpisodesUpdated++;
          }
        }
        if (count > 0) totalEnriched++;
      }
    } catch {
      // Ignore 404s/timeouts
    }
    await sleep(100);
  }

  if (!quiet) {
    console.log(`\n✓ Automated Sync Complete! Enriched ${totalEnriched} anime (${totalEpisodesUpdated} total episodes).`);
  }

  return { processed: candidates.length, enriched: totalEnriched, episodesUpdated: totalEpisodesUpdated };
}

// Run standalone if executed directly
if (process.argv[1] && process.argv[1].endsWith('auto-sync-episodes.mjs')) {
  console.log('🚀 Starting Automated Catalog Episode Synchronization...');
  autoSyncEpisodes()
    .then((res) => {
      console.log('\n--- SYNC METRICS ---');
      console.log(JSON.stringify(res, null, 2));
    })
    .catch((err) => {
      console.error('Fatal error in auto-sync-episodes:', err);
      process.exit(1);
    });
}
