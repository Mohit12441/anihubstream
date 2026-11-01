// @ts-check
import { DatabaseSync } from 'node:sqlite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function findSqlitePath() {
  const d1Dir = resolve(__dirname, '../.wrangler/state/v3/d1/miniflare-D1DatabaseObject');
  if (existsSync(d1Dir)) {
    const files = readdirSync(d1Dir).filter((f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite');
    if (files.length > 0) return resolve(d1Dir, files[0]);
  }
  return null;
}

export function migrateEpisodeThumbnails(customDb = null) {
  const db = customDb || new DatabaseSync(findSqlitePath());
  db.exec('PRAGMA busy_timeout = 10000;');

  const beforeRow = db.prepare(`
    SELECT count(id) as missing_count
    FROM episode
    WHERE thumb IS NULL OR thumb = ''
  `).get();
  // @ts-ignore
  const beforeCount = Number(beforeRow?.missing_count || 0);

  const res = db.prepare(`
    UPDATE episode
    SET thumb = (
      SELECT coalesce(nullif(a.key_art, ''), nullif(a.art, ''), '')
      FROM anime a
      WHERE a.id = episode.anime_id
    )
    WHERE (thumb IS NULL OR thumb = '')
      AND EXISTS (
        SELECT 1 FROM anime a
        WHERE a.id = episode.anime_id
          AND (a.key_art != '' OR a.art != '')
      )
  `).run();

  const afterRow = db.prepare(`
    SELECT count(id) as missing_count
    FROM episode
    WHERE thumb IS NULL OR thumb = ''
  `).get();
  // @ts-ignore
  const afterCount = Number(afterRow?.missing_count || 0);

  return {
    beforeCount,
    updated: Number(res.changes || 0),
    afterCount,
  };
}

if (process.argv[1] && process.argv[1].endsWith('migrate-episode-thumbs.mjs')) {
  const result = migrateEpisodeThumbnails();
  console.log(`[Thumbnail Migration] Before: ${result.beforeCount} missing thumb | Updated: ${result.updated} rows | Remaining: ${result.afterCount}`);
}
