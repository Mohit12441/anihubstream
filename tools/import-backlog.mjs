/* ============================================================
   tools/import-backlog.mjs — grows the catalogue by 15-20 real titles
   per run from the AniList popularity backlog, run from this machine
   as a step of the 30-minute refresh pipeline.

   Why this exists on top of discover-titles.mjs: that tool only tracks
   the current trending list (~2 new titles a day, by design). The site
   is meant to grow by 15-20 real titles per 30 minutes, so this tool
   walks AniList's all-time popularity ordering page by page, skipping
   every title already in D1, and imports a batch through the exact
   same pipeline the rest of the catalogue uses:

     1. candidates   Page(sort: POPULARITY_DESC, isAdult: false,
                     format TV/TV_SHORT/MOVIE/SPECIAL/OVA/ONA) — no
                     MUSIC, minus every AniList id already in D1
     2. mapping      AniList idMal -> Kitsu's commutative MAL mapping,
                     with the same start-year ±1 guard; no mapping or
                     stale mapping -> skipped, never guessed
     3. build        ONE tools/sync-catalogue.mjs run with a --title
                     flag per batch title (Kitsu episodes/art, AniSkip
                     under the three-episode length-agreement check),
                     then ONE D1 apply of its seed.sql
     4. reconcile    reads the applied rows back out of D1 and removes
                     any batch entry that did not land — sources are
                     never left half-added
     5. cursor       sync_meta 'backlog' holds the page to continue
                     from, so each run picks up where the last stopped
                     (wraps to page 1 after CURSOR_WRAP pages)

   Run by hand (adds real titles):
     node tools/import-backlog.mjs            # one batch of 18
     node tools/import-backlog.mjs --limit=3  # a small batch
   ============================================================ */

