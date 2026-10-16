// Read-only audit of what the sync has actually done to the live database. Nothing here writes a
// row: every statement is a SELECT, so it is safe to run at any moment, including while a sync is
// in flight. Run it from the ops workflow (Actions → cloud-ops → report) or by hand:
//
//   node --env-file=.env cloud-sync/verify.mjs
//
// `--probe` runs just the schema gate (Actions → cloud-ops → probe): the same reads the sync makes
// before it takes its lease, printed as the buckets this mode depends on **and the raw rows each
// answer was computed from** — `columns.raw`, `tables.raw` — so the verdict ships with its
// evidence: a wrong bucket is visible next to the right rows, instead of three readers inheriting
// the same bug in the shared helper. That is what step 2 of cloud-sync/README.md collects, so the
// artifact an operator reads is written by the check that will later refuse the run, not by an
// eyeball comparing a dump.
//
// It answers the question the four-phase migration turns on — is there still exactly one writer
// per column? — using the two stamps on `anime`, plus the checks the stamps cannot see: vocabulary
// that no longer matches the API's filters, rows the browse queries cannot reach, and rate-control
// state that has quietly stopped moving.
//
// Every query here is real SQL executed by SQLite, in production by D1 and in
// cloud-sync/migration.test.mjs against a throwaway database, so a typo surfaces in a test rather
// than in front of an operator.

import { pathToFileURL } from 'node:url';
import { assertLiveColumns, assertLiveTables, d1All, d1First, schemaFaults } from './d1.mjs';
import { ANIME_COLUMNS, CLAIMS_SCHEDULE, CREATES_ROWS, FILL_SCHEDULE, LEGACY_QUIET_MS, MODE, requiredTablesFor } from './sync-anilist.mjs';
import { recentRuns, utcDay } from './state.mjs';

/* The closed lists the Worker validates against — functions/api/anime/index.js:24-25 and
 * functions/api/schedule.js:9, matched there with an exact `=`, and pinned against this copy in
 * cloud-sync/rate.test.mjs. A value outside them is not cosmetic: the title silently leaves that
 * facet. */
export const KINDS = ['TV', 'Movie', 'OVA', 'ONA', 'Special'];
export const STATUSES = ['Ongoing', 'Finished', 'Upcoming'];
export const SEASON_WORDS = ['Winter', 'Spring', 'Summer', 'Fall'];

/** The exit_reasons that mean a human should look, as opposed to a run that stopped on purpose. */
const ALARM = ['fatal', 'lease_lost', 'legacy_still_running', 'breaker_aborted', 'schema_mismatch', 'schema_unwritable', 'schema_probe_failed'];

/* budget_exhausted is deliberately not in ALARM: it exits 0 and one stop is a normal end to a busy
   day. A streak is the failure — the counter resets at UTC midnight, so N consecutive stops mean
   each fresh day is spent before the schedule does any work, which is what a budget scoped below
   the cadence looks like (an ANILIST_DAILY_BUDGET Variable set for one scoped run and never
   deleted). The audit reads the streak in the run history; this constant is its N.
   Calibrated against the default 4000, which a day of ticks spends a fraction of: an honest day
   cannot exhaust before deep into the evening, so a three-stop streak (the first stop by ~22:30
   UTC) fires there deliberately — it means the budget is sized below the schedule. Lower the budget
   on purpose toward the cadence and a late-day stop stops being an anomaly: retune N here rather
   than read the alarm as a bug. */
const BUDGET_STREAK_ALARM = 3;

/** Pull the fields an alert is written against out of a run's stored summary JSON. */
function runLine(summary) {
  try {
    const s = JSON.parse(summary);
    return {
      mode: s.mode, fill_schedule: s.fill_schedule, items_processed: s.items_processed, created: s.created, requests_made: s.requests_made,
      s403: s.s403, s429: s.s429, breaker_opens: s.breaker_opens, skipped: s.skipped, schema_via: s.schema_via,
      effective_interval_ms: s.effective_interval_ms, budget_remaining: s.budget_remaining, error: s.error,
    };
  } catch {
    return {};
  }
}

