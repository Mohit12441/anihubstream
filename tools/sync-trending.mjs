// @ts-check
/**
 * tools/sync-trending.mjs
 *
 * Synchronizes AniList's global trending ranks (1..50) into the local or remote D1 database.
 * Matches incoming AniList IDs against anime_id_map and anime.source_ids.
 * Updates anime.trend_rank for matching titles and clears trend_rank for titles that fell off.
 */

import { DatabaseSync } from 'node:sqlite';
import { d1Query, d1All } from '../cloud-sync/d1.mjs';
import { findSqlitePath, wrangler } from './discover-titles.mjs';

export { findSqlitePath, wrangler };

const TRENDING_QUERY = `
  query($n: Int) {
    Page(page: 1, perPage: $n) {
      media(sort: TRENDING_DESC, type: ANIME, isAdult: false) {
        id
        title {
          romaji
          english
        }
      }
    }
  }
`;

/**
 * Fetch top trending anime from AniList GraphQL API
 * @param {number} [limit=50]
 * @returns {Promise<Array<{ id: number, title: { romaji?: string, english?: string } }>>}
 */
export async function fetchTrendingAniList(limit = 50) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch('https://graphql.anilist.co', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': 'AniHubStream/1.0 TrendingSync',
        },
        body: JSON.stringify({ query: TRENDING_QUERY, variables: { n: limit } }),
        signal: AbortSignal.timeout(15000),
      });

      if (res.status === 429) {
        const retryAfter = Number(res.headers.get('retry-after')) || 2;
        await new Promise((r) => setTimeout(r, retryAfter * 1000));
        continue;
      }

      if (!res.ok) {
        throw new Error(`AniList returned status ${res.status}`);
      }

      const data = await res.json();
      return data?.data?.Page?.media || [];
    } catch (err) {
      if (attempt === 3) {
        console.error('[sync-trending] Failed to fetch trending from AniList:', err.message);
        return [];
      }
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  return [];
}

/**
 * Synchronize trending ranks into D1 SQLite or remote REST API / wrangler CLI
 * @param {Object} [options]
 * @param {DatabaseSync} [options.db]
 * @param {boolean} [options.isRemote=false]
 * @param {number} [options.limit=50]
 * @param {boolean} [options.quiet=false]
 * @returns {Promise<{ ok: boolean, updated: number, cleared: number, totalTrending: number, durationMs: number }>}
 */
