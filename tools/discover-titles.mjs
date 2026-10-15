/* ============================================================
   tools/discover-titles.mjs — grows the catalogue from this machine.

   Why from here: AniList answers 403 "manually blocked" to Cloudflare's
   shared egress (see tools/hourly-refresh.mjs), so the operator machine
   runs the recurring jobs. This tool runs as a step of the hourly refresh
   and adds up to `limit` (default 2) currently-airing trending titles per
   day that the catalogue does not already carry. Per candidate:

     1. candidate    AniList Page(sort: TRENDING_DESC, status: RELEASING),
                     minus every AniList id already in D1
     2. mapping      AniList's idMal -> Kitsu's own MAL mapping lookup.
                     No mapping, or a start year more than one off the
                     AniList season year -> skipped, never guessed from a
                     fuzzy title search
     3. build        tools/sync-catalogue.mjs --title=<new id> does the
                     actual work (Kitsu episodes/art, AniSkip windows under
                     the same three-episode length-agreement check), then
                     its seed.sql is applied to remote D1
     4. bookkeeping  the entry is appended to tools/catalogue-sources.json
                     so later full syncs keep the title, and sync_meta
                     'discovery' records what ran. A candidate that fails
                     any step is removed again and reported — never left
                     half-added, and nothing is invented.

   The 20-hour window in sync_meta keeps growth at a curated pace; --force
   overrides it for a manual run. Run by hand:

     node tools/discover-titles.mjs                 # due check + up to 2
     node tools/discover-titles.mjs --limit=4 --force
   ============================================================ */

import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const ANILIST = 'https://graphql.anilist.co';
const UA = 'AniHubStream hourly catalogue refresh';
const SOURCES = resolve(ROOT, 'tools/catalogue-sources.json');
const SEED = resolve(ROOT, 'seed.sql');
const DISCOVERY_WINDOW_MS = 20 * 60 * 60 * 1000;
const CANDIDATE_DEPTH = 30;

/* The global npm shim (wrangler.cmd) goes through the shell, and this environment's
   ComSpec is not a usable cmd.exe, so call wrangler's JS entry with node directly. */
const WRANGLER_JS =
  process.env.ANIHUB_WRANGLER_JS ??
  (process.env.APPDATA ? resolve(process.env.APPDATA, 'npm', 'node_modules', 'wrangler', 'bin', 'wrangler.js') : 'wrangler');

const sqlText = (v) => `'${String(v).replace(/'/g, "''")}'`;

export function wrangler(args) {
  if (WRANGLER_JS.endsWith('.js')) {
    return execFileSync(process.execPath, [WRANGLER_JS, ...args], { encoding: 'utf8', windowsHide: true, cwd: ROOT });
  }
  return execFileSync(WRANGLER_JS, args, { encoding: 'utf8', windowsHide: true, cwd: ROOT });
}

/* Every AniList POST this process makes, whichever module sent it. The hourly task has no pacing
   of its own — cloud-sync/anilist.mjs's limiter does not cover it, because they are different
   processes on different IPs — and it is the writer Phase 3 rolls *back* to, so whether it bursts
   is worth knowing before, not after, it gets the residential IP throttled. Recorded here because
   both this file and import-backlog.mjs send through this function; hourly-refresh.mjs reports it. */
export const anilistSends = [];
export const noteAnilistSend = (at = Date.now()) => (anilistSends.push(at), at);

export async function anilist(query, variables) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    noteAnilistSend();
    const res = await fetch(ANILIST, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', 'user-agent': UA },
      body: JSON.stringify(variables ? { query, variables } : { query }),
    });
    if (res.status === 429 || res.status >= 500) {
      if (attempt === 3) throw new Error(`anilist answered ${res.status}`);
      const backoff = Number(res.headers.get('retry-after')) * 1000 || 1500 * attempt;
      await new Promise((r) => setTimeout(r, backoff));
      continue;
    }
    const body = await res.json();
    if (!res.ok || body.errors) throw new Error(`anilist -> ${res.status} ${JSON.stringify(body.errors ?? body).slice(0, 200)}`);
    return body.data;
  }
}

export const slugify = (s) => {
  const slug = String(s)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug.length <= 60) return slug;
  const cut = slug.slice(0, 60);
  return (cut.includes('-') ? cut.slice(0, cut.lastIndexOf('-')) : cut).replace(/-+$/, '');
};

/* Kitsu's own commutative mapping table: MAL id in -> this title's Kitsu row out.
   Deterministic cross-id mapping, so a wrong-title match cannot happen the way a
   free-text search could; the start-year guard covers stale mappings. */
export async function kitsuByMal(malId) {
  const url = `https://kitsu.io/api/edge/mappings?filter%5BexternalSite%5D=myanimelist%2Fanime&filter%5BexternalId%5D=${malId}&include=item`;
  const res = await fetch(url, { headers: { accept: 'application/vnd.api+json', 'user-agent': UA } });
  if (!res.ok) throw new Error(`kitsu mappings ${malId} -> ${res.status}`);
  const body = await res.json();
  const items = (body.included || []).filter((x) => x.type === 'anime');
  if (!items.length) return null;
  const at = items[0].attributes || {};
  return {
    kitsuId: Number(items[0].id),
    year: Number(String(at.startDate || '').slice(0, 4)) || null,
  };
}