/**
 * Run the audit. Returns `{ mode, checks, state, ok, failures }`; `ok` is false when a hard
 * invariant broke, which is what the CLI turns into exit code 1. Nothing is thrown at the caller
 * for a failing check — the report is the answer, and a partial report is still worth reading.
 *
 * `overrides` exists for callers that already know which phase is live — the tests, and anything
 * that wants to audit a hypothetical mode. With none, the three mode facts come from this module's
 * own environment, read once at import like the sync's.
 */
export async function audit(overrides = {}) {
  const mode = overrides.mode ?? MODE;
  const createsRows = overrides.createsRows ?? CREATES_ROWS;
  const claimsSchedule = overrides.claimsSchedule ?? CLAIMS_SCHEDULE;
  const fillSchedule = overrides.fillSchedule ?? FILL_SCHEDULE;
  const report = {
    mode, checked_at: new Date().toISOString(), checks: [], failures: [], ok: true,
    /* The phase facts every mode-dependent check below keys off, recorded once so the report says
       which answers it was written under. `state.columns` is the column contract's, set below. */
    state: { phase: { creates_rows: createsRows, claims_schedule: claimsSchedule, fills_empty_schedule: fillSchedule } },
  };
  const count = async (sql, ...params) => (await d1First(sql, params))?.n ?? 0;
  const add = (id, ok, detail, { hard = true, why = '' } = {}) => {
    report.checks.push({ id, ok, detail, hard, why });
    if (!ok) {
      report.failures.push(`${hard ? 'FAIL' : 'WARN'} ${id}: ${detail}${why ? ` — ${why}` : ''}`);
      if (hard) report.ok = false;
    }
  };

  /* ------------------------------------------------------------ column contract */

  /* The same comparison the sync makes before it takes its lease, so an operator can read the
     answer without starting a run. Two separate questions, because the sync answers them with two
     different exit reasons: a probe that cannot run at all (the endpoint refused the statement, the
     credentials are wrong) says nothing about the schema and is reported as its own failure, while a
     probe that ran and disagreed is the mismatch. Everything below this section selects anime's
     columns by name, so the shape is settled first: if the probe answered and a column is missing,
     the report names it before any query after it can throw. The tables ride the same try: both
     probes go over one endpoint, so if either cannot read, the operator wants one failure line about
     the endpoint, not two. `requiredTablesFor` is the sync's own call — the queue table is only
     required of the modes that read it, and an audit that asked for a different set than the run
     would audit a configuration nobody is in. */
  let shape = null;
  let tableShape = null;
  const required = requiredTablesFor(createsRows);
  try {
    shape = await assertLiveColumns({ columns: ANIME_COLUMNS });
    tableShape = await assertLiveTables({ tables: required });
  } catch (err) {
    report.state.columns = { wanted: ANIME_COLUMNS.length, error: err.message };
    add('the live schema is readable', false, `the probe failed: ${err.message}`,
      { why: 'run ops → probe against production — the sync gate asks the same question, so every run exits schema_probe_failed (not schema_mismatch, which would send you hunting a column that is not missing) until this reads' });
  }
  if (shape) {
    report.state.columns = { wanted: ANIME_COLUMNS.length, missing: shape.missing, extra: shape.extra, unwritable: shape.unwritable, via: shape.via };
    add('anime has every column the sync writes by name', shape.missing.length === 0,
      shape.missing.length ? `missing: ${shape.missing.join(', ')}` : `${ANIME_COLUMNS.length} named columns present (${shape.extra.length} extra, owned by the local tools; probe read via ${shape.via})`,
      { why: 'apply cloud-sync/schema.sql, or fix ANIME_COLUMNS in cloud-sync/sync-anilist.mjs — a sync run exits schema_mismatch on this until one of them happens' });
    /* The extra that is not benign. insertRows() omits every column it does not own, so a NOT NULL
       extra with no default fails each chunk on the constraint while a check that only counted
       extras would call the schema clean. This is the same bucket the sync gate refuses on, read
       through the same helper, so the audit and the run cannot disagree about which extras are fatal. */
    add('no extra column is NOT NULL without a default', shape.unwritable.length === 0,
      shape.unwritable.length ? `unwritable: ${shape.unwritable.join(', ')}` : `${shape.extra.length} extra columns, all nullable or defaulted`,
      { why: 'give the column a default or make it nullable — the sync gate exits schema_unwritable (not schema_mismatch; nothing is missing) on this shape until one of them happens' });
  }
  if (tableShape) {
    report.state.tables = { required, missing: tableShape.missing };
    add('every table the sync reaches for exists', tableShape.missing.length === 0,
      tableShape.missing.length ? `missing: ${tableShape.missing.join(', ')}`
        : `${required.length} tables present${createsRows ? '' : " (sync_pending not required in this mode's set)"}`,
      { why: 'run ops → apply-schema with cloud-sync/schema.sql — an applied subset is normal mid-rollout, but a sync run reaches every table in its set and exits schema_mismatch naming the missing one' });
  }

  /* ---------------------------------------------------------- ownership stamps */

  /* The two stamps are the proof of disjointness. Each writer sets only its own, so a row's pair
     of timestamps says who has touched it and when — and in Phase 1 a row carrying ONLY the
     cloud's stamp is, by construction, a row the cloud inserted. */
  report.state.stamps = await d1All(`
    SELECT CASE
             WHEN catalogue_synced_at IS NOT NULL AND cloud_synced_at IS NOT NULL THEN 'both'
             WHEN catalogue_synced_at IS NOT NULL THEN 'local_only'
             WHEN cloud_synced_at IS NOT NULL THEN 'cloud_only'
             ELSE 'unattributed'
           END AS touched, count(*) AS rows,
           min(cloud_synced_at) AS first_cloud, max(cloud_synced_at) AS last_cloud
    FROM anime GROUP BY touched ORDER BY rows DESC`);

  const cloudCreated = await count(`SELECT count(*) AS n FROM anime
    WHERE catalogue_synced_at IS NULL AND cloud_synced_at IS NOT NULL`);
  report.state.cloud_created_rows = cloudCreated;
  if (mode === 'mirror') {
    add('Phase 1 never created a row', cloudCreated === 0, `${cloudCreated} rows carry only a cloud stamp`,
      { why: 'mirror must not insert — check CLOUD_CREATES_ROWS is not 1 and MODE is not delta/takeover' });
  }

  const unattributed = await count(`SELECT count(*) AS n FROM anime
    WHERE catalogue_synced_at IS NULL AND cloud_synced_at IS NULL`);
  add('every row has been refreshed by someone', unattributed === 0, `${unattributed} rows predate both stamps`,
    { hard: false, why: 'seeded rows cannot be attributed to anyone; a pass is what gives them a stamp' });

  /* The handover test, and the query the runbook quotes. Once this job claims sched_* and
     trend_rank, a row stamped by the local tools AFTER the takeover marker is a second writer on
     a column this job believes it owns. */
  const markerRow = await d1First(`SELECT value FROM sync_meta WHERE key = 'cloud_takeover'`);
  let markerAt = 0;
  try { markerAt = JSON.parse(markerRow?.value ?? '{}').at ?? 0; } catch { markerAt = 0; }
  report.state.takeover_marker = markerAt || null;
  if (claimsSchedule) {
    const took = await count('SELECT count(*) AS n FROM anime WHERE ?1 > 0 AND catalogue_synced_at > ?1', markerAt);
    add('no local write after the takeover marker', markerAt > 0 && took === 0,
      markerAt === 0
        ? 'takeover is claimed but sync_meta has no cloud_takeover marker'
        : `${took} rows stamped by the local task after the handover`,
      { why: 'disable AniHubHourlyRefresh, or go back to MODE=mirror — two writers on sched_* flip-flops the shelf' });
  }

  const heartbeat = await d1First(`SELECT value FROM sync_meta WHERE key = 'hourly_sync'`);
  let heartbeatAt = 0;
  try { heartbeatAt = Date.parse(JSON.parse(heartbeat?.value ?? '{}').at) || 0; } catch { heartbeatAt = 0; }
  report.state.hourly_sync_heartbeat = heartbeatAt || null;
  const heartbeatAgeMs = heartbeatAt ? Date.now() - heartbeatAt : null;
  report.state.hourly_sync_heartbeat_age_ms = heartbeatAgeMs;
  if (!claimsSchedule && heartbeatAgeMs !== null && heartbeatAgeMs < LEGACY_QUIET_MS) {
    report.state.local_task_still_running = true;
  }

  /* The inverse of the handover test above, and the failure mode that test cannot see. `mirror` and
     `delta` leave sched_* and trend_rank to the local task, and takeover claims them — so a
     database where the heartbeat has gone stale WHILE the mode does not claim the columns has no
     schedule writer at all. Nothing else here would notice: the shelf keeps displaying whatever it
     froze on. `LEGACY_WRITER_ACTIVE=0` without `MODE=takeover` is how an operator gets here. */
  if (!claimsSchedule) {
    add('someone still owns the schedule shelf', heartbeatAgeMs !== null && heartbeatAgeMs < LEGACY_QUIET_MS,
      heartbeatAt
        ? `hourly_sync last beat ${Math.round(heartbeatAgeMs / 60000)} minutes ago, while mode '${mode}' leaves sched_* to it${fillSchedule ? ' (CLOUD_OWNS_SCHEDULE=1 fills empty slots meanwhile, and clears none)' : ''}`
        : `sync_meta has no hourly_sync heartbeat, while mode '${mode}' leaves sched_* to the local task${fillSchedule ? ' — CLOUD_OWNS_SCHEDULE=1 is filling the holes, which is not the same as owning the shelf' : ''}`,
      { hard: false, why: 're-enable AniHubHourlyRefresh, or set CLOUD_OWNS_SCHEDULE=1 to fill empty slots from here, or set MODE=takeover — a sched_* column nobody writes keeps displaying an airing that already happened' });
  }

  /* The one thing CLOUD_OWNS_SCHEDULE must never do is rewrite a slot that already has a value:
     that is the local task's column, and two writers deriving the same shelf from the same field is
     how it starts flip-flopping. Any row that is unstamped AND carries a part of a slot AND the
     cloud stamp is either that bug or a hand edit. */
  if (fillSchedule) {
    const halfFilled = await count(`SELECT count(*) AS n FROM anime
      WHERE cloud_synced_at IS NOT NULL
        AND (sched_day IS NULL) <> (sched_season IS NULL)`);
    add('the schedule fill never wrote a partial slot', halfFilled === 0, `${halfFilled} rows carry half an air slot`,
      { hard: false, why: 'airSlot() writes all five together, so a split means a hand edit or a fill that should not have run' });
  }

  /* ------------------------------------------------------------ site vocabulary */

  const badKind = await count(`SELECT count(*) AS n FROM anime WHERE kind NOT IN (${KINDS.map(() => '?').join(',')})`, ...KINDS);
  add('kind is inside the API\u0027s closed list', badKind === 0, `${badKind} rows`,
    { why: 'functions/api/anime/index.js rejects the facet and the title leaves ?kind= results' });

  const badStatus = await count(`SELECT count(*) AS n FROM anime WHERE status NOT IN (${STATUSES.map(() => '?').join(',')})`, ...STATUSES);
  add('status is inside the API\u0027s closed list', badStatus === 0, `${badStatus} rows`, { why: 'as above for ?status=' });

  /* 'Fall 2026' — a four-letter season word, a space, a four-digit year. Written this way rather
     than with a regex because SQLite has none; substr() is what schedule.js's exact `=` cares about. */
  const seasonWords = SEASON_WORDS.map((s) => `'${s}'`).join(',');
  const badSeason = await count(`SELECT count(*) AS n FROM anime WHERE sched_season IS NOT NULL
    AND (length(sched_season) < 7
         OR substr(sched_season, length(sched_season) - 4, 1) <> ' '
         OR substr(sched_season, length(sched_season) - 3) NOT GLOB '[0-9][0-9][0-9][0-9]'
         OR substr(sched_season, 1, length(sched_season) - 5) NOT IN (${seasonWords}))`);
  add('sched_season is "<Season> <year>", spelled as schedule.js matches it', badSeason === 0, `${badSeason} rows`,
    { why: 'functions/api/schedule.js:9 compares case-sensitively, so "fall 2026" is a second, unreachable facet value' });

  const badDay = await count('SELECT count(*) AS n FROM anime WHERE sched_day IS NOT NULL AND (sched_day < 1 OR sched_day > 7)');
  add('sched_day is 1..7 with Sunday as 7', badDay === 0, `${badDay} rows`);

  /* Live D1 refuses any LIKE/GLOB pattern longer than 50 bytes — measured against the production
     endpoint: 50 passes, 51 comes back HTTP 400 'LIKE or GLOB pattern too complex'. The single
     pattern that pinned this shape is 75, so it never reached a row: the full audit died at this
     statement while the probe before it read fine. Split into its two halves — the date-shaped
     head (44) and the time-shaped tail (34) — plus the length that ties them: in a 19-character
     string whose first 11 are `dddd-dd-dd `, character 11 is the only space there is, so the
     tail's space can anchor nowhere else. node:sqlite enforces no such limit, which is exactly why
     the guard is cloud-sync/pattern-limit.test.mjs rather than a run against prod. */
  const badAdded = await count(`SELECT count(*) AS n FROM anime WHERE added_at IS NOT NULL
    AND (length(added_at) <> 19
      OR added_at NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] *'
      OR added_at NOT GLOB '* [0-9][0-9]:[0-9][0-9]:[0-9][0-9]')`);
  add('added_at is datetime text', badAdded === 0, `${badAdded} rows`,
    { why: 'the Just Added shelf sorts this column as text, so a different shape sorts into the wrong decade' });

  /* ----------------------------------------------------------------- visibility */

  /* R6: a title with no genre rows is invisible to every genre filter, so a row this job created
     must not be one of them. Rows nobody has ever touched are reported, not failed. */
  const genrelessCloud = await count(`SELECT count(*) AS n FROM anime a
    WHERE a.cloud_synced_at IS NOT NULL AND a.added_at IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM anime_genre ag WHERE ag.anime_id = a.id)`);
  add('every cloud-written row is on a genre shelf', genrelessCloud === 0, `${genrelessCloud} rows`,
    { why: 'the browse UI joins anime_genre; a row with none cannot be browsed at all' });

  const dangling = await count(`SELECT count(*) AS n FROM anime_genre ag
    WHERE NOT EXISTS (SELECT 1 FROM anime a WHERE a.id = ag.anime_id)`);
  add('no genre rows point at a missing title', dangling === 0, `${dangling} rows`);

  const unsearchable = await count(`SELECT count(*) AS n FROM anime WHERE search_text IS NULL OR search_text = ''`);
  add('every row is searchable', unsearchable === 0, `${unsearchable} rows have no search_text`,
    { hard: false, why: 'the search prefilter LIKEs that column, so a NULL row only answers an exact-id lookup' });

  /* ---------------------------------------------------------------- rate control */

  report.state.leases = await d1All('SELECT name, owner, expires_at FROM sync_lock');
  const live = report.state.leases.filter((l) => l.expires_at > Date.now());
  add('no lease is held by a run that is not running', live.length === 0,
    live.map((l) => `${l.name} by ${l.owner}`).join(', ') || 'none',
    { hard: false, why: 'normal during a run; a stale lease clears itself when it expires' });

  report.state.usage = await d1All(`SELECT day, endpoint, requests FROM api_usage
    WHERE day >= ?1 ORDER BY day DESC LIMIT 14`, [new Date(Date.now() - 13 * 86400_000).toISOString().slice(0, 10)]);
  report.state.usage_today = report.state.usage.find((u) => u.day === utcDay()) ?? null;

  const throttle = await d1First(`SELECT value FROM sync_meta WHERE key = 'cloud_anilist_throttle'`);
  try { report.state.throttle = throttle ? JSON.parse(throttle.value) : null; } catch { report.state.throttle = null; }

  report.state.recent_runs = (await recentRuns('anilist', 8)).map((r) => ({
    started_at: r.started_at, duration_ms: r.duration_ms, exit_reason: r.exit_reason, ...runLine(r.summary),
  }));
  const last = report.state.recent_runs[0];
  if (last) {
    add('the last run ended cleanly', !ALARM.includes(last.exit_reason),
      `${last.exit_reason}${last.error ? `: ${last.error}` : ''}`,
      { why: 'sync_runs has the full summary line' });
    const ageMin = Math.round((Date.now() - last.started_at) / 60000);
    add('a run happened recently', ageMin < 120, `last run ${ageMin} minutes ago`,
      { hard: false, why: 'the schedule may be paused, or Actions cron may be lagging' });
  } else {
    add('the cloud has run at least once', false, 'sync_runs has no anilist rows',
      { hard: false, why: 'the first guarded run has not happened yet' });
  }

  /* The budget cannot alarm on its own — budget_exhausted exits 0 by design — so this streak is
     the only place a starved schedule is ever named. Read backwards from the most recent run, so
     it reports the state an operator would find scrolling the Actions tab, not a historical worst
     case; a fresh UTC day breaks it on its own, which is exactly what makes N of them mean the
     budget is being spent faster than the schedule can use it. */
  let budgetStreak = 0;
  for (const r of report.state.recent_runs) {
    if (r.exit_reason !== 'budget_exhausted') break;
    budgetStreak++;
  }
  if (budgetStreak > 0) {
    add('the daily budget is not starving the schedule', budgetStreak < BUDGET_STREAK_ALARM,
      `${budgetStreak} consecutive runs stopped at budget_exhausted${budgetStreak === report.state.recent_runs.length ? ' (every run in the window)' : ''}`,
      { why: `raise ANILIST_DAILY_BUDGET, or delete the Variable and take the default 4000 — each stop exits 0, so nothing before this streak of ${BUDGET_STREAK_ALARM} says the schedule has been quiet` });
  }

  /* The queue is how new titles reach the cloud now that the importer does not have to run on the
     machine: entries that never drain mean delta is not keeping up, or is not scheduled. The table
     may legitimately be absent — cloud-sync/schema.sql is applied by an operator, not by the sync,
     and a read-only audit that throws on a missing table is an audit that tells you nothing at all. */
  try {
    report.state.pending = await d1First(`SELECT count(*) AS n, min(added_at) AS oldest FROM sync_pending`);
  } catch (err) {
    report.state.pending = null;
    report.state.pending_error = err.message;
  }
  const queued = report.state.pending?.n ?? 0;
  if (!report.state.pending) {
    add('the queue is readable', false, `sync_pending cannot be read (${report.state.pending_error})`,
      { hard: false, why: 'run ops → apply-schema with cloud-sync/schema.sql; until then Phase 2 has nothing to drain' });
  } else if (!createsRows) {
    add('queued titles can be drained from this mode', queued === 0,
      `${queued} titles are queued while mode '${mode}' cannot create rows`,
      { hard: false, why: 'queue hydration needs CLOUD_CREATES_ROWS=1 (Phase 2)' });
  } else if (queued > 0) {
    const waited = Date.now() - (report.state.pending.oldest ?? Date.now());
    add('the queue is moving', waited < 6 * 3600000,
      `oldest entry has waited ${Math.round(waited / 3600000)}h, ${queued} left`, { hard: false });
  }

  report.state.catalogue = await d1First(`SELECT count(*) AS n, sum(rating > 0) AS rated,
    sum(sched_day IS NOT NULL) AS airing, sum(trend_rank IS NOT NULL) AS trending FROM anime`);

  return report;
}

