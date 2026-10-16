// The Kitsu half of the cloud sync: artwork and episode counts for titles the AniList
// walk already owns.
//
// Rate-control relevance: Kitsu is the polite one — 100 requests/hour, and it does not
// block datacenter egress — so the constraint here is simply never exceeding its own
// limit. Requests are one-at-a-time with a 30 s floor between page starts, Retry-After is
// honoured exactly, and the run takes at most KITSU_PAGES_PER_RUN pages so a run cannot
// eat the whole hour. It has its own lease and its own api_usage budget row, so a Kitsu
// outage can't spend the AniList allowance or hold the AniList lock.
//
// It does not create titles: the columns this endpoint does not publish (genres, air
// slots, the AniList season) are NOT NULL in the catalogue schema, so a Kitsu-only insert
// would build a half-row. It enriches rows that already have a kitsu id in source_ids,
// which is exactly where the artwork keys come from.
//
//   node cloud-sync/sync-kitsu.mjs

import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { assertLiveColumns, assertLiveTables, d1All, insertRows, parseRetryAfter, schemaFaults } from './d1.mjs';
import {
  acquireLease, budget, getCursor, leaseKeeper, recordRun, releaseLease, setCursor, utcDay,
} from './state.mjs';
import { ANIME_COLUMNS, STATE_TABLES } from './sync-anilist.mjs';

const RUN_ID = randomUUID();
const ENDPOINT = 'kitsu';
const LEASE = 'kitsu';
const OWNER = `${ENDPOINT}-${RUN_ID}`;
const CURSOR_KEY = 'cloud_kitsu_cursor';

/* Validated, not coerced: `Number('four')` is NaN and NaN fails every comparison, so a typo in
   one of these would end the run having done nothing and report it as a finished pass. Same rule
   as cloud-sync/sync-anilist.mjs and d1.mjs. */
