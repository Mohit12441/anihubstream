// @ts-check
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { seasonKey } from './season.mjs';
import { d1All, d1First, d1Query } from '../cloud-sync/d1.mjs';

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
  const hasRestCreds = Boolean(process.env.CF_API_TOKEN && process.env.CF_ACCOUNT_ID && process.env.CF_DATABASE_ID);
  console.log(
    `🚀 Synchronizing Daily Broadcast Schedules (Mode: ${
      isRemote ? (hasRestCreds ? 'Remote D1 REST API' : 'Remote D1 Wrangler CLI') : 'Local SQLite'
    })...\n`,
  );

  let db = null;
  /** @type {Array<{ id: string, anilist_id: number, sched_day?: number|null, sched_day_label?: string|null, sched_date?: string|null, sched_time?: string|null, sched_season?: string|null }>} */
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
        sched_season = NULL,
        sched_episode = NULL
      WHERE sched_day IS NOT NULL AND status IN ('Finished', 'Cancelled', 'Upcoming')
    `).run();
    if (cleaned.changes > 0) {
      console.log(`🧹 Cleaned up ${cleaned.changes} stale schedule slots for non-ongoing anime.`);
    }

    // 2. Query ongoing anime with AniList IDs from either anime_id_map or source_ids
    // @ts-ignore
    ongoingRows = db.prepare(`
      SELECT DISTINCT a.id,
        a.sched_day,
        a.sched_day_label,
        a.sched_date,
        a.sched_time,
        a.sched_season,
        a.sched_episode,
        COALESCE(m.anilist_id, CAST(json_extract(a.source_ids, '$.anilist') AS INTEGER)) as anilist_id
      FROM anime a
      LEFT JOIN anime_id_map m ON a.id = m.anime_id
      WHERE a.status = 'Ongoing'
        AND COALESCE(m.anilist_id, CAST(json_extract(a.source_ids, '$.anilist') AS INTEGER)) IS NOT NULL
    `).all();
  } else if (hasRestCreds) {
    // Remote D1 REST API mode (preferred in CI/Cloud environments)
    try {
      await d1Query(`
        UPDATE anime SET
          sched_day = NULL,
          sched_day_label = NULL,
          sched_date = NULL,
          sched_time = NULL,
          sched_season = NULL,
        sched_episode = NULL
        WHERE sched_day IS NOT NULL AND status IN ('Finished', 'Cancelled', 'Upcoming')
      `);
    } catch (err) {
      if (err.message && (err.message.includes('7500') || err.message.includes('daily row write limit'))) {
        console.warn('⚠️ Cloudflare D1 daily write limit currently reached. Schedule sync will resume automatically once quota resets at 00:00 UTC.');
        return;
      }
      throw err;
    }

    ongoingRows = await d1All(`
      SELECT DISTINCT a.id,
        a.sched_day,
        a.sched_day_label,
        a.sched_date,
        a.sched_time,
        a.sched_season,
        a.sched_episode,
        COALESCE(m.anilist_id, CAST(json_extract(a.source_ids, '$.anilist') AS INTEGER)) as anilist_id
      FROM anime a
      LEFT JOIN anime_id_map m ON a.id = m.anime_id
      WHERE a.status = 'Ongoing'
        AND COALESCE(m.anilist_id, CAST(json_extract(a.source_ids, '$.anilist') AS INTEGER)) IS NOT NULL
    `);
  } else {
    // Remote D1 mode fallback: fetch ongoing titles using wrangler CLI
    const output = execFileSync(
      process.platform === 'win32' ? 'npx.cmd' : 'npx',
      ['wrangler', 'd1', 'execute', 'anihub', '--remote', '--json', '--command', `
        SELECT DISTINCT a.id,
          a.sched_day,
          a.sched_day_label,
          a.sched_date,
          a.sched_time,
          a.sched_season,
        a.sched_episode,
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

  const rowBySlug = new Map(ongoingRows.map((r) => [r.id, r]));
  let updatedCount = 0;
  let clearedCount = 0;
  let unchangedCount = 0;
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

      const existing = rowBySlug.get(animeSlug);

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

        const nextEpNum = Number(m.nextAiringEpisode.episode) || 0;
        const latestAiredEp = nextEpNum > 1 ? nextEpNum - 1 : (nextEpNum === 1 ? 1 : 0);

        // Delta check: skip write if already matching stored values
        const isUnchanged =
          existing &&
          existing.sched_day === schedDay &&
          existing.sched_day_label === dayLabel &&
          existing.sched_date === dateStr &&
          existing.sched_time === timeStr &&
          existing.sched_season === sKey &&
          existing.sched_episode === (nextEpNum || null);

        if (!isUnchanged) {
          if (db) {
            db.prepare(`
              UPDATE anime SET
                sched_day = ?1,
                sched_day_label = ?2,
                sched_date = ?3,
                sched_time = ?4,
                sched_season = ?5,
                sched_episode = ?6
              WHERE id = ?7
            `).run(schedDay, dayLabel, dateStr, timeStr, sKey, nextEpNum || null, animeSlug);
          } else if (hasRestCreds) {
            await d1Query(
              `UPDATE anime SET sched_day = ?1, sched_day_label = ?2, sched_date = ?3, sched_time = ?4, sched_season = ?5, sched_episode = ?6 WHERE id = ?7`,
              [schedDay, dayLabel, dateStr, timeStr, sKey, nextEpNum || null, animeSlug],
            );
          } else {
            remoteSqlStatements.push(
              `UPDATE anime SET sched_day=${schedDay}, sched_day_label=${sqlEscape(dayLabel)}, sched_date=${sqlEscape(dateStr)}, sched_time=${sqlEscape(timeStr)}, sched_season=${sqlEscape(sKey)}, sched_episode=${nextEpNum > 0 ? nextEpNum : 'NULL'} WHERE id=${sqlEscape(animeSlug)};`,
            );
          }
          updatedCount++;
        } else {
          unchangedCount++;
        }

        // Auto-generate missing episode shells up to latestAiredEp so schedule links always work
        const targetEpCount = Math.max(latestAiredEp, 1);
        if (targetEpCount > 0) {
          if (db) {
            // @ts-ignore
            const countRow = db.prepare('SELECT count(*) as count FROM episode WHERE anime_id = ?1').get(animeSlug);
            // @ts-ignore
            const curEpCount = countRow?.count || 0;
            if (curEpCount < targetEpCount) {
              const insertStmt = db.prepare(`
                INSERT OR IGNORE INTO episode (id, anime_id, n, title, runtime, runtime_seconds, thumb, synopsis, markers)
                VALUES (?1, ?2, ?3, ?4, '24m', 1440, '', '', '[]')
              `);
              for (let epIdx = curEpCount + 1; epIdx <= targetEpCount; epIdx++) {
                insertStmt.run(`${animeSlug}#${epIdx}`, animeSlug, epIdx, `Episode ${epIdx}`);
              }
            }
          } else if (hasRestCreds) {
            const res = await d1First(`SELECT count(*) as count FROM episode WHERE anime_id = ?1`, [animeSlug]);
            // @ts-ignore
            const curCount = res?.count || 0;
            if (curCount < targetEpCount) {
              for (let epIdx = curCount + 1; epIdx <= targetEpCount; epIdx++) {
                await d1Query(
                  `INSERT OR IGNORE INTO episode (id, anime_id, n, title, runtime, runtime_seconds, thumb, synopsis, markers) VALUES (?1, ?2, ?3, ?4, '24m', 1440, '', '', '[]')`,
                  [`${animeSlug}#${epIdx}`, animeSlug, epIdx, `Episode ${epIdx}`],
                );
              }
            }
          }
        }
      } else {
        // Anime has no active upcoming episode on AniList -> Clear schedule slot if not already clear
        const isAlreadyCleared = !existing || (existing.sched_day == null && existing.sched_date == null);
        if (isAlreadyCleared) {
          unchangedCount++;
          continue;
        }

        if (db) {
          db.prepare(`
            UPDATE anime SET
              sched_day = NULL,
              sched_day_label = NULL,
              sched_date = NULL,
              sched_time = NULL,
              sched_season = NULL,
        sched_episode = NULL
            WHERE id = ?1
          `).run(animeSlug);
        } else if (hasRestCreds) {
          await d1Query(
            `UPDATE anime SET sched_day = NULL, sched_day_label = NULL, sched_date = NULL, sched_time = NULL, sched_season = NULL,
        sched_episode = NULL WHERE id = ?1`,
            [animeSlug],
          );
        } else {
          remoteSqlStatements.push(
            `UPDATE anime SET sched_day=NULL, sched_day_label=NULL, sched_date=NULL, sched_time=NULL, sched_season=NULL WHERE id=${sqlEscape(animeSlug)};`,
          );
        }
        clearedCount++;
      }
    }

    console.log(
      `Processed ${Math.min(ongoingRows.length, i + BATCH_SIZE)}/${ongoingRows.length} | Airing: ${updatedCount} | Cleared: ${clearedCount} | Unchanged: ${unchangedCount}`,
    );
    await new Promise((r) => setTimeout(r, 600));
  }

  // If in remote mode with wrangler CLI fallback, execute batched SQL statements
  if (isRemote && !hasRestCreds && remoteSqlStatements.length > 0) {
    console.log(`\nExecuting ${remoteSqlStatements.length} remote schedule update statements via wrangler...`);
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
  console.log(`  - Active airing schedules written: ${updatedCount}`);
  console.log(`  - Stale/finished slots cleared: ${clearedCount}`);
  console.log(`  - Unchanged slots skipped (zero D1 writes): ${unchangedCount}`);

  if (db) {
    // @ts-ignore
    const totalSched = db.prepare('SELECT count(*) as count FROM anime WHERE sched_day IS NOT NULL').get().count;
    console.log(`  - Total titles now on Schedule page: ${totalSched}\n`);
  }
}

main().catch(console.error);
