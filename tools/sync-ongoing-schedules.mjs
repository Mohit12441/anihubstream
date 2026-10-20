// @ts-check
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';

const D1_DIR = './.wrangler/state/v3/d1/miniflare-D1DatabaseObject';
const files = fs.readdirSync(D1_DIR).filter(f => f.endsWith('.sqlite') && f !== 'metadata.sqlite');
const dbPath = path.join(D1_DIR, files[0]);
console.log('Target Database:', dbPath);
const db = new DatabaseSync(dbPath);

const WEEK = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function seasonKey(d = new Date()) {
  const m = d.getUTCMonth();
  const season = m < 3 ? 'Winter' : m < 6 ? 'Spring' : m < 9 ? 'Summer' : 'Fall';
  return `${season} ${d.getUTCFullYear()}`;
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

async function fetchAiringBatch(ids) {
  try {
    const res = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'AniHubStream/1.0' },
      body: JSON.stringify({ query, variables: { ids } }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data?.data?.Page?.media || [];
  } catch (e) {
    console.error('Fetch error:', e.message);
    return [];
  }
}

async function main() {
  console.log('🚀 Synchronizing Broadcast Schedules for Ongoing Anime...\n');

  const ongoingRows = db.prepare(`
    SELECT a.id, m.anilist_id
    FROM anime a
    JOIN anime_id_map m ON a.id = m.anime_id
    WHERE a.status = 'Ongoing' AND m.anilist_id IS NOT NULL
  `).all();

  console.log(`Found ${ongoingRows.length} ongoing anime with AniList IDs.`);

  const updateStmt = db.prepare(`
    UPDATE anime SET
      sched_day = ?1,
      sched_day_label = ?2,
      sched_date = ?3,
      sched_time = ?4,
      sched_season = ?5
    WHERE id = ?6
  `);

  let updatedCount = 0;
  const BATCH_SIZE = 40;

  for (let i = 0; i < ongoingRows.length; i += BATCH_SIZE) {
    const chunk = ongoingRows.slice(i, i + BATCH_SIZE);
    const idToSlug = new Map(chunk.map(r => [r.anilist_id, r.id]));
    const ids = chunk.map(r => r.anilist_id);

    const mediaList = await fetchAiringBatch(ids);

    for (const m of mediaList) {
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

        const animeSlug = idToSlug.get(m.id);
        if (animeSlug) {
          updateStmt.run(schedDay, dayLabel, dateStr, timeStr, sKey, animeSlug);
          updatedCount++;
        }
      }
    }

    console.log(`Processed ${Math.min(ongoingRows.length, i + BATCH_SIZE)}/${ongoingRows.length} | Airing schedules populated: ${updatedCount}`);
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log(`\n✓ Schedule Sync Complete! Total Airing Schedules: ${updatedCount}`);

  const totalSched = db.prepare('SELECT count(*) as count FROM anime WHERE sched_day IS NOT NULL').get().count;
  console.log(`Total titles now on Schedule page: ${totalSched}`);
}

main().catch(console.error);
