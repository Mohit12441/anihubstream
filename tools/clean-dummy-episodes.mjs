import { DatabaseSync } from 'node:sqlite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readdirSync } from 'node:fs';

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

console.log('Cleaning up phantom and unreleased dummy episodes...');

// 1. Delete all episodes for Upcoming / NOT_YET_RELEASED anime
const deletedUpcoming = db.prepare(`
  DELETE FROM episode
  WHERE anime_id IN (SELECT id FROM anime WHERE status = 'Upcoming' OR status = 'NOT_YET_RELEASED')
`).run();
console.log(`Deleted ${deletedUpcoming.changes} episodes belonging to Upcoming anime.`);

// 2. Delete dummy episodes with no airdate and no real external_id for Ongoing / Airing anime
const deletedOngoingDummies = db.prepare(`
  DELETE FROM episode
  WHERE airdate IS NULL 
    AND (external_id IS NULL OR external_id NOT LIKE 'anikoto:%')
    AND anime_id IN (SELECT id FROM anime WHERE status = 'Ongoing' OR status = 'Airing')
`).run();
console.log(`Deleted ${deletedOngoingDummies.changes} phantom dummy episodes for Ongoing anime.`);

// 3. For any remaining ongoing anime with sched_episode, delete any episodes where n >= sched_episode
const deletedFutureEps = db.prepare(`
  DELETE FROM episode
  WHERE rowid IN (
    SELECT e.rowid
    FROM episode e
    JOIN anime a ON a.id = e.anime_id
    WHERE (a.status = 'Ongoing' OR a.status = 'Airing')
      AND a.sched_episode IS NOT NULL
      AND e.n >= a.sched_episode
  )
`).run();
console.log(`Deleted ${deletedFutureEps.changes} unreleased future episodes for Ongoing anime.`);

console.log('Cleanup finished.');
