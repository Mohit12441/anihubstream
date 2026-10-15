/* ============================================================
   AniHubStream — catalogue refresh pipeline, run from this machine
   (Windows Task Scheduler task "AniHubHourlyRefresh", every 30 minutes
   at logon).

   Why not the Cloudflare Worker in sync-worker/: AniList answers 403
   'You have been manually blocked' to Cloudflare's shared datacenter egress
   (verified 2026-10-13; AniList's API considerations page documents manual
   IP blocking of single addresses making excessive requests). This machine's
   residential address is not blocked, so the recurring job lives here and
   writes the same remote D1. The deployed worker keeps only its read-only
   /health endpoint; its cron trigger has been removed.

   Each run:
     1. Page(sort: TRENDING_DESC)          -> trend_rank per catalogue title
     2. batched Media(id:) x 8, one or two -> sched_* next-broadcast slots
     3. tools/discover-titles.mjs          -> when its 20h window is due, adds
        up to two currently-airing trending titles the catalogue lacks
     4. tools/import-backlog.mjs           -> imports the next 18 real titles
        from the AniList popularity backlog (15-20 per 30 minutes by design;
        its build is one sync-catalogue.mjs run + one D1 apply)

   Everything not returned by the source is written as NULL (no slot / not
   trending), never invented. A full rebuild stays manual:
   tools/sync-catalogue.mjs.
   ============================================================ */

import { discover, anilistSends, noteAnilistSend } from './discover-titles.mjs';
import { importBacklog } from './import-backlog.mjs';
import { seasonKey } from './season.mjs';

import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ANILIST = 'https://graphql.anilist.co';
const UA = 'AniHubStream hourly catalogue refresh';
const TRENDING_DEPTH = 50;
const DAY_LABEL = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

/* The global npm shim (wrangler.cmd) goes through the shell, and this environment's
   ComSpec is not a usable cmd.exe, so call wrangler's JS entry with node directly. */
const WRANGLER_JS =
  process.env.ANIHUB_WRANGLER_JS ??
  (process.env.APPDATA ? join(process.env.APPDATA, 'npm', 'node_modules', 'wrangler', 'bin', 'wrangler.js') : 'wrangler');

const sqlText = (v) => `'${String(v).replace(/'/g, "''")}'`;

function wrangler(args) {
  if (WRANGLER_JS.endsWith('.js')) {
    return execFileSync(process.execPath, [WRANGLER_JS, ...args], { encoding: 'utf8', windowsHide: true });
  }
  return execFileSync(WRANGLER_JS, args, { encoding: 'utf8', windowsHide: true });
}

async function anilist(query, variables) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    noteAnilistSend();   // same log discover-titles.mjs writes to, so one line covers the whole run
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

/* This title's position in AniList's global trending list, or NULL when it is not
   on the list at all. */
async function fetchTrending(titles) {
  const data = await anilist(
    `query($n: Int){ Page(page: 1, perPage: $n){ media(sort: TRENDING_DESC, type: ANIME, isAdult: false){ id } } }`,
    { n: TRENDING_DEPTH },
  );
  const media = data?.Page?.media ?? [];
  const position = new Map(media.map((m, i) => [m.id, i + 1]));
  let ranked = 0;
  const stmts = titles.map((t) => {
    const rank = position.get(t.anilist) ?? null;
    if (rank) ranked++;
    return `UPDATE anime SET trend_rank = ${rank ?? 'NULL'}, ${STAMP} WHERE id = ${sqlText(t.id)};`;
  });
  return { stmts, trendingListed: media.length, trendingRanked: ranked };
}

/* The next broadcast slot each title's AniList record publishes, formatted exactly
   like tools/sync-catalogue.mjs does (UTC day 1=Mon..7=Sun, 'Oct 20', '14:00').
   Every statement also re-stamps catalogue_synced_at — this task's own mark, never
   cloud_synced_at, which belongs to cloud-sync/. The pair is what proves the two writers
   stayed on disjoint columns during the handover. */
const STAMP = `catalogue_synced_at=CAST(strftime('%s','now') AS INTEGER) * 1000`;
async function fetchAiring(titles) {
  const stmts = [];
  let slotted = 0;
  for (let i = 0; i < titles.length; i += 8) {
    const chunk = titles.slice(i, i + 8);
    const data = await anilist(
      `query { ${chunk.map((t, j) => `m${j}: Media(id: ${t.anilist}, type: ANIME){ nextAiringEpisode{ airingAt } }`).join(' ')} }`,
    );
    chunk.forEach((t, j) => {
      const airingAt = data?.[`m${j}`]?.nextAiringEpisode?.airingAt;
      if (!airingAt) {
        stmts.push(`UPDATE anime SET sched_day=NULL, sched_day_label=NULL, sched_date=NULL, sched_time=NULL, sched_season=NULL, ${STAMP} WHERE id=${sqlText(t.id)};`);
        return;
      }
      const d = new Date(airingAt * 1000);
      slotted++;
      stmts.push(`UPDATE anime SET sched_day=${d.getUTCDay() === 0 ? 7 : d.getUTCDay()}, sched_day_label=${sqlText(DAY_LABEL[d.getUTCDay()])}, sched_date=${sqlText(`${d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })} ${d.getUTCDate()}`)}, sched_time=${sqlText(`${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`)}, sched_season=${sqlText(seasonKey(d))}, ${STAMP} WHERE id=${sqlText(t.id)};`);
    });
  }
  return { stmts, airingSlotted: slotted };
}

