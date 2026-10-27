/* ============================================================
   tools/backfill-search-text.mjs — one-off/repair filler for the
   a.search_text column introduced with the scaled search API.

   tools/sync-catalogue.mjs writes search_text for every row it
   touches, but rows imported before the column existed (or written
   by tools that predate it) have it NULL, and a NULL row can never
   match a search. This reads every anime row, folds the searchable
   fields with the same foldSearch() the API uses, and applies one
   UPDATE batch to remote D1. Idempotent — safe to re-run.

     node tools/backfill-search-text.mjs
   ============================================================ */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { foldSearch } from '../functions/api/_lib.js';
import { d1Json, wrangler } from './discover-titles.mjs';

const sqlText = (v) => `'${String(v).replace(/'/g, "''")}'`;

const rows = d1Json('SELECT id, title, native, kind, status FROM anime');
const stmts = rows.map((r) => {
  const folded = [foldSearch(r.title), foldSearch(r.native), String(r.kind).toLowerCase(), String(r.status).toLowerCase()].join(' ');
  return `UPDATE anime SET search_text = ${sqlText(folded)} WHERE id = ${sqlText(r.id)};`;
});

const dir = mkdtempSync(join(tmpdir(), 'anihub-search-'));
try {
  const file = join(dir, 'search.sql');
  writeFileSync(file, stmts.join('\n'), 'utf8');
  wrangler(['d1', 'execute', 'anihub', '--remote', '--file', file]);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

const filled = d1Json('SELECT count(*) AS n FROM anime WHERE search_text IS NULL')[0]?.n ?? '?';
console.log(`backfilled ${stmts.length} rows; still NULL: ${filled}`);
if (filled !== 0 && filled !== '?') process.exitCode = 1;
