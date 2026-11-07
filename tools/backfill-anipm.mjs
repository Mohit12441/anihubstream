// tools/backfill-anipm.mjs
import { DatabaseSync } from 'node:sqlite';
import { findSqlitePath, prewarmRoute } from './discover-routes.mjs';

const RATE_LIMIT_MS = Number(process.env.RATE_LIMIT_MS || 900);
const BATCH = Number(process.env.BATCH || 200);

const sqlitePath = findSqlitePath();
if (!sqlitePath) {
  console.error('[backfill] SQLite DB not found in .wrangler/state/v3/d1');
  process.exit(1);
}
const db = new DatabaseSync(sqlitePath);
db.exec('PRAGMA busy_timeout = 15000;');

const amb = db.prepare(
  `UPDATE provider_route SET status='unresolved', checked_at=NULL
   WHERE provider_id='anipm' AND status='ambiguous'`
).run();
console.log(`[backfill] Preflight reset ${amb.changes} ambiguous row(s)`);

let processed = 0, ok = 0, missing = 0, unresolved = 0;
const t0 = Date.now();
let lastId = '';

while (true) {
  const rows = /** @type {any[]} */ (db.prepare(`
    SELECT a.id, a.title, m.anilist_id, coalesce(max(e.n), 1) as latest_ep
    FROM anime a
    LEFT JOIN anime_id_map m ON m.anime_id = a.id
    LEFT JOIN episode e ON e.anime_id = a.id
    LEFT JOIN provider_route pr
      ON pr.anime_id = a.id AND pr.provider_id = 'anipm' AND pr.server = 'beta'
    WHERE a.id > ?
      AND (pr.status IS NULL OR pr.status = 'unresolved')
      AND m.anilist_id IS NOT NULL
    GROUP BY a.id
    ORDER BY a.id ASC
    LIMIT ?
  `).all(lastId, BATCH));

  if (rows.length === 0) break;

  for (const row of rows) {
    lastId = row.id;
    try {
      const res = await prewarmRoute(db, row.id, row.latest_ep, { quiet: true });
      processed++;
      if (res.ok) ok++;
      else if (res.status === 'missing') missing++;
      else unresolved++;
    } catch (e) {
      console.warn(`[backfill] ${row.id}: ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, RATE_LIMIT_MS));
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
  console.log(`[backfill] +${rows.length} (ok=${ok} missing=${missing} unres=${unresolved}) elapsed=${elapsed}s`);
}

console.log(`[backfill] DONE: processed=${processed} ok=${ok} missing=${missing} unresolved=${unresolved}`);