function logLine(line) {
  const dir = join(ROOT, 'logs');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, 'hourly-refresh.log'), `${new Date().toISOString()} ${line}\n`);
}

/* What this task actually did to AniList, in the only two numbers that matter: how many it asked
   for, and how tightly. `peak_per_minute` is the busiest sliding 60s window, which is the shape
   AniList's own limit is written against, and `min_gap_ms` is the tightest back-to-back pair.
   Nothing here paces anything — it is a measurement, so that a day of hourly-refresh.log can
   answer whether the residential IP is being burst at, which is the risk the cloud limiter cannot
   cover because it is not the process doing it. */
function anilistRate() {
  const at = [...anilistSends].sort((a, b) => a - b);
  if (!at.length) return { requests: 0 };
  let peak = 1;
  let minGap = null;
  for (let i = 0; i < at.length; i++) {
    let j = i;
    while (j < at.length && at[j] - at[i] < 60000) j++;
    peak = Math.max(peak, j - i);
    if (i) minGap = minGap === null ? at[i] - at[i - 1] : Math.min(minGap, at[i] - at[i - 1]);
  }
  return { requests: at.length, peak_per_minute: peak, min_gap_ms: minGap };
}

async function main() {
  const rowsRaw = JSON.parse(
    wrangler(['d1', 'execute', 'anihub', '--remote', '--json', '--command', 'SELECT id, source_ids FROM anime']),
  );
  const rows = rowsRaw.find((r) => Array.isArray(r.results))?.results ?? [];
  const titles = rows.flatMap((r) => {
    try {
      const anilistId = JSON.parse(r.source_ids ?? '{}').anilist;
      return Number.isInteger(anilistId) ? [{ id: r.id, anilist: anilistId }] : [];
    } catch {
      return [];
    }
  });

  const summary = { titles: titles.length };
  const failures = [];
  const stmts = [];
  for (const [name, task] of [['trending', fetchTrending], ['airing', fetchAiring]]) {
    try {
      const { stmts: outStmts, ...outStats } = await task(titles);
      stmts.push(...outStmts);
      Object.assign(summary, outStats);
    } catch (err) {
      failures.push(`${name}: ${err.message}`);
    }
  }

  try {
    const d = await discover({ rows });
    summary.discovery = d.due
      ? { added: d.added.map((a) => a.id), skipped: d.skipped.length, failures: d.failures }
      : 'not due';
    if (d.failures.length) failures.push(...d.failures.map((f) => `discovery: ${f}`));
  } catch (err) {
    failures.push(`discovery: ${err.message}`);
  }

  try {
    const b = await importBacklog();
    summary.backlog = { page: b.page, added: b.added.map((a) => a.id), skipped: b.skipped.length, failures: b.failures };
    if (b.failures.length) failures.push(...b.failures.map((f) => `backlog: ${f}`));
  } catch (err) {
    failures.push(`backlog: ${err.message}`);
  }

/* Taken after the last request and before the write, so it describes this run, and stored with the
   rest of the summary: sync_meta.hourly_sync is where a day of these lines accumulates. */
summary.anilist_rate = anilistRate();

  stmts.push(
    `INSERT INTO sync_meta (key, value) VALUES ('hourly_sync', ${sqlText(JSON.stringify({ at: new Date().toISOString(), source: 'operator-task', ...summary, failures }))}) ON CONFLICT(key) DO UPDATE SET value = excluded.value;`,
  );

  const dir = mkdtempSync(join(tmpdir(), 'anihub-refresh-'));
  try {
    const file = join(dir, 'refresh.sql');
    writeFileSync(file, stmts.join('\n'), 'utf8');
    wrangler(['d1', 'execute', 'anihub', '--remote', '--file', file]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  const line = `ok ${JSON.stringify(summary)}${failures.length ? ` failures=${JSON.stringify(failures)}` : ''}`;
  console.log(line);
  logLine(line);
  if (failures.length) process.exitCode = 1;
}

main().catch((err) => {
  const line = `FAILED ${err.message}`;
  console.error(line);
  logLine(line);
  process.exitCode = 1;
});
