/* Structural before/after comparison of the rows a pre-flight run touched.

   The rollout's one hard promise is that a run changes only the columns its phase owns, and the way to
   check that against production is to snapshot 100 rows, run, and snapshot the same 100 again. A
   textual `diff` of the two JSON dumps is not that check: `source_ids` is a JSON document stored as
   text, so a merge that adds one key rewrites the whole string, and `diff` reports every such row as
   a change without saying whether it was allowed. This compares the parsed values and applies the
   ownership rules, so the answer is a verdict rather than a wall of red.

     # 1. snapshot the window
     npx wrangler d1 execute anihub --remote --json --command \
       "SELECT id, … FROM anime ORDER BY id LIMIT 100" > before.json
     # 2. re-snapshot exactly those ids (not LIMIT again — a row this run creates can sort into the
     #    window and push one out, which a second LIMIT would show as a deletion)
     npx wrangler d1 execute anihub --remote --json --command \
       "SELECT id, … FROM anime WHERE id IN ($(node cloud-sync/diff-rows.mjs --ids before.json))" > after.json
     # 3. compare
     node cloud-sync/diff-rows.mjs before.json after.json --mode mirror

   Exit 0 means nothing outside the phase's write set moved. Exit 1 prints each violation with the row
   id, the column and both values, which is the information a rollback decision needs.

   Read-only by construction: this file never opens a database and never sends a request — it reads two
   files. Nothing here fixes a production problem; it says whether the run is behaving as designed. */

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/* Columns no phase may touch on an existing row: local curation (rank, alt_seasons), the skip
   pipeline's own provenance, the local task's stamp, and added_at, which is what "Just Added" sorts
   on. Insert-only is not the same as never: a row this run creates legitimately carries them. */
const NEVER = ['added_at', 'rank', 'alt_seasons', 'skip_key_id', 'skip_key_space', 'catalogue_synced_at'];
/* The air slot and the trend rank are owned by the local task until Phase 3 claims them. */
const UNTIL_TAKEOVER = ['sched_day', 'sched_day_label', 'sched_date', 'sched_time', 'sched_season', 'trend_rank'];
/* Exported so a test can check these against updateSet(): the runbook's assertion and the sync's write
   set are the same fact written twice, and if they disagree the pre-flight either cries on a legitimate
   merge or stays quiet on a column nobody owns. */
export const FORBIDDEN = {
  mirror: [...NEVER, ...UNTIL_TAKEOVER],
  delta: [...NEVER, ...UNTIL_TAKEOVER],
  takeover: [...NEVER],
};

/** wrangler --json wraps results; older shapes and a hand-saved query give a bare row array. */
const rowsOf = (json) => (Array.isArray(json) && json.length && Array.isArray(json[0]?.results)
  ? json.flatMap((part) => part.results ?? [])
  : Array.isArray(json) ? json : []);

const load = (file) => new Map(rowsOf(JSON.parse(readFileSync(file, 'utf8'))).map((r) => [String(r.id), r]));

/** Keys `source_ids` gained, lost, or changed — with the value pinned for `anilist`, which is the id
    that decides which upstream record a row is, and which sync-anilist.mjs:539 refuses to move. */
function provenance(before, after) {
  const parse = (v) => { try { return v == null ? {} : JSON.parse(v); } catch { return null; } };
  const [a, b] = [parse(before), parse(after)];
  if (!a || !b) return { note: 'unparseable JSON — compared as text', changed: before !== after };
  const added = Object.keys(b).filter((k) => !(k in a));
  const lost = Object.keys(a).filter((k) => !(k in b));
  const changed = Object.keys(a).filter((k) => k in b && JSON.stringify(a[k]) !== JSON.stringify(b[k]));
  return { added, lost, changed: changed.map((k) => `${k}: ${JSON.stringify(a[k])} → ${JSON.stringify(b[k])}`), anilistMoved: 'anilist' in a && String(a.anilist) !== String(b.anilist) };
}

const same = (x, y) => JSON.stringify(x ?? null) === JSON.stringify(y ?? null);

