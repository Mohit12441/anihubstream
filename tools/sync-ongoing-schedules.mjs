// @ts-check
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { seasonKey } from './season.mjs';

const isRemote = process.argv.includes('--remote');
const WEEK = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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

async function fetchAiringBatch(ids) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch('https://graphql.anilist.co', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'AniHubStream/1.0 ScheduleSync' },
        body: JSON.stringify({ query, variables: { ids } }),
        signal: AbortSignal.timeout(15000),
      });
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get('retry-after')) || 2;
        await new Promise((r) => setTimeout(r, retryAfter * 1000));
        continue;
      }
      if (!res.ok) return [];
      const data = await res.json();
      return data?.data?.Page?.media || [];
    } catch (e) {
      if (attempt === 3) {
        console.error('Fetch error:', e.message);
        return [];
      }
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  return [];
}

const sqlEscape = (val) => `'${String(val).replace(/'/g, "''")}'`;

async function main() {
  console.log(`🚀 Synchronizing Daily Broadcast Schedules (Mode: ${isRemote ? 'Remote D1' : 'Local SQLite'})...\n`);

  let db = null;
  /** @type {Array<{ id: string, anilist_id: number }>} */
  let ongoingRows = [];

  if (!isRemote) {
    const D1_DIR = './.wrangler/state/v3/d1/miniflare-D1DatabaseObject';
    if (!fs.existsSync(D1_DIR)) {
      throw new Error(`Local D1 directory not found: ${D1_DIR}`);
    }
    const files = fs.readdirSync(D1_DIR).filter((f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite');
    if (!files.length) throw new Error('No local D1 sqlite file found.');
    const dbPath = path.join(D1_DIR, files[0]);
    console.log('Target Database:', dbPath);
    db = new DatabaseSync(dbPath);

    // 1. Clean up any finished / non-ongoing anime lingering on schedule
    const cleaned = db.prepare(`
      UPDATE anime SET
        sched_day = NULL,
        sched_day_label = NULL,
        sched_date = NULL,
        sched_time = NULL,
        sched_season = NULL
      WHERE sched_day IS NOT NULL AND status IN ('Finished', 'Cancelled', 'Upcoming')
    `).run();
    if (cleaned.changes > 0) {
      console.log(`🧹 Cleaned up ${cleaned.changes} stale schedule slots for non-ongoing anime.`);
    }

    // 2. Query ongoing anime with AniList IDs from either anime_id_map or source_ids
    // @ts-ignore
    ongoingRows = db.prepare(`
      SELECT DISTINCT a.id,
        COALESCE(m.anilist_id, CAST(json_extract(a.source_ids, '$.anilist') AS INTEGER)) as anilist_id
      FROM anime a
      LEFT JOIN anime_id_map m ON a.id = m.anime_id
      WHERE a.status = 'Ongoing'
        AND COALESCE(m.anilist_id, CAST(json_extract(a.source_ids, '$.anilist') AS INTEGER)) IS NOT NULL
    `).all();
  } else {
    // Remote D1 mode: fetch ongoing titles using wrangler
    const output = execFileSync(
      process.platform === 'win32' ? 'npx.cmd' : 'npx',
      ['wrangler', 'd1', 'execute', 'anihub', '--remote', '--json', '--command', `
        SELECT DISTINCT a.id,
          COALESCE(m.anilist_id, CAST(json_extract(a.source_ids, '$.anilist') AS INTEGER)) as anilist_id
        FROM anime a
        LEFT JOIN anime_id_map m ON a.id = m.anime_id
        WHERE a.status = 'Ongoing'
          AND COALESCE(m.anilist_id, CAST(json_extract(a.source_ids, '$.anilist') AS INTEGER)) IS NOT NULL
      `],
      { encoding: 'utf8', windowsHide: true },
    );
    const parsed = JSON.parse(output);
    ongoingRows = parsed[0]?.results || [];
  }

  console.log(`Found ${ongoingRows.length} ongoing anime with AniList IDs.`);

  let updatedCount = 0;
  let clearedCount = 0;
  const BATCH_SIZE = 40;
  const remoteSqlStatements = [];

  for (let i = 0; i < ongoingRows.length; i += BATCH_SIZE) {
    const chunk = ongoingRows.slice(i, i + BATCH_SIZE);
    const idToSlug = new Map(chunk.map((r) => [r.anilist_id, r.id]));
    const ids = chunk.map((r) => r.anilist_id);

    const mediaList = await fetchAiringBatch(ids);
    const returnedAnilistIds = new Set();

    for (const m of mediaList) {
      returnedAnilistIds.add(m.id);
      const animeSlug = idToSlug.get(m.id);
      if (!animeSlug) continue;

      if (m.nextAiringEpisode?.airingAt) {
        const d = new Date(m.nextAiringEpisode.airingAt * 1000);
        const dayIdx = d.getUTCDay(); // 0 is Sunday
        const schedDay = dayIdx === 0 ? 7 : dayIdx; // 1=Mon ... 7=Sun
        const dayLabel = WEEK[schedDay - 1];
        const dateStr = `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
        const hours = String(d.getUTCHours()).padStart(2, '0');
        const mins = String(d.getUTCMinutes()).padStart(2, '0');
        const timeStr = `${hours}:${mins}`;
        const sKey = seasonKey(d);

        if (db) {
          db.prepare(`
            UPDATE anime SET
              sched_day = ?1,
              sched_day_label = ?2,
              sched_date = ?3,
              sched_time = ?4,
              sched_season = ?5
            WHERE id = ?6
          `).run(schedDay, dayLabel, dateStr, timeStr, sKey, animeSlug);
        } else {
          remoteSqlStatements.push(
            `UPDATE anime SET sched_day=${schedDay}, sched_day_label=${sqlEscape(dayLabel)}, sched_date=${sqlEscape(dateStr)}, sched_time=${sqlEscape(timeStr)}, sched_season=${sqlEscape(sKey)} WHERE id=${sqlEscape(animeSlug)};`
          );
        }
        updatedCount++;
      } else {
        // Anime has no active upcoming episode on AniList -> Clear schedule slot
        if (db) {
          db.prepare(`
            UPDATE anime SET
              sched_day = NULL,
              sched_day_label = NULL,
              sched_date = NULL,
              sched_time = NULL,
              sched_season = NULL
            WHERE id = ?1
          `).run(animeSlug);
        } else {
          remoteSqlStatements.push(
            `UPDATE anime SET sched_day=NULL, sched_day_label=NULL, sched_date=NULL, sched_time=NULL, sched_season=NULL WHERE id=${sqlEscape(animeSlug)};`
          );
        }
        clearedCount++;
      }
    }

    console.log(
      `Processed ${Math.min(ongoingRows.length, i + BATCH_SIZE)}/${ongoingRows.length} | Airing: ${updatedCount} | Cleared: ${clearedCount}`,
    );
    await new Promise((r) => setTimeout(r, 600));
  }

  // If in remote mode, execute batched SQL statements
  if (isRemote && remoteSqlStatements.length > 0) {
    console.log(`\nExecuting ${remoteSqlStatements.length} remote schedule update statements...`);
    const CHUNK_SQL = 50;
    for (let i = 0; i < remoteSqlStatements.length; i += CHUNK_SQL) {
      const batchSql = remoteSqlStatements.slice(i, i + CHUNK_SQL).join('\n');
      execFileSync(
        process.platform === 'win32' ? 'npx.cmd' : 'npx',
        ['wrangler', 'd1', 'execute', 'anihub', '--remote', '--command', batchSql],
        { stdio: 'ignore', windowsHide: true },
      );
    }
  }

  console.log(`\n✓ Schedule Sync Complete!`);
  console.log(`  - Active airing schedules: ${updatedCount}`);
  console.log(`  - Stale/finished slots cleared: ${clearedCount}`);

  if (db) {
    // @ts-ignore
    const totalSched = db.prepare('SELECT count(*) as count FROM anime WHERE sched_day IS NOT NULL').get().count;
    console.log(`  - Total titles now on Schedule page: ${totalSched}\n`);
  }
}

main().catch(console.error);
