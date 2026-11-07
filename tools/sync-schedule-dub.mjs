import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { findSqlitePath } from './discover-titles.mjs';

function getApiKey() {
  const arg = process.argv.find((a) => a.startsWith('--key='));
  if (arg) return arg.slice(6).trim();
  if (process.env.ANIMESCHEDULE_API_KEY) return process.env.ANIMESCHEDULE_API_KEY.trim();

  for (const file of ['.dev.vars', '.env']) {
    const full = resolve(import.meta.dirname, '..', file);
    if (existsSync(full)) {
      const content = readFileSync(full, 'utf8');
      const match = content.match(/ANIMESCHEDULE_API_KEY\s*=\s*["']?([^"'\r\n]+)["']?/);
      if (match) return match[1].trim();
    }
  }
  return null;
}

const API_KEY = getApiKey();
if (!API_KEY) {
  console.error('❌ Missing ANIMESCHEDULE_API_KEY.');
  process.exit(1);
}

const dbPath = findSqlitePath();
if (!dbPath) {
  console.error('❌ Could not locate local D1 SQLite database.');
  process.exit(1);
}

const db = new DatabaseSync(dbPath);

const normalize = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

async function syncDubSchedule() {
  console.log('--- Syncing Dub Schedules from AnimeSchedule.net ---');

  const headers = {
    'Authorization': `Bearer ${API_KEY}`,
    'User-Agent': 'AniHubStream/1.0',
  };

  // 1. Fetch current weekly Dub Timetable
  console.log('Fetching weekly dub timetable...');
  let dubs = [];
  try {
    const res = await fetch('https://animeschedule.net/api/v3/timetables/dub', { headers });
    if (res.ok) {
      dubs = await res.json();
      console.log(`Fetched ${dubs.length} dub timetable entries.`);
    } else {
      console.warn(`[AnimeSchedule] Timetable status: ${res.status}`);
    }
  } catch (err) {
    console.error('Failed to fetch dub timetable:', err.message);
  }

  // 2. Fetch local scheduled anime
  const anime = db.prepare(`
    SELECT a.id, a.title, a.native, a.sched_day, a.sched_time, a.sched_date
    FROM anime a 
    WHERE a.sched_day IS NOT NULL
  `).all();

  console.log(`Found ${anime.length} local scheduled anime.`);

  let updated = 0;
  const updateStmt = db.prepare('UPDATE anime SET sched_dub_at = ? WHERE id = ?');

  for (const a of anime) {
    const aNorm = normalize(a.title);
    const aIdNorm = normalize(a.id);
    const aNativeNorm = normalize(a.native);

    // Find match in dub timetable
    let match = dubs.find((d) => {
      return (
        normalize(d.title) === aNorm ||
        normalize(d.english) === aNorm ||
        normalize(d.romaji) === aNorm ||
        normalize(d.route) === aIdNorm ||
        (aNativeNorm && d.native && normalize(d.native) === aNativeNorm)
      );
    });

    // Fallback: search AnimeSchedule API by query if not found in active timetable
    if (!match) {
      try {
        const q = encodeURIComponent(a.title);
        const searchRes = await fetch(`https://animeschedule.net/api/v3/anime?q=${q}`, { headers });
        if (searchRes.ok) {
          const searchData = await searchRes.json();
          const candidate = (searchData.anime || [])[0];
          if (candidate && candidate.route) {
            const detailRes = await fetch(`https://animeschedule.net/api/v3/anime/${candidate.route}`, { headers });
            if (detailRes.ok) {
              const detail = await detailRes.json();
              if (detail.dubTime && !detail.dubTime.startsWith('0001')) {
                match = { episodeDate: detail.dubTime, episodeNumber: 1 };
              }
            }
          }
        }
        await new Promise((r) => setTimeout(r, 400));
      } catch {}
    }

    if (match && match.episodeDate && !match.episodeDate.startsWith('0001')) {
      const dubTimestamp = new Date(match.episodeDate).getTime();
      updateStmt.run(dubTimestamp, a.id);
      updated++;
      console.log(`✅ ${a.title} -> Dub: Ep ${match.episodeNumber || '?'} at ${match.episodeDate}`);
    } else {
      console.log(`⚪ ${a.title} (No dub broadcast date)`);
    }
  }

  console.log(`\nSync complete. Updated ${updated}/${anime.length} titles with dub schedule.`);
}

syncDubSchedule();