/* ------------------------------------------------------------------- the probe alone */

/**
 * The schema gate as a standalone report: exactly the reads a run makes at the top of main(),
 * against exactly the same sets — ANIME_COLUMNS and requiredTablesFor(createsRows) — with the
 * failure reason from the same `schemaFaults` the writers use. That is the point of running it
 * from ops.yml for step 2: the artifact an operator collects *is* the gate, so "the table-valued
 * SELECT answers over REST, and production has every table the code reaches for" is proven by the
 * thing that will later refuse the run rather than by a parallel script that could drift from it.
 *
 * Read-only. Returns a report always; throws never. `probe_error` (exit 2 in the CLI) is the
 * schema_probe_failed case — the reads themselves refused, which says nothing about the schema and
 * claims nothing: no buckets, no raw. `ok` false with a `fault` is the schema_mismatch/
 * schema_unwritable case — the reads answered and the answer is not good enough to run on (exit 1).
 * `columns.raw`/`tables.raw` carry the rows each read returned, so the artifact is the verdict and
 * its ground truth together; `schema_via` names the read that answered, the same field name the
 * run record uses, so a DDL-answered pass does not read like an API-answered one.
 */
export async function probeSchema({ mode = MODE, createsRows = CREATES_ROWS } = {}) {
  const required = requiredTablesFor(createsRows);
  const out = {
    checked_at: new Date().toISOString(), mode, ok: false,
    phase: { creates_rows: createsRows },
  };
  try {
    const shape = await assertLiveColumns({ columns: ANIME_COLUMNS });
    const tableShape = await assertLiveTables({ tables: required });
    const fault = schemaFaults({ columns: shape, tables: tableShape });
    out.schema_via = shape.via;
    out.columns = { wanted: ANIME_COLUMNS.length, missing: shape.missing, extra: shape.extra, unwritable: shape.unwritable, raw: shape.raw };
    out.tables = { required, missing: tableShape.missing, raw: tableShape.raw };
    out.fault = fault?.reason ?? null;
    out.error = fault?.error ?? null;
    out.ok = !fault;
  } catch (err) {
    out.probe_error = err.message;
  }
  return out;
}

const invokedDirectly = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (invokedDirectly) {
  try {
    if (process.argv.includes('--probe')) {
      const probe = await probeSchema();
      console.log(JSON.stringify(probe, null, process.env.QUIET ? 0 : 2));
      if (probe.probe_error) console.error(`probe: ${probe.probe_error}`);
      else if (!probe.ok) console.error(`probe: ${probe.error}`);
      else console.error(`OK mode=${probe.mode}: columns via ${probe.schema_via}, ${probe.tables.required.length} tables and ${probe.columns.wanted} columns all present`);
      process.exitCode = probe.probe_error ? 2 : probe.ok ? 0 : 1;
    } else {
      const report = await audit();
      console.log(JSON.stringify(report, null, process.env.QUIET ? 0 : 2));
      for (const line of report.failures) console.error(line);
      if (report.ok) console.error(`OK mode=${report.mode}: ${report.state.catalogue?.n ?? 0} titles, ${report.checks.length} checks`);
      process.exitCode = report.ok ? 0 : 1;
    }
  } catch (err) {
    /* A missing CF_API_TOKEN is the common case for a hand run, and an unreadable report is
       worse than a one-line reason. */
    console.error(`verify: ${err.message}`);
    process.exitCode = 2;
  }
}