const intEnv = (name, fallback) => {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be a positive integer, got ${raw}`);
  return n;
};
const MIN_INTERVAL_MS = intEnv('KITSU_MIN_INTERVAL_MS', 30000);
const PAGE_SIZE = Math.min(20, intEnv('KITSU_PAGE_SIZE', 20));
/* The two numbers have to agree with each other, and did not: the job fires twice an hour, so 4
   pages per run needs 8 requests an hour and 192 a day. A budget under that is not a safety margin,
   it is a hidden stop — the run still takes the lease, still spends a Kitsu request to discover it
   is out, and does no artwork work for the rest of the day.
   RUNS_PER_DAY is the schedule in .github/workflows/kitsu-sync.yml written down once. It cannot be
   read at runtime — a runner does not know what cron it was woken by — so it is a constant, and
   rate.test.mjs parses the cron out of that file and fails if the two disagree. Editing the cron
   without editing this is therefore a test failure rather than a budget that quietly stops
   matching the schedule, which is the same class of bug as the 80 that was here before. */
export const RUNS_PER_DAY = intEnv('KITSU_RUNS_PER_DAY', 48);   // `15,45 * * * *` × 24
const PAGES_PER_RUN = intEnv('KITSU_PAGES_PER_RUN', 4);
const DAILY_BUDGET = intEnv('KITSU_DAILY_BUDGET', RUNS_PER_DAY * PAGES_PER_RUN + 8);
const MAX_ITEMS = intEnv('MAX_ITEMS_PER_RUN', 1000);
const TIMEOUT_MS = intEnv('KITSU_TIMEOUT_MS', 30000);
const UA = process.env.KITSU_USER_AGENT ?? 'AniHubStream/1.0 (catalogue sync; contact: https://anihubstream.com/about)';
const BASE = process.env.KITSU_BASE_URL ?? 'https://kitsu.io/api/edge';

const startedAt = Date.now();

const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

/**
 * One serial request loop — no Promise.anywhere in parallel, and the spacing is measured
 * from the previous page's start so a fast response cannot make the next one early.
 */
async function getJSON(url, { lastStartAt, stats }) {
  const wait = MIN_INTERVAL_MS - (Date.now() - lastStartAt);
  if (wait > 0) await sleep(wait);
  const startAt = Date.now();
  const res = await fetch(url, { headers: { accept: 'application/vnd.api+json', 'user-agent': UA }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  stats.requests++;
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* an HTML error page from a busy CDN */ }
  return { res, body, startAt, text };
}

async function fetchPage(offset, stats) {
  const url = `${BASE}/anime?page%5Blimit%5D=${PAGE_SIZE}&page%5Boffset%5D=${offset}` +
    `&sort=-averageRating&fields%5Banime%5D=id,posterImage,coverImage,episodeCount`;
  for (let attempt = 1; attempt <= 5; attempt++) {
    let fetched;
    try {
      fetched = await getJSON(url, { lastStartAt: stats.lastStartAt, stats });
    } catch (err) {
      const backoff = Math.min(120000, 5000 * attempt);
      console.warn(`[kitsu] network fault on attempt ${attempt}: ${err.message}; waiting ${backoff / 1000}s`);
      stats.backoffs++;
      await sleep(backoff);
      continue;
    }
    stats.lastStartAt = fetched.startAt;
    if (fetched.res.ok && fetched.body) return fetched.body;

    if (fetched.res.status === 429) {
      /* Kitsu says how long to wait; that is authoritative, so take it over any guess. */
      const retryAfter = parseRetryAfter(fetched.res.headers.get('retry-after'));
      const wait = retryAfter !== null && retryAfter > 0 ? retryAfter : MIN_INTERVAL_MS * attempt;
      console.warn(`[kitsu] 429 on attempt ${attempt}: waiting ${Math.round(wait / 1000)}s`);
      stats.s429++;
      stats.backoffs++;
      await sleep(Math.max(wait, MIN_INTERVAL_MS));
      continue;
    }
    if (fetched.res.status === 400 || fetched.res.status === 404) {
      throw new Error(`kitsu: HTTP ${fetched.res.status} permanent error: ${fetched.text.slice(0, 160)}`);
    }
    if (fetched.res.status === 403) {
      stats.s403++;
      console.warn('[kitsu] 403: throttled or challenged; backing off before retry');
      stats.backoffs++;
      await sleep(Math.min(120000, MIN_INTERVAL_MS * attempt));
      continue;
    }
    if (fetched.res.status >= 500) {
      stats.backoffs++;
      await sleep(Math.min(120000, MIN_INTERVAL_MS * attempt));
      continue;
    }
    throw new Error(`kitsu: HTTP ${fetched.res.status} ${fetched.text.slice(0, 160)}`);
  }
  throw new Error('kitsu: page failed after 5 attempts');
}

/** Kitsu rows that matter to us: those whose id already appears in the catalogue. */
async function catalogueByKitsuId() {
  const rows = await d1All('SELECT id, source_ids FROM anime WHERE source_ids IS NOT NULL');
  const map = new Map();
  for (const r of rows) {
    try {
      const kitsu = JSON.parse(r.source_ids ?? '{}').kitsu;
      if (Number.isInteger(kitsu)) map.set(kitsu, r.id);
    } catch { /* a row with unreadable provenance is simply not matchable this run */ }
  }
  return map;
}

const artOf = (a) => {
  const p = a.posterImage ?? {};
  return p.larger || p.full || p.large || p.medium || p.original || null;
};
const coverOf = (a) => {
  const c = a.coverImage ?? {};
  return c.larger || c.full || c.large || c.medium || null;
};

let stopRequested = false;
process.on('SIGTERM', () => { stopRequested = true; });
process.on('SIGINT', () => { stopRequested = true; });

const summary = {
  run_id: RUN_ID,
  endpoint: ENDPOINT,
  items_processed: 0,
  requests_made: 0,
  s403: 0,
  s429: 0,
  breaker_opens: 0,
  effective_interval_ms: MIN_INTERVAL_MS,
  budget_remaining: 0,
  extra_columns: 0,
  /* Which read answered the column probe — 'pragma_table_info', or 'sqlite_master' when the
     endpoint refused the table-valued SELECT and the columns came from parsed DDL. */
  schema_via: null,
  cursor: null,
  duration_ms: 0,
  exit_reason: 'fatal',
};

async function main() {
  /* The same gate the AniList run applies, for the same reason: this job names every ANIME_COLUMNS
     column in its SELECT and in its INSERT, so a column production lacks fails the whole page
     rather than one row — and it fails after the lease is held. Same table check too, against the
     four state tables this job reaches through state.mjs: it reads neither the queue nor the genre
     tables, so requiring those would gate it on someone else's rollout. Same split, as well: a
     failed probe and a disagreeing schema are different afternoons, so they get different exit
     reasons and codes. */
  let columns;
  let tables;
  try {
    columns = await assertLiveColumns({ columns: ANIME_COLUMNS });
    tables = await assertLiveTables({ tables: STATE_TABLES });
  } catch (err) {
    summary.exit_reason = 'schema_probe_failed';
    summary.error = `could not read the live schema (${err.message}) — this says nothing about the schema; verify.mjs runs the same probe and reports it on its own`;
    summary.duration_ms = Date.now() - startedAt;
    await recordRun({ runId: RUN_ID, endpoint: ENDPOINT, startedAt, durationMs: summary.duration_ms, exitReason: 'schema_probe_failed', summary })
      .catch((recErr) => console.warn(`WARN run record failed: ${recErr.message}`));
    console.log(JSON.stringify(summary));
    process.exitCode = 2;
    return;
  }
  summary.schema_via = columns.via;
  summary.extra_columns = columns.extra.length;
  const fault = schemaFaults({ columns, tables });
  if (fault) {
    summary.exit_reason = fault.reason;
    summary.error = fault.error;
    summary.duration_ms = Date.now() - startedAt;
    /* Recorded, best effort, for the same reason the AniList side records it: the gate is worth
       nothing to an operator if the only evidence is a Actions run nobody opened. */
    await recordRun({ runId: RUN_ID, endpoint: ENDPOINT, startedAt, durationMs: summary.duration_ms, exitReason: fault.reason, summary })
      .catch((err) => console.warn(`WARN run record failed: ${err.message}`));
    console.log(JSON.stringify(summary));
    process.exitCode = 1;
    return;
  }

  if (!(await acquireLease(LEASE, OWNER))) {
    summary.exit_reason = 'lease_held';
    summary.duration_ms = Date.now() - startedAt;
    console.log(JSON.stringify(summary));
    return;
  }

  const spend = budget(ENDPOINT, DAILY_BUDGET, { day: utcDay() });
  const touch = leaseKeeper(LEASE, OWNER);
  const stats = { requests: 0, s403: 0, s429: 0, backoffs: 0, lastStartAt: 0 };
  let cursor = (await getCursor(CURSOR_KEY)) ?? { offset: 0 };
  summary.cursor = cursor;
  console.log(`run ${RUN_ID}: kitsu offset ${cursor.offset}, budget ${await spend.remaining()}/${DAILY_BUDGET}, ${MIN_INTERVAL_MS}ms between pages`);

  const byKitsu = await catalogueByKitsuId();
  let exitReason = 'complete';
  let pages = 0;
  try {
    while (pages < PAGES_PER_RUN && summary.items_processed < MAX_ITEMS) {
      if (stopRequested) { exitReason = 'signal'; break; }
      if (!(await spend.reserve())) { exitReason = 'budget_exhausted'; break; }

      const doc = await fetchPage(cursor.offset, stats);
      const data = doc.data ?? [];
      const hits = data.filter((e) => byKitsu.has(Number(e.id)));

      if (hits.length) {
        /* Read the full row and patch only the columns Kitsu owns, so the upsert always
           writes a complete record — a partial INSERT would fail NOT NULL on any row that
           happens not to conflict. */
        const ids = hits.map((e) => byKitsu.get(Number(e.id)));
        const existing = await d1All(`SELECT ${ANIME_COLUMNS.join(',')} FROM anime WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
        const byId = new Map(existing.map((r) => [r.id, r]));
        const rows = [];
        for (const e of hits) {
          const r = byId.get(byKitsu.get(Number(e.id)));
          if (!r) continue;
          const a = e.attributes ?? {};
          const sourceIds = { ...safeJson(r.source_ids), kitsu: Number(e.id) };
          rows.push(ANIME_COLUMNS.map((c) => {
            if (c === 'art') return artOf(a) ?? r.art;
            if (c === 'key_art') return coverOf(a) ?? r.key_art;
            if (c === 'episode_total') return Number.isInteger(a.episodeCount) && a.episodeCount > 0 ? a.episodeCount : r.episode_total;
            if (c === 'source_ids') return JSON.stringify(sourceIds);
            return r[c];
          }));
        }
        if (rows.length) {
          await insertRows({
            table: 'anime',
            columns: ANIME_COLUMNS,
            rows,
            conflictTarget: ['id'],
            update: ['art', 'key_art', 'episode_total', 'source_ids'],
            /* Same protection as the AniList side: provenance is merged in SQLite, so a
               mal/anilist id the other writer added after our read is not dropped. */
            jsonMerge: ['source_ids'],
          });
          summary.items_processed += rows.length;
        }
      }

      pages++;
      /* Kitsu answers with an absolute links.next; its offset is what we persist, so a
         run resumes exactly where the API said the next page starts rather than at an
         offset we guessed from our own page size. */
      const nextUrl = doc.links?.next ?? null;
      const nextOffset = nextUrl ? Number(new URL(nextUrl).searchParams.get('page[offset]')) : NaN;
      cursor = data.length
        ? { offset: Number.isInteger(nextOffset) ? nextOffset : cursor.offset + PAGE_SIZE }
        : { offset: 0 };
      await setCursor(CURSOR_KEY, cursor);
      await touch();
      summary.cursor = cursor;
      if (!data.length) { exitReason = 'catalogue_end'; break; }
    }
    if (exitReason === 'complete') exitReason = pages >= PAGES_PER_RUN ? 'page_cap' : 'item_cap';
  } catch (err) {
    if (/budget/i.test(err.message)) exitReason = 'budget_exhausted';
    else if (/lease/.test(err.message)) exitReason = 'lease_lost';
    else { exitReason = 'fatal'; summary.error = err.message.slice(0, 400); }
  } finally {
    summary.exit_reason = exitReason;
    summary.pages = pages;
    summary.requests_made = stats.requests;
    summary.s429 = stats.s429;
    summary.s403 = stats.s403;
    summary.backoffs = stats.backoffs;
    summary.catalogue_matched = byKitsu.size;
    summary.budget_remaining = await spend.remaining().catch(() => 0);
    summary.duration_ms = Date.now() - startedAt;
    await releaseLease(LEASE, OWNER).catch((err) => console.warn(`WARN lease release failed: ${err.message}`));
    await recordRun({ runId: RUN_ID, endpoint: ENDPOINT, startedAt, durationMs: summary.duration_ms, exitReason, summary })
      .catch((err) => console.warn(`WARN run record failed: ${err.message}`));
    console.log(JSON.stringify(summary));
  }
  if (exitReason === 'fatal' || exitReason === 'lease_lost') process.exitCode = 1;
}

const safeJson = (v) => {
  try { return JSON.parse(v ?? '{}'); } catch { return {}; }
};

const invokedDirectly = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (invokedDirectly) {
  main().catch((err) => {
    console.log(JSON.stringify({ ...summary, exit_reason: 'fatal', error: err.message.slice(0, 400), duration_ms: Date.now() - startedAt }));
    process.exitCode = 1;
  });
}
