// @ts-check
import { DatabaseSync } from 'node:sqlite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readdirSync } from 'node:fs';
import { discoverRoute, betaReady, upsertRoute } from '../lib/routes.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function findSqlitePath() {
  const d1Dir = resolve(__dirname, '../.wrangler/state/v3/d1/miniflare-D1DatabaseObject');
  if (existsSync(d1Dir)) {
    const files = readdirSync(d1Dir).filter((f) => f.endsWith('.sqlite'));
    if (files.length > 0) return resolve(d1Dir, files[0]);
  }
  return null;
}

/**
 * Prewarms a route and verifies beta readiness when an episode lands in D1.
 * @param {DatabaseSync} db
 * @param {string} animeId
 * @param {number} [epNumber=1]
 * @param {{ quiet?: boolean }} [opts]
 */
export async function prewarmRoute(db, animeId, epNumber = 1, opts = {}) {
  const quiet = opts.quiet ?? false;

  const animeRow = /** @type {any} */ (
    db.prepare(`
      SELECT a.id, a.title, m.anilist_id, a.year
      FROM anime a
      LEFT JOIN anime_id_map m ON m.anime_id = a.id
      WHERE a.id = ?
    `).get(animeId)
  );
  if (!animeRow) return { ok: false, error: 'anime_not_found' };

  let route = /** @type {any} */ (
    db.prepare("SELECT path, status FROM provider_route WHERE anime_id = ? AND provider_id = 'anipm' AND server = 'beta'").get(animeId)
  );

  if (!route?.path) {
    if (!quiet) console.log(`  🔍 Discovering beta route for "${animeRow.title}" (${animeId})...`);
    const found = await discoverRoute(animeId, animeRow.title, animeRow.anilist_id, animeRow.year);
    await upsertRoute(db, animeId, found);
    route = found;
  }

  if (!route?.path) {
    if (!quiet) console.log(`  ⚠️ Beta route missing or ambiguous for "${animeRow.title}"`);
    return { ok: false, status: route?.status || 'missing' };
  }

  const ready = await betaReady(db, animeId, route.path, epNumber, animeRow.anilist_id, animeRow.title);
  if (!quiet) {
    console.log(`  ⚡ Beta route for ${animeId} ep ${epNumber}: ${ready ? '✅ OK' : '❌ MISSING (Negative cached)'}`);
  }
  return { ok: ready, status: ready ? 'ok' : 'missing', path: route.path };
}

/**
 * Full catalogue route discovery and prewarming sweep.
 * @param {{ limit?: number, quiet?: boolean }} [opts]
 */
export async function syncAllRoutes(opts = {}) {
  const sqlitePath = findSqlitePath();
  if (!sqlitePath) throw new Error('D1 sqlite database not found');
  const db = new DatabaseSync(sqlitePath);
  db.exec('PRAGMA busy_timeout = 15000;');
  const limit = opts.limit ?? 20;
  const quiet = opts.quiet ?? false;

  const rows = /** @type {any[]} */ (
    db.prepare(`
      SELECT a.id, a.title, m.anilist_id, a.year, coalesce(max(e.n), 1) as latest_ep
      FROM anime a
      LEFT JOIN anime_id_map m ON m.anime_id = a.id
      LEFT JOIN episode e ON e.anime_id = a.id
      LEFT JOIN provider_route pr ON pr.anime_id = a.id AND pr.provider_id = 'anipm' AND pr.server = 'beta'
      WHERE pr.status IS NULL OR pr.status = 'unresolved'
      GROUP BY a.id
      LIMIT ?
    `).all(limit)
  );

  let successCount = 0;
  for (const row of rows) {
    const res = await prewarmRoute(db, row.id, row.latest_ep, { quiet });
    if (res.ok) successCount++;
  }

  return { total: rows.length, success: successCount };
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  console.log('[discover-routes] Starting route discovery and prewarming sweep...');
  syncAllRoutes({ limit: 10, quiet: false })
    .then((r) => console.log(`[discover-routes] Completed: ${r.success}/${r.total} routes verified.`))
    .catch(console.error);
}
