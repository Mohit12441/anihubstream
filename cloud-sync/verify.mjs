// Read-only audit of what the sync has actually done to the live database. Nothing here writes a
// row: every statement is a SELECT, so it is safe to run at any moment, including while a sync is
// in flight. Run it from the ops workflow (Actions → cloud-ops → report) or by hand:
//
//   node --env-file=.env cloud-sync/verify.mjs
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
import { d1All, d1First } from './d1.mjs';
import { CLAIMS_SCHEDULE, CREATES_ROWS, FILL_SCHEDULE, LEGACY_QUIET_MS, MODE } from './sync-anilist.mjs';
import { recentRuns, utcDay } from './state.mjs';

/* The closed lists the Worker validates against — functions/api/anime/index.js:24-25 and
 * functions/api/schedule.js:9, matched there with an exact `=`, and pinned against this copy in
 * cloud-sync/rate.test.mjs. A value outside them is not cosmetic: the title silently leaves that
 * facet. */
export const KINDS = ['TV', 'Movie', 'OVA', 'ONA', 'Special'];
export const STATUSES = ['Ongoing', 'Finished', 'Upcoming'];
export const SEASON_WORDS = ['Winter', 'Spring', 'Summer', 'Fall'];

/** The exit_reasons that mean a human should look, as opposed to a run that stopped on purpose. */
const ALARM = ['fatal', 'lease_lost', 'legacy_still_running', 'breaker_aborted'];

/** Pull the fields an alert is written against out of a run's stored summary JSON. */
function runLine(summary) {
  try {
    const s = JSON.parse(summary);
    return {
      mode: s.mode, fill_schedule: s.fill_schedule, items_processed: s.items_processed, created: s.created, requests_made: s.requests_made,
      s403: s.s403, s429: s.s429, breaker_opens: s.breaker_opens, skipped: s.skipped,
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
  const report = { mode, checked_at: new Date().toISOString(), checks: [], state: { columns: { creates_rows: createsRows, claims_schedule: claimsSchedule, fills_empty_schedule: fillSchedule } }, failures: [] };
  const count = async (sql, ...params) => (await d1First(sql, params))?.n ?? 0;
  const add = (id, ok, detail, { hard = true, why = '' } = {}) => {
    report.checks.push({ id, ok, detail, hard, why });
    if (!ok) {
      report.failures.push(`${hard ? 'FAIL' : 'WARN'} ${id}: ${detail}${why ? ` — ${why}` : ''}`);
      if (hard) report.ok = false;
    }
  };
  report.ok = true;

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
      WHERE catalogue_synced_at IS NULL AND cloud_synced_at IS NOT NULL
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

  const badAdded = await count(`SELECT count(*) AS n FROM anime WHERE added_at IS NOT NULL
    AND added_at NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-9][0-9]:[0-9][0-9]:[0-9][0-9]'`);
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

const invokedDirectly = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (invokedDirectly) {
  try {
    const report = await audit();
    console.log(JSON.stringify(report, null, process.env.QUIET ? 0 : 2));
    for (const line of report.failures) console.error(line);
    if (report.ok) console.error(`OK mode=${report.mode}: ${report.state.catalogue?.n ?? 0} titles, ${report.checks.length} checks`);
    process.exitCode = report.ok ? 0 : 1;
  } catch (err) {
    /* A missing CF_API_TOKEN is the common case for a hand run, and an unreadable report is
       worse than a one-line reason. */
    console.error(`verify: ${err.message}`);
    process.exitCode = 2;
  }
}