export async function syncTrendingRanks({ db = null, isRemote = process.argv.includes('--remote'), limit = 50, quiet = false } = {}) {
  const start = Date.now();
  const hasRestCreds = Boolean(process.env.CF_API_TOKEN && process.env.CF_ACCOUNT_ID && process.env.CF_DATABASE_ID);

  if (!db && !isRemote && !hasRestCreds) {
    const sqlitePath = findSqlitePath();
    if (!sqlitePath) {
      if (!quiet) console.error('[sync-trending] Local D1 SQLite database not found.');
      return { ok: false, updated: 0, cleared: 0, totalTrending: 0, durationMs: 0 };
    }
    db = new DatabaseSync(sqlitePath);
  }

  const trendingMedia = await fetchTrendingAniList(limit);
  if (!trendingMedia || trendingMedia.length === 0) {
    if (!quiet) console.warn('[sync-trending] No trending media returned from AniList.');
    return { ok: false, updated: 0, cleared: 0, totalTrending: 0, durationMs: Date.now() - start };
  }

  // Create map: anilistId -> rank (1-based)
  const rankMap = new Map();
  trendingMedia.forEach((m, idx) => {
    rankMap.set(m.id, idx + 1);
  });

  let updatedCount = 0;
  let clearedCount = 0;
  const rankedSlugs = new Set();

  if (db) {
    // 1. Fetch mapping of anilist_id to anime_id
    const idRows = db.prepare(`
      SELECT anime_id, anilist_id
      FROM anime_id_map
      WHERE anilist_id IS NOT NULL
      UNION
      SELECT id as anime_id, CAST(json_extract(source_ids, '$.anilist') AS INTEGER) as anilist_id
      FROM anime
      WHERE json_extract(source_ids, '$.anilist') IS NOT NULL
    `).all();

    const updateStmt = db.prepare('UPDATE anime SET trend_rank = ?1 WHERE id = ?2 AND (trend_rank IS NULL OR trend_rank != ?1)');

    for (const row of idRows) {
      // @ts-ignore
      const anilistId = Number(row.anilist_id);
      // @ts-ignore
      const animeId = String(row.anime_id);

      if (rankMap.has(anilistId)) {
        const rank = rankMap.get(anilistId);
        rankedSlugs.add(animeId);
        const res = updateStmt.run(rank, animeId);
        if (res.changes > 0) {
          updatedCount++;
        }
      }
    }

    // 2. Clear trend_rank for any anime that previously had a trend_rank but is no longer trending
    const currentTrending = db.prepare('SELECT id FROM anime WHERE trend_rank IS NOT NULL').all();
    const clearStmt = db.prepare('UPDATE anime SET trend_rank = NULL WHERE id = ?1');

    for (const row of currentTrending) {
      // @ts-ignore
      const id = String(row.id);
      if (!rankedSlugs.has(id)) {
        const res = clearStmt.run(id);
        if (res.changes > 0) {
          clearedCount++;
        }
      }
    }
  } else if (hasRestCreds) {
    const idRows = await d1All(`
      SELECT anime_id, anilist_id
      FROM anime_id_map
      WHERE anilist_id IS NOT NULL
      UNION
      SELECT id as anime_id, CAST(json_extract(source_ids, '$.anilist') AS INTEGER) as anilist_id
      FROM anime
      WHERE json_extract(source_ids, '$.anilist') IS NOT NULL
    `);

    const updates = [];
    for (const row of idRows) {
      const anilistId = Number(row.anilist_id);
      const animeId = String(row.anime_id);

      if (rankMap.has(anilistId)) {
        const rank = rankMap.get(anilistId);
        rankedSlugs.add(animeId);
        updates.push({ id: animeId, rank });
      }
    }

    // Batch update trend_ranks in chunks of 20 to minimize D1 REST roundtrips and avoid parameter limits
    const CHUNK = 20;
    for (let i = 0; i < updates.length; i += CHUNK) {
      const chunk = updates.slice(i, i + CHUNK);
      const cases = chunk.map((_, idx) => `WHEN ?${idx * 2 + 1} THEN ?${idx * 2 + 2}`).join(' ');
      const inList = chunk.map((_, idx) => `?${idx * 2 + 1}`).join(', ');
      const params = [];
      chunk.forEach((u) => {
        params.push(u.id, u.rank);
      });
      await d1Query(`UPDATE anime SET trend_rank = CASE id ${cases} END WHERE id IN (${inList})`, params);
      updatedCount += chunk.length;
    }

    // Clear stale trending ranks
    if (rankedSlugs.size > 0) {
      const placeholders = Array.from(rankedSlugs).map((_, idx) => `?${idx + 1}`).join(', ');
      await d1Query(`UPDATE anime SET trend_rank = NULL WHERE trend_rank IS NOT NULL AND id NOT IN (${placeholders})`, Array.from(rankedSlugs));
      clearedCount++;
    }
  } else if (isRemote) {
    // Remote D1 execution via wrangler CLI fallback
    const output = wrangler([
      'd1', 'execute', 'anihub', '--remote', '--json', '--command', `
        SELECT anime_id, anilist_id
        FROM anime_id_map
        WHERE anilist_id IS NOT NULL
        UNION
        SELECT id as anime_id, CAST(json_extract(source_ids, '$.anilist') AS INTEGER) as anilist_id
        FROM anime
        WHERE json_extract(source_ids, '$.anilist') IS NOT NULL
      `,
    ]);
    const parsed = JSON.parse(output);
    const idRows = parsed[0]?.results || [];

    const trendOutput = wrangler([
      'd1', 'execute', 'anihub', '--remote', '--json', '--command', `
        SELECT id FROM anime WHERE trend_rank IS NOT NULL
      `,
    ]);
    const trendParsed = JSON.parse(trendOutput);
    const currentTrending = trendParsed[0]?.results || [];

    const sqlEscape = (val) => `'${String(val).replace(/'/g, "''")}'`;
    const remoteSql = [];

    for (const row of idRows) {
      const anilistId = Number(row.anilist_id);
      const animeId = String(row.anime_id);

      if (rankMap.has(anilistId)) {
        const rank = rankMap.get(anilistId);
        rankedSlugs.add(animeId);
        remoteSql.push(`UPDATE anime SET trend_rank = ${rank} WHERE id = ${sqlEscape(animeId)} AND (trend_rank IS NULL OR trend_rank != ${rank});`);
        updatedCount++;
      }
    }

    for (const row of currentTrending) {
      const id = String(row.id);
      if (!rankedSlugs.has(id)) {
        remoteSql.push(`UPDATE anime SET trend_rank = NULL WHERE id = ${sqlEscape(id)};`);
        clearedCount++;
      }
    }

    if (remoteSql.length > 0) {
      const CHUNK = 50;
      for (let i = 0; i < remoteSql.length; i += CHUNK) {
        const batch = remoteSql.slice(i, i + CHUNK).join('\n');
        wrangler(['d1', 'execute', 'anihub', '--remote', '--command', batch]);
      }
    }
  }

  const durationMs = Date.now() - start;
  if (!quiet) {
    console.log(`[sync-trending] ✓ Trending sync complete: ${rankedSlugs.size} active ranked, ${updatedCount} updated, ${clearedCount} cleared in ${durationMs}ms`);
  }

  return {
    ok: true,
    updated: updatedCount,
    cleared: clearedCount,
    totalTrending: rankedSlugs.size,
    durationMs,
  };
}

// Direct CLI invocation
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  syncTrendingRanks({ quiet: false }).then((res) => {
    process.exit(res.ok ? 0 : 1);
  });
}