export function compare(before, after, mode = 'mirror') {
  if (!FORBIDDEN[mode]) throw new Error(`unknown mode '${mode}' — expected one of ${Object.keys(FORBIDDEN).join('|')}`);
  const forbidden = FORBIDDEN[mode];
  const violations = [], notes = [];
  const beforeIds = [...before.keys()], afterIds = new Set(after.keys());
  const gone = beforeIds.filter((id) => !afterIds.has(id));
  const created = [...afterIds].filter((id) => !before.has(id));
  /* No phase deletes: `--ids` pinned the second snapshot to the first snapshot's id list, so anything
     missing here really is missing from the table. */
  if (gone.length) violations.push(...gone.map((id) => ({ id, column: '(row)', why: 'present before, absent after — no phase deletes rows' })));
  if (created.length) {
    if (mode === 'mirror') violations.push(...created.map((id) => ({ id, column: '(row)', why: 'mirror never inserts' })));
    else notes.push(`${created.length} row(s) created${created.length <= 5 ? `: ${created.join(', ')}` : ''}`);
  }

  for (const id of beforeIds) {
    const [b, a] = [before.get(id), after.get(id)];
    if (!a) continue;
    const columns = new Set([...Object.keys(b), ...Object.keys(a)]);
    for (const column of columns) {
      if (same(b[column], a[column])) continue;
      if (column === 'source_ids') {
        const p = provenance(b[column], a[column]);
        if (p.note) { if (forbidden.includes(column)) violations.push({ id, column, why: p.note }); else notes.push(p.note); continue; }
        /* json_patch replaces a key's value and deletes a key whose patch value is null. This run
           never sends a null (sourceIds is built from the row's own keys plus anilist/mal), so a lost
           key or a moved anilist id means the merge is broken; gaining a key is the point of it. */
        if (p.lost.length) violations.push({ id, column, why: `lost ${p.lost.join(', ')} — a json_patch merge can add or overwrite, and this run never sends null, so nothing should disappear` });
        if (p.anilistMoved) violations.push({ id, column, why: `anilist id moved: ${p.changed.join('; ')}` });
        if (p.added.length) notes.push(`${id}: source_ids gained ${p.added.join(', ')}`);
        const other = p.changed.filter((c) => !c.startsWith('anilist: '));
        if (other.length) notes.push(`${id}: source_ids values rewritten (${other.join('; ')}) — expected only if the local task changed the row between the two snapshots`);
      } else if (forbidden.includes(column)) {
        violations.push({ id, column, why: `${JSON.stringify(b[column] ?? null)} → ${JSON.stringify(a[column] ?? null)} in ${mode}` });
      } else notes.push(`${id}: ${column} ${JSON.stringify(b[column] ?? null)} → ${JSON.stringify(a[column] ?? null)}`);
    }
  }
  return { mode, violations, notes };
}

/** The quoted id list for the second snapshot. Ids are slugs, but they are quoted and escaped anyway:
    this string goes into a command against the live database. */
export const idList = (before) => [...before.keys()].map((id) => `'${id.replaceAll(`'`, `''`)}'`).join(',');

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  let mode = 'mirror';
  const modeAt = args.indexOf('--mode');
  if (modeAt >= 0) {
    mode = args[modeAt + 1] ?? '';
    args.splice(modeAt, 2);
  }
  if (args[0] === '--ids') {
    if (args.length !== 2) { console.error('usage: node cloud-sync/diff-rows.mjs --ids before.json'); process.exit(2); }
    process.stdout.write(idList(load(args[1])));
  } else {
    if (args.length < 2) { console.error('usage: node cloud-sync/diff-rows.mjs before.json after.json [--mode mirror|delta|takeover]'); process.exit(2); }
    if (!FORBIDDEN[mode]) { console.error(`unknown mode '${mode}' — expected mirror, delta or takeover`); process.exit(2); }
    const before = load(args[0]);
    const after = load(args[1]);
    const { violations, notes } = compare(before, after, mode);
    console.log(`diff-rows: ${mode}, ${before.size} row(s) before, ${after.size} after — ${violations.length} violation(s), ${notes.length} allowed change(s)`);
    for (const v of violations) console.log(`  VIOLATION ${v.id} ${v.column}: ${v.why}`);
    for (const n of notes) console.log(`  ok ${n}`);
    process.exit(violations.length ? 1 : 0);
  }
}
