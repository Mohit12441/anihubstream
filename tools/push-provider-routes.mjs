// tools/push-provider-routes.mjs
// Pushes verified AniPM routes from local SQLite → remote Cloudflare D1.
// Usage: node tools/push-provider-routes.mjs --remote
// DRY RUN: node tools/push-provider-routes.mjs
import { DatabaseSync } from 'node:sqlite';
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findSqlitePath } from './discover-routes.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const remote = process.argv.includes('--remote');

const sqlitePath = findSqlitePath();
if (!sqlitePath) {
  console.error('[push] SQLite DB not found');
  process.exit(1);
}
const db = new DatabaseSync(sqlitePath);
db.exec('PRAGMA busy_timeout = 15000;');

const rows = /** @type {any[]} */ (db.prepare(`
  SELECT anime_id, provider_id, server, path, status, checked_ep, checked_at,
         resolved_anilist, resolved_title
  FROM provider_route
  WHERE provider_id = 'anipm' AND status IN ('ok', 'missing')
`).all());

if (rows.length === 0) {
  console.log('[push] No rows to push');
  process.exit(0);
}

const esc = (v) =>
  v === null || v === undefined
    ? 'NULL'
    : typeof v === 'number'
      ? String(v)
      : `'${String(v).replace(/'/g, "''")}'`;

const stmts = rows.map((r) => `INSERT INTO provider_route
  (anime_id, provider_id, server, path, status, checked_ep, checked_at, resolved_anilist, resolved_title)
  VALUES (${esc(r.anime_id)}, ${esc(r.provider_id)}, ${esc(r.server)}, ${esc(r.path)}, ${esc(r.status)}, ${esc(r.checked_ep)}, ${esc(r.checked_at)}, ${esc(r.resolved_anilist)}, ${esc(r.resolved_title)})
  ON CONFLICT(anime_id, provider_id, server) DO UPDATE SET
    path=excluded.path, status=excluded.status, checked_ep=excluded.checked_ep,
    checked_at=excluded.checked_at, resolved_anilist=excluded.resolved_anilist,
    resolved_title=excluded.resolved_title;`);

const outFile = resolve(ROOT, 'provider-routes-delta.sql');
writeFileSync(outFile, stmts.join('\n') + '\n', 'utf8');
console.log(`[push] Wrote ${rows.length} rows to ${outFile}`);
console.log(`[push] Status breakdown: ${JSON.stringify(
  rows.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {})
)}`);

if (!remote) {
  console.log('[push] Dry run complete. Add --remote to push to Cloudflare D1.');
  process.exit(0);
}

console.log('[push] Pushing to remote D1 (requires CLOUDFLARE_API_TOKEN in env)...');
try {
  execSync(`npx wrangler d1 execute anihub --remote --file=${outFile}`, {
    stdio: 'inherit',
    cwd: ROOT,
  });
  console.log('[push] ✅ Remote push complete');
} catch (e) {
  console.error('[push] ❌ Push failed:', e.message);
  process.exit(1);
}