export function readSources() {
  return JSON.parse(readFileSync(SOURCES, 'utf8'));
}

/* Keeps the file's existing one-entry-per-line shape: insert before the closing bracket. */
export function appendSource(entry) {
  const text = readFileSync(SOURCES, 'utf8');
  const close = text.lastIndexOf(']');
  if (close < 0) throw new Error('catalogue-sources.json has no closing bracket');
  const head = text.slice(0, close).replace(/\s*$/, '');
  const sep = head.endsWith('[') ? '\n' : ',\n';
  const line = `  ${JSON.stringify(entry)}`;
  writeFileSync(SOURCES, `${head}${sep}${line}\n${text.slice(close)}`, 'utf8');
}

export function removeSource(id) {
  const list = readSources().filter((t) => t.id !== id);
  writeFileSync(SOURCES, `${JSON.stringify(list, null, 2)}\n`, 'utf8');
}

export function d1Json(command) {
  const out = wrangler(['d1', 'execute', 'anihub', '--remote', '--json', '--command', command]);
  const parsed = JSON.parse(out);
  return parsed.find((r) => Array.isArray(r.results))?.results ?? [];
}

/* Returns { due, added:[{id,anilist,kitsu,title}], skipped:[reason], failures:[reason] }.
   `rows` ({id, source_ids} straight from D1) may be passed by the caller to skip a
   redundant read; the standalone CLI fetches them itself. */
export async function discover({ rows = null, limit = 2, force = false } = {}) {
  const record = d1Json("SELECT value FROM sync_meta WHERE key = 'discovery'");
  const last = record[0]?.value ? JSON.parse(record[0].value) : null;
  if (!force && last?.at && Date.now() - Date.parse(last.at) < DISCOVERY_WINDOW_MS) {
    return { due: false, added: [], skipped: [], failures: [] };
  }

  const animeRows = rows ?? d1Json('SELECT id, source_ids FROM anime');
  const anilistIds = new Set();
  const ids = new Set();
  for (const r of animeRows) {
    ids.add(r.id);
    try {
      const a = JSON.parse(r.source_ids ?? '{}').anilist;
      if (Number.isInteger(a)) anilistIds.add(a);
    } catch {
      /* a row whose provenance is unreadable still owns its id — dedupe by slug covers it */
    }
  }

  const data = await anilist(
    `query($n: Int){ Page(page: 1, perPage: $n){ media(sort: TRENDING_DESC, type: ANIME, status: RELEASING, isAdult: false){ id idMal seasonYear title{ romaji english } } } }`,
    { n: CANDIDATE_DEPTH },
  );
  const candidates = (data?.Page?.media ?? []).filter((m) => !anilistIds.has(m.id));

  const skipped = [];
  const added = [];
  const failures = [];
  const newEntries = [];
  for (const cand of candidates) {
    if (added.length >= limit) break;
    const label = cand.title?.english || cand.title?.romaji || `anilist ${cand.id}`;

    if (!cand.idMal) {
      skipped.push(`${label}: no MAL id to map through`);
      continue;
    }
    let kitsu;
    try {
      kitsu = await kitsuByMal(cand.idMal);
    } catch (err) {
      failures.push(`${label}: ${err.message}`);
      continue;
    }
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

    const entry = { id, kitsu: kitsu.kitsuId, anilist: cand.id, note: `discovered ${new Date().toISOString().slice(0, 10)} from the AniList trending list (status RELEASING)` };
    appendSource(entry);
    try {
      execFileSync(process.execPath, [resolve(ROOT, 'tools/sync-catalogue.mjs'), `--title=${id}`], {
        encoding: 'utf8',
        windowsHide: true,
        cwd: ROOT,
      });
      if (!existsSync(SEED)) throw new Error('sync wrote no seed.sql');
      wrangler(['d1', 'execute', 'anihub', '--remote', '--file', SEED]);
    } catch (err) {
      removeSource(id);
      failures.push(`${label}: build failed (${String(err.message).split('\n')[0].slice(0, 160)})`);
      continue;
    }
    ids.add(id);
    anilistIds.add(cand.id);
    added.push({ id, anilist: cand.id, kitsu: kitsu.kitsuId, title: label });
    newEntries.push(entry);
  }

  const value = JSON.stringify({ at: new Date().toISOString(), limit, added, skipped, failures });
  wrangler([
    'd1', 'execute', 'anihub', '--remote',
    '--command', `INSERT INTO sync_meta (key, value) VALUES ('discovery', ${sqlText(value)}) ON CONFLICT(key) DO UPDATE SET value = excluded.value;`,
  ]);
  return { due: true, added, skipped, failures };
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
  const limit = Number(args.find((a) => a.startsWith('--limit='))?.split('=')[1]) || 2;
  discover({ limit, force: args.includes('--force') })
    .then((result) => {
      const line = `discovery ok ${JSON.stringify(result)}`;
      console.log(line);
      logLine(line);
      if (result.failures.length) process.exitCode = 1;
    })
    .catch((err) => {
      const line = `discovery FAILED ${err.message}`;
      console.error(line);
      logLine(line);
      process.exitCode = 1;
    });
}