import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import { anilist, appendSource, d1Json, kitsuByMal, readSources, removeSource, slugify, wrangler } from './discover-titles.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const SEED = resolve(ROOT, 'seed.sql');
const BATCH = 18;
const PAGE_SIZE = 50;
const MAX_SCAN_PAGES = 3;
const CURSOR_WRAP = 400;
const SOURCE_FORMATS = ['TV', 'TV_SHORT', 'MOVIE', 'SPECIAL', 'OVA', 'ONA'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sqlText = (v) => `'${String(v).replace(/'/g, "''")}'`;

/* Returns { due:true, page, added:[{id,anilist,kitsu,title}], skipped:[...], failures:[...] }. */
export async function importBacklog({ limit = BATCH } = {}) {
  const record = d1Json("SELECT value FROM sync_meta WHERE key = 'backlog'");
  const cursor = record[0]?.value ? JSON.parse(record[0].value) : null;
  let page = Number.isInteger(cursor?.page) && cursor.page >= 1 && cursor.page <= CURSOR_WRAP ? cursor.page : 1;

  /* Fresh read every run: discovery may have added titles earlier in the same pipeline run. */
  const animeRows = d1Json('SELECT id, source_ids FROM anime');
  const ids = new Set();
  const anilistIds = new Set();
  for (const s of readSources()) {
    if (s.id) ids.add(s.id);
    if (Number.isInteger(s.anilist)) anilistIds.add(s.anilist);
  }
  for (const r of animeRows) {
    ids.add(r.id);
    try {
      const a = JSON.parse(r.source_ids ?? '{}').anilist;
      if (Number.isInteger(a)) anilistIds.add(a);
    } catch {
      /* owns its slug id regardless */
    }
  }

  const skipped = [];
  const batch = [];
  let scanned = 0;
  while (batch.length < limit && scanned < MAX_SCAN_PAGES) {
    const data = await anilist(
      `query($page: Int, $n: Int, $formats: [MediaFormat]){ Page(page: $page, perPage: $n){ media(sort: POPULARITY_DESC, type: ANIME, isAdult: false, format_in: $formats){ id idMal seasonYear format title{ romaji english } } } }`,
      { page, n: PAGE_SIZE, formats: SOURCE_FORMATS },
    );
    const candidates = (data?.Page?.media ?? []).filter((m) => !anilistIds.has(m.id));
    for (const cand of candidates) {
      if (batch.length >= limit) break;
      const label = cand.title?.english || cand.title?.romaji || `anilist ${cand.id}`;

      if (!cand.idMal) {
        skipped.push(`${label}: no MAL id to map through`);
        continue;
      }
      let kitsu;
      try {
        kitsu = await kitsuByMal(cand.idMal);
      } catch (err) {
        skipped.push(`${label}: mapping lookup failed (${err.message})`);
        continue;
      }
      await sleep(300); // keep the mapping lookups polite across a 18-title scan
      if (!kitsu) {
        skipped.push(`${label}: no Kitsu mapping for MAL ${cand.idMal}`);
        continue;
      }
      if (kitsu.year && cand.seasonYear && Math.abs(kitsu.year - cand.seasonYear) > 1) {
        skipped.push(`${label}: Kitsu ${kitsu.kitsuId} starts ${kitsu.year}, AniList says ${cand.seasonYear} — skipped rather than trusted`);
        continue;
      }

      let id = slugify(label) || `anime-${cand.id}`;
      if (ids.has(id)) id = `${slugify(label)}-${cand.id}`;

      batch.push({ id, anilist: cand.id, kitsu: kitsu.kitsuId, title: label, page });
      ids.add(id);
      anilistIds.add(cand.id);
    }
    scanned++;
    page = page >= CURSOR_WRAP ? 1 : page + 1;
  }

  const added = [];
  const failures = [];
  if (batch.length) {
    for (const entry of batch) {
      appendSource({ id: entry.id, kitsu: entry.kitsu, anilist: entry.anilist, note: `imported ${new Date().toISOString().slice(0, 10)} from the AniList popularity backlog (page ${entry.page})` });
    }

    const startedAt = Date.now();
    let syncError = null;
    try {
      execFileSync(
        process.execPath,
        [resolve(ROOT, 'tools/sync-catalogue.mjs'), ...batch.map((b) => `--title=${b.id}`)],
        { encoding: 'utf8', windowsHide: true, cwd: ROOT },
      );
    } catch (err) {
      /* Per-title failures inside the sync still leave a usable seed.sql for the rest. */
      syncError = String(err.message).split('\n')[0].slice(0, 200);
    }

    /* Only ever apply a seed.sql this run wrote - a stale file would carry an older,
       smaller scope and its deletes would take out everything imported since. */
    const fresh = existsSync(SEED) && statSync(SEED).mtimeMs >= startedAt - 2000;
    if (fresh) {
      wrangler(['d1', 'execute', 'anihub', '--remote', '--file', SEED]);
      const landed = new Set(
        d1Json(`SELECT id FROM anime WHERE id IN (${batch.map((b) => sqlText(b.id)).join(',')})`).map((r) => r.id),
      );
      for (const entry of batch) {
        if (landed.has(entry.id)) added.push({ id: entry.id, anilist: entry.anilist, kitsu: entry.kitsu, title: entry.title });
        else {
          removeSource(entry.id);
          failures.push(`${entry.title}: not present in D1 after apply${syncError ? ` (${syncError})` : ''}`);
        }
      }
    } else {
      for (const entry of batch) removeSource(entry.id);
      failures.push(`batch aborted: the sync left no fresh seed.sql${syncError ? ` (${syncError})` : ''}`);
    }
  }

  const value = JSON.stringify({ page, at: new Date().toISOString(), limit, scannedPages: scanned, added: added.length, skipped, failures });
  wrangler([
    'd1', 'execute', 'anihub', '--remote',
    '--command', `INSERT INTO sync_meta (key, value) VALUES ('backlog', ${sqlText(value)}) ON CONFLICT(key) DO UPDATE SET value = excluded.value;`,
  ]);
  return { due: true, page, added, skipped, failures };
}

/* ---------------- CLI ---------------- */

function logLine(line) {
  const dir = resolve(ROOT, 'logs');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  appendFileSync(resolve(dir, 'hourly-refresh.log'), `${new Date().toISOString()} ${line}\n`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename);
if (isMain) {
  const args = process.argv.slice(2);
  const limit = Number(args.find((a) => a.startsWith('--limit='))?.split('=')[1]) || BATCH;
  importBacklog({ limit })
    .then((result) => {
      const line = `backlog ok ${JSON.stringify({ page: result.page, added: result.added.map((a) => a.id), skipped: result.skipped.length, failures: result.failures })}`;
      console.log(line);
      logLine(line);
      if (result.failures.length) process.exitCode = 1;
    })
    .catch((err) => {
      const line = `backlog FAILED ${err.message}`;
      console.error(line);
      logLine(line);
      process.exitCode = 1;
    });
}
