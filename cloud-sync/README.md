# cloud-sync — rate-controlled AniList / Kitsu sync

A catalogue sync whose primary design goal is that **AniList's per-IP limiter never
fires**. Correctness of rate control is preferred over throughput everywhere the two
conflict.

It replaces wrangler with the D1 REST API, so a run needs nothing but Node and four
environment variables — no npm install, no local machine.

| file | role |
| --- | --- |
| `anilist.mjs` | single-flight queue, pacing, alias batching, adaptive throttle, backoff, circuit breaker, budget, rate-header awareness, POST/GET+relay |
| `d1.mjs` | D1 over REST, chunked multi-row upserts; three write strategies per column — merge (`jsonMerge`), keep-when-absent (`keepExisting`), fill-only (`fillIf`) — and the live column gate both writers run before they take a lease (`assertLiveColumns`) |
| `state.mjs` | the D1-backed memory: lease, cursor, learned interval, daily budget, run records |
| `sync-anilist.mjs` | one bounded incremental pass, in mode `mirror` / `delta` / `takeover` |
| `sync-kitsu.mjs` | Kitsu artwork and episode counts for titles the AniList pass owns |
| `schema.sql` | `sync_lock`, `api_usage`, `sync_runs`, `sync_pending`, the two stamp columns. Root `schema.sql` is the source of truth for `anime`; this file only upgrades an existing database |
| `apply-schema.mjs` | apply a `.sql` file over the REST API (no wrangler); splits on SQLite's real lexical rules, idempotent |
| `verify.mjs` | read-only audit: the column contract, ownership stamps, vocabulary, visibility, rate-control state |
| `diff-rows.mjs` | read-only pre-flight check: compares two row snapshots by parsed value, per mode, and fails on a column the phase does not own (Deploy step 4) |
| `rate.test.mjs` | the rate-control and column-ownership criteria, pinned against a stubbed fetch |
| `migration.test.mjs` | T1-T7 of the migration below, plus the schema re-apply, the column gate, the audit and the diff rules, against a real throwaway SQLite database |
| `config.test.mjs` | the contracts between files: README's env table vs what the code reads, the Kitsu budget vs its cron, the season rule vs the frontend's copy, the committed schema vs its own seed data |

## Why this design

AniList blocks shared egress. This repo already has that in writing —
`sync-worker/wrangler.toml` records that AniList answers `403 "You have been manually
blocked"` to Cloudflare's datacenter IPs (verified 2026-10-13), which is why the sync was
moved to a Windows task on the operator machine. Any free host has the same problem: a
shared IP whose other tenants you do not control. Keeping *our* volume low is necessary
and not sufficient, so the system is built to detect pressure, back off, and stop — rather
than to assume a low volume is safe.

## Deploy

1. **This repo has no git remote yet** (`git remote -v` is empty). Create one on GitHub
   (free, no card) — **public** — and push. Public is not a preference: the two sync workflows
   fire 96 jobs a day between them (`*/30` and `15,45`), every job bills at least one full minute
   however short it is, and a private repo's free plan stops at 2,000 Actions minutes a month —
   ≈2,900 a month on that one-minute floor alone, before the jitter sleeps are counted — so the
   schedule would go dark inside the first month. Public repos run standard runners without a
   minute cap, which is also why this plan never needs a card. Nothing below works until the repo
   exists.
2. **Find out what the live database already has, then apply the schema.** This is a question, not a
   step, because the answer differs per database and nothing in the repo can tell you: the sync's own
   state tables (`sync_lock`, `api_usage`, `sync_runs`, `sync_pending`) and its two stamp columns
   exist only once `cloud-sync/schema.sql` has been applied, and this job has never run against
   production. Ask the database:

   ```
   npx wrangler d1 execute anihub --remote --command \
     "SELECT type, name FROM sqlite_master WHERE tbl_name <> 'sqlite_sequence' ORDER BY type, name"
   npx wrangler d1 execute anihub --remote --command "PRAGMA table_info(anime)"
   ```

   Two commands because they answer two different halves: `sqlite_master` enumerates tables and
   indexes but never a column, and `PRAGMA table_info(anime)` is the only way to read `anime`'s own
   shape. Do not settle this from the repo — the local task has been writing this table in place for
   as long as it has existed (`seed.sql` inserts `catalogue_synced_at` on every row,
   `tools/hourly-refresh.mjs` re-stamps it hourly, and 74 rows arrived since the last count), so the
   live shape is a record of mutations, not of any file. Root `schema.sql` was already found to be
   behind production once — it defined neither stamp column while both were in use — which is exactly
   the case this check exists to catch.

   **Or simply run the gate.** The check the sync performs before its lease is a command:
   `node --env-file=.env cloud-sync/verify.mjs --probe` locally, or with no local machine at all,
   Actions → cloud-ops → probe. It makes exactly the reads the run makes — the same
   `ANIME_COLUMNS`, the same `requiredTablesFor(CREATES_ROWS)` — and prints the buckets with the
   same reason strings a run would record, plus the raw rows each answer was computed from:
   `columns.raw` (the `pragma_table_info` rows, or the `sqlite_master` row when the fallback
   answered) and `tables.raw` (every table name on the database). The verdict ships with its
   evidence, so a wrong bucket is visible next to the right rows instead of agreeing with a bug in
   the helper all three readers share. `schema_via` names the read that answered — the same field
   the run record uses — so a pass over the DDL fallback does not read like a pass over the API.
   That is the point: the artifact *is* the gate, so "the table-valued `pragma_table_info` SELECT
   answers over the REST API" and "production has every table the code reaches for" are proven by
   the thing that will later refuse the run, not by an eyeball. Its exit codes match the run's:
   0 clean, 1 a schema fault (the reason is in the output), 2 the probe itself could not read — and
   in that case it prints no buckets at all, because an empty `missing: []` would read as "nothing
   is missing" when nothing was read. What it cannot see is column types, constraints and indexes —
   the dump below is for those.

   **The schema is a gate, and the sync now runs it itself.** Before either writer takes a lease,
   `assertLiveColumns()` (`cloud-sync/d1.mjs`) reads the live shape with
   `SELECT name, type, notnull, dflt_value FROM pragma_table_info('anime')` — the table-valued form,
   not a bare `PRAGMA` statement, because the REST `/query` endpoint is stricter about statement shape
   than a SQLite shell is — and `assertLiveTables()` reads
   `SELECT name FROM sqlite_master WHERE type = 'table'`, checking every table the run reaches: the
   four state tables always, the two genre tables for the AniList walk, and `sync_pending` only in
   the modes that read it (`requiredTablesFor(CREATES_ROWS)` — mirror never queries the queue, so a
   Phase 1 database is not gated on a table Phase 1 was never asked to create). If both reads fail
   (the endpoint refuses them, the credentials are wrong), the run stops with
   `exit_reason: "schema_probe_failed"` and exit code 2: that is a probe failure, not a schema
   disagreement, and `verify.mjs` reports it as its own check so nobody hunts a column that was never
   missing. `pragma_table_info` has never been exercised against the real endpoint, so the probe
   carries a fallback: if the table-valued SELECT is refused, the `CREATE TABLE` text `sqlite_master`
   kept is parsed instead (same lexical rules `apply-schema.mjs` splits files with), and the run
   record's `schema_via` says which read answered — only when both fail does the probe failure fire.
   When the reads answer, they are diffed in both directions: a column or a required table the
   database lacks stops the run with `exit_reason: "schema_mismatch"`, exit code 1 and
   `nothing was written` in the error, before the lease and before the takeover marker. So does the
   one *extra* shape that can fail every insert — a column that is `NOT NULL` with no default, since
   `insertRows()` omits every column it does not own — under its own reason,
   `exit_reason: "schema_unwritable"` (also exit 1), because nothing is missing there and the repair
   is a default or a nullable column, not a migration; a report that said "mismatch" would send the
   operator hunting a column that is not missing. Either way the run records itself in `sync_runs`, so
   the gate shows up in `verify.mjs` as an alarm instead of as a schedule that quietly stopped. That
   is the failure the paragraph above was written to warn about — `sync-anilist.mjs` and
   `sync-kitsu.mjs` both name every `ANIME_COLUMNS` column in their SELECT and in their INSERT, so an
   ALTER nobody applied used to die on `no such column: …` mid-batch, having already taken the lease,
   with an error naming nothing. Ordinary extras — `catalogue_synced_at` above all — are counted in the
   run record as `extra_columns` and never block anything: production's `anime` has always had columns
   this job must not touch.

   So send the probe output first — it is the only artifact the run itself consumes, and the only
   one that can still change the plan — then the dump, for the halves the gate cannot see: compare
   the live list against three things — `ANIME_COLUMNS`
   in `cloud-sync/sync-anilist.mjs` (what the sync writes), the `CREATE TABLE anime` block in root
   `schema.sql` (what a fresh environment gets, and the file `config.test.mjs` proves can receive
   `seed.sql`), and `cloud-sync/schema.sql`'s two `ALTER` lines (what the upgrade adds). **If any of the
   three disagrees with the live list, stop and send the dump before running anything** — the fix is a
   column, and deciding where it goes (`schema.sql`, `cloud-sync/schema.sql`, or the sync's list) is a
   review, not something to discover from a failed run at 03:15. Applying `cloud-sync/schema.sql` below
   is what closes a *missing stamp column*; a mismatch in any other column is not something that file
   can fix. `verify.mjs` reports the same comparison as a check, so an operator can read the answer
   without starting a run.

   **Commit the answer as `cloud-sync/schema.live.sql`** — the same two queries, one under the other:

   ```
   { echo "-- The live shape of D1 database \`anihub\`, captured $(date -u +%Y-%m-%dT%H:%M:%SZ)";
     echo "-- Regenerate with the two commands in cloud-sync/README.md, Deploy step 2.";
     npx wrangler d1 execute anihub --remote --json --command \
       "SELECT type, name, sql FROM sqlite_master WHERE tbl_name <> 'sqlite_sequence' ORDER BY type, name";
     npx wrangler d1 execute anihub --remote --json --command "PRAGMA table_info(anime)"; } > cloud-sync/schema.live.sql
   ```

   It is a record, not a second source of truth — nothing reads it, and `migration.test.mjs` will not
   notice if it goes stale. What keeps it honest is that it is *in git*: after any schema change, the
   diff is two commands and a `git diff`, instead of an argument about what production holds. **Root
   `schema.sql` is the source of truth for `anime`**: it is the file a fresh environment is built from,
   the one `config.test.mjs` proves can receive `seed.sql`, and the one to edit when the table changes.
   `cloud-sync/schema.sql` owns only the sync's own state tables plus the two `ALTER`s that upgrade an
   *existing* database — and `ALTER TABLE anime ADD COLUMN catalogue_synced_at INTEGER` at its line 84
   is there solely because root `schema.sql` acquired that column after production did. Once
   `schema.live.sql` shows the column live *and* root defining it, delete that `ALTER`: the committed
   pair is checked against each other by `migration.test.mjs`, which today tolerates exactly one
   duplicate column and will assert none after the deletion, so the retirement is an edit-and-run, not a
   promise. A new divergence between the two files fails `npm test` rather than surfacing as an
   operator's error mid-rollout.

   Read for four names — `sync_lock`, `api_usage`, `sync_runs`, `sync_pending` — and two columns on
   `anime` (`cloud_synced_at`, `catalogue_synced_at`). All present: the file is applied, go to step 3.
   Any missing: the probe names it before any run does. Three of the four tables are required by
   every mode and the two columns by every write, so their absence stops a run at the gate with
   `exit_reason: "schema_mismatch"`, exit 1, naming the item — never a mid-run `fatal` after the
   lease. `sync_pending` is the one that can wait: it is required only by the modes that read it
   (`requiredTablesFor(CREATES_ROWS)`; the run loop only calls `pendingSlice()` when
   `CREATES_ROWS`), so a Phase 1 database without it is a valid starting point and the probe says
   exactly that — one direction only: a clean probe in `mirror` does not certify Phase 2, so apply
   the file before the first `delta` run instead of letting that run stop at the gate naming
   `sync_pending` — and if a mirror run ever dies with `no such table: sync_pending` anyway, the mode
   conditioning and the query surface have drifted apart: a code assertion that failed, not a
   schema to apply. Apply the file: Actions → cloud-ops → `apply-schema` (needs only the three CF secrets, and no
   wrangler), or locally `wrangler d1 execute anihub --remote --file=cloud-sync/schema.sql`. The file
   is idempotent; its last lines (the two `ALTER TABLE anime ADD COLUMN`) are the run-once tail and
   report `duplicate column name` on a second application. That error is the guard, so the job counts
   it as `already_present` and still exits 0 — a first application prints `{"statements":10,
   "applied":10,"already_present":0,"failed":0}`, a re-run `applied:8, already_present:2`, and only a
   `failed` other than that makes the exit code non-zero. `migration.test.mjs` applies and re-applies
   this exact file against a real SQLite database, so the tallies above are a test result rather than
   a claim.
3. **Repo Settings → Secrets and variables → Actions**
   - Secrets: `CF_ACCOUNT_ID`, `CF_DATABASE_ID`, `CF_API_TOKEN` (D1:Edit on that account,
     nothing more), optionally `ANILIST_RELAY_PREFIX`
   - Paste each one as a single unbroken line, then run Actions → cloud-ops → `doctor-secrets` before
     the first sync. It is the only command that can tell a secret with a line break *inside* it apart
     from a secret that is simply the wrong string, and in a masked job log the two are identical; it
     writes nothing, reads exactly `SELECT 1`, and prints lengths, character classes, indexes and
     digests — never a value.
   - Variables: leave empty to take the defaults in `.env.example` — which is Phase 1 below
4. **Leave the phase Variables unset** while the Windows task still runs. Unset is `mirror`,
   the only mode that is safe beside it. See "Sole writer: the four phases" below for what each
   mode costs and how to move between them.
5. **Run it once by hand** (Actions → AniList sync → Run workflow) and read the summary
   line. `exit_reason: "catalogue_end"` with `requests_made` around
   `ceil(titles / ANILIST_BATCH_SIZE)` and a non-zero `items_processed` means it worked.
6. Actions → cloud-ops → `report`, and it must end `OK`. It runs only SELECTs, so it is safe to run
   while a sync is in flight. Every check is either hard (the job exits 1) or a `WARN` line — the
   soft ones are states that are normal at some phase, like rows seeded before the stamp columns
   existed or a lease held by the run currently going. This is the command to re-run after
   every phase.
7. Local run against the live database: `node --env-file=.env cloud-sync/sync-anilist.mjs`

## Sole writer: the four phases

The goal is that the operator machine stops writing `anime` altogether. The obstacle is not
AniList, it is `tools/hourly-refresh.mjs` (the `AniHubHourlyRefresh` task): it writes the same
table, takes **no lease**, and owns the air-slot and trending columns. Two jobs cannot be kept
apart by locking when one of them never locks, so they are kept apart by *what each is allowed to
write*, and the handover happens in phases small enough to check and to reverse. Each phase is one
repo Variable change plus one `report`; nothing is irreversible except the `ALTER`s, which are
additive and nullable.

`MODE` decides everything. Left unset, it is derived from the two switches, so they can never
disagree with it — and an explicit `MODE` that contradicts them is refused at startup rather than
guessed at, because the difference between the modes is the difference between "safe beside the
local task" and "claiming the local task's columns".

| `MODE` | derived from | may insert | may overwrite |
| --- | --- | --- | --- |
| `mirror` (Phase 1) | `CLOUD_CREATES_ROWS=0` | never | the metadata columns only |
| `delta` (Phase 2) | `CLOUD_CREATES_ROWS=1`, `LEGACY_WRITER_ACTIVE=1` | from `sync_pending` | the metadata columns only |
| `takeover` (Phase 3) | `CLOUD_CREATES_ROWS=1`, `LEGACY_WRITER_ACTIVE=0` | from `sync_pending` | metadata **plus** `sched_*` and `trend_rank` |

`delta` and `mirror` share one `updateSet` on purpose: delta differs from mirror only in what it
may INSERT, never in what it may overwrite. That is what makes the stamp audit meaningful.

`CLOUD_OWNS_SCHEDULE` is the one switch that is not a phase. It does not change `MODE` and it does
not move a column: in `mirror`/`delta` it adds a *fill-only* path to the five `sched_*` columns, and
the statement itself refuses everything else (see the guard below). Default off, and off is the
right answer for a normal rollout — see *Whose rows does the local task refresh?* in Phase 2.

### Who owns which column

| column | Phase 1 `mirror` | Phase 2 `delta` | Phase 3 `takeover` | local task |
| --- | --- | --- | --- | --- |
| `title` `native` `year` `rating` `season` `kind` `status` `art` `key_art` `accent` `synopsis` `search_text` `episode_total` | cloud | cloud | cloud | — |
| `source_ids` | cloud, merged in SQLite | cloud, merged | cloud, merged | — |
| `sched_day` `sched_day_label` `sched_date` `sched_time` `sched_season` | — (fill only, `CLOUD_OWNS_SCHEDULE=1`) | insert only; fill only with `CLOUD_OWNS_SCHEDULE=1` | cloud | cloud |
| `trend_rank` | — | insert only | cloud | cloud |
| `added_at` | — | insert only | insert only | insert only |
| `anime_genre` rows | created rows always; existing rows only with `CLOUD_OWNS_GENRES=1` and only if nothing else owns them | same | same | yes |
| `rank` `alt_seasons` `skip_key_id` `skip_key_space` | never | never | never | never |
| `cloud_synced_at` | cloud | cloud | cloud | — |
| `catalogue_synced_at` | — | — | — | local tools |
| row creation | never | from `sync_pending` | from `sync_pending` | yes |

The site's *vocabulary* is part of ownership. `functions/api/anime/index.js:24-25` validates
`?kind=`/`?status=` against a closed list and then filters with an exact `=`, and
`functions/api/schedule.js:9` matches `sched_season` the same way. So the cloud writes `TV` /
`Ongoing` / `Fall 2026` — the spellings `tools/sync-catalogue.mjs:162-164` and
`tools/season.mjs:19` use — never AniList's enum (`tv`, `RELEASING`, `fall 2026`). A
title that AniList has a state for which the site has no word (`CANCELLED`, `HIATUS`) is written
as absent, which means *keep the stored value*, never as an invented label.

### Is an absent value clearable? (per column)

AniList returns an explicit JSON `null` for a field it was asked about but does not have, while
`0` is a real rating and `''` can be real prose. So "absent" is `=== null` and nothing else — not
`hasOwn`, not falsy.

| rule | columns | why |
| --- | --- | --- |
| **keep the stored value** | `title` `native` `year` `rating` `season` `kind` `status` `art` `key_art` `accent` `synopsis` `episode_total` `search_text` | an airing title has no episode count on AniList and a scoreless title has no rating; blanking either loses data nobody can regenerate |
| — in SQL | the nullable ones above | `CASE WHEN excluded.col IS NULL THEN anime.col ELSE excluded.col END` (`d1.mjs` `keepExisting`) |
| — in JS, first | the eleven NOT NULL ones | SQLite checks an `INSERT ... ON CONFLICT`'s VALUES against the table's constraints *before* the `DO UPDATE` runs, so one absent score fails the whole chunked statement, for every row in it, and the CASE never executes. The run therefore reads those columns with the row and keeps what it read (`completeFromStored`) — the same reason `sync-kitsu.mjs` always writes a complete record |
| **merge, never replace** | `source_ids` | `json_patch(COALESCE(source_ids,'{}'), ?)`. `COALESCE` matters: `json_patch(NULL, x)` is NULL, so without it the first merge onto a row with no provenance would wipe the column instead of filling it |
| **clearable on purpose** | `sched_day` `sched_day_label` `sched_date` `sched_time` `sched_season` `trend_rank` | a title that stopped airing must lose its slot, a title that left the trending list must lose its rank. Keeping the stale value here is the bug: the shelf would list a finished show as airing |
| — *except* in a fill | the same five `sched_*` in mirror/delta with `CLOUD_OWNS_SCHEDULE=1` | `CASE WHEN anime.sched_day IS NULL AND … AND anime.catalogue_synced_at IS NULL AND excluded.sched_day IS NOT NULL THEN excluded.sched_day ELSE anime.sched_day END` (`d1.mjs` `fillIf`). Four conditions, all of them load-bearing: no local stamp, the whole slot empty, we actually have a value. It cannot clear, so it cannot fight the local writer over a slot that has an owner |
| **never written by an update** | `added_at` `rank` `alt_seasons` `skip_key_id` `skip_key_space` | a refresh must not move a title up the Just Added shelf, undo curation, or break the provenance the skip pipeline keyed itself on |
| **always written** | `cloud_synced_at` | it is the proof of the write itself |

### Pre-flight, before the first run that writes production rows

Phase 1 is not read-only: `mirror` updates real rows. So before the first scheduled tick, do these
five things in order. They take ten minutes and they are the difference between a rollout you can
reason about and one you are guessing at. **If the workflow is already pushed, silence the
schedule first** — `gh workflow disable catalog-sync.yml -R <owner>/<repo>`, then `gh workflow enable` it again when these five
steps are green; the `cloud-ops` jobs are a separate workflow and stay dispatchable throughout. A
tick between the push and the scoped run also eats step 3's evidence: ticks walk the same shared
cursor (`cloud_anilist_cursor:mirror`), so a tick can finish the walk first and the scoped run then
exits `cursor_end` with `requests_made: 0` — a green run that proves nothing — instead of the
`item_cap` signature this pre-flight reads. With the schedule silenced, the scoped run is the
first walker.

1. **Bookmark the database.** This run mutates rows and D1 Time Travel is the only undo:

   ```
   npx wrangler d1 time-travel info anihub
   npx wrangler d1 execute anihub --remote --json --command "SELECT count(*) AS rows FROM anime" > preflight-counts.json
   ```

   Write down the bookmark the first command prints — `The current bookmark is '<bookmark>'` — and
   keep it in one place with step 2's probe outputs: that set is the whole restore story if a write
   goes sideways. `time-travel` takes **no** `--remote`: it always acts on the remote database, and
   the flag is refused there (unlike `d1 execute`, where it is required) — appended out of habit,
   it prints help and reads nothing. The bookmark has to predate the first cloud *write*,
   and the first writer can be a scheduled tick: a `schedule:` workflow starts firing as soon as it
   is on the default branch — every 30 minutes here, with no enable step — so when you are pushing
   and deploying in one sitting, take this bookmark *before* the push. (A tick that fires before
   the Secrets are saved stops at the probe with exit 2 — no credentials, no writes.) Two things to
   know about the undo before you need it: `npx wrangler d1 time-travel restore anihub
   --bookmark=<bookmark>` — no `--remote` there either — produces a **new** database from that
   point, it does not rewind `anihub` in place, so an undo means repointing the app (or copying
   rows back), and the window is finite: Time Travel on the Workers Free plan keeps **7 days** of
   history (30 on Paid). That comfortably covers this rollout — the active path is about a day and
   a half — but an undo discovered a week later is no undo at all. The restore endpoint is also
   rate-limited (10 per 10 minutes per database), so read each attempt's output rather than
   retrying blind.

2. **Run the schema gate and dump the schema** so the audit's later claims are about data, not
   assumptions. `node --env-file=.env cloud-sync/verify.mjs --probe` first — it is the exact check
   the next run will make, and its output is the artifact to keep — then the two dump commands from
   Deploy step 2.

   A probe that fails here on a non-empty `missing` is not a stop — it is the discovery this step
   exists for. `cloud_synced_at` is the plausible name in that bucket: only
   `cloud-sync/schema.sql`'s `ALTER` adds it, and production may never have taken that. For a
   missing stamp the fix is `apply-schema` (Deploy step 2), not a review: apply it, re-probe until
   `missing` and `unwritable` are empty, and keep both outputs — the before-and-after pair is the
   record of what the apply changed. A `missing` naming anything else is the review Deploy step 2
   describes, not an apply. Either way this settles before the snapshot and the scoped run below:
   where Deploy places that apply ahead of Phase 2, a probe that finds the stamp absent moves it
   here — one step earlier — and nothing below runs against a database the sync cannot write.

3. **Scope the first run** rather than letting the schedule do 1000 titles at once:

   ```
   MAX_ITEMS_PER_RUN=100 ANILIST_DAILY_BUDGET=60 node --env-file=.env cloud-sync/sync-anilist.mjs
   ```

   Expect `requests_made` ≤ 4 (a slice is `4 × ANILIST_BATCH_SIZE` titles, and 100 titles is one
   slice: `100 / 25 = 4` aliased documents), `s403: 0`, `bisects: 0`, and `exit_reason: "item_cap"` —
   the run stopped because you told it to, not because it ran out of anything. If `requests_made` is 5
   or more, or `s403` is not 0, stop and read *If 403s still happen* before going further. A non-zero
   `bisects` is not a stop: it means a 25-alias document was refused as too complex and the batch was
   halved, which costs requests (read it against the budget) and loses nothing.

   Keep those two values on the command line. Pinned as repo Variables — the reflex if you scope a
   *dispatched* run instead — they scope every run for the rest of the UTC day, because `api_usage`
   is one shared counter across runners: the ticks and the soak then stop at `budget_exhausted`,
   they exit 0, and nothing tells you at the time. The audit is the witness — `report` fails on
   three consecutive stops (`budget_exhausted` is deliberately not alarming on its own; one stop is
   a day ending) — but three stops is 90 minutes of quiet. If you must scope by Variable, delete it
   the moment the scoped run's summary is read.

4. **Snapshot the rows, run step 3, snapshot the same rows again, and compare them structurally.** A
   textual `diff` of two JSON dumps is not that check: `source_ids` is a JSON document stored as text,
   so a merge that adds one key rewrites the whole string and `diff` flags every such row as a change
   without saying whether it was allowed — and `idMal` appearing upstream is allowed in Phase 1, by
   design. `cloud-sync/diff-rows.mjs` parses the column and applies the ownership rules per mode:

   ```
   SNAPSHOT="SELECT id, rating, episode_total, length(synopsis) AS synopsis, sched_day, sched_season, added_at, source_ids, catalogue_synced_at, cloud_synced_at FROM anime"
   npx wrangler d1 execute anihub --remote --json --command "$SNAPSHOT ORDER BY id LIMIT 100" > before.json
   ```

   After step 3, re-snapshot **the same ids**, not `LIMIT` again — a row `delta` creates can sort into
   the window and push one out, which a second `LIMIT` would report as a deletion:

   ```
   npx wrangler d1 execute anihub --remote --json --command \
     "$SNAPSHOT WHERE id IN ($(node cloud-sync/diff-rows.mjs --ids before.json))" > after.json
   node cloud-sync/diff-rows.mjs before.json after.json --mode mirror; echo "exit $?"
   ```

   Exit 0 is the answer: nothing outside mirror's write set moved, and the lines it prints say what
   did. What may change in Phase 1 — reported, not flagged: `rating`, `episode_total`, `synopsis`
   (that is what mirror is *for*), `cloud_synced_at`, and `source_ids` gaining keys. What may not:
   `added_at`, any `sched_*`, `catalogue_synced_at`, `rank`, `alt_seasons`, the AniSkip keys; a row
   appearing (mirror never inserts) or disappearing; a `source_ids` key going missing; the `anilist`
   id inside it moving. The lost-key rule is not decoration: `json_patch` deletes any key whose patch
   value is `null`, and this run builds the patch in `rowFromMedia` by spreading the stored keys and
   adding only `anilist`/`mal` — a value that is absent is never written as null — so a key that
   disappears means the merge itself broke. The response to any violation is to go back to the safe
   phase while it is worked out (`gh variable delete CLOUD_CREATES_ROWS -R <owner>/<repo>` and
   `gh variable delete MODE -R <owner>/<repo>`, which is `mirror` by derivation).

   `--mode delta` and `--mode takeover` carry the same rules into the later phases: creation becomes
   allowed, and the air slot plus `trend_rank` are released at takeover. Two tests keep the runbook
   and the code honest about that: `migration.test.mjs` T1 asserts the partition against real SQLite,
   and a second block there compares `diff-rows.mjs`'s forbidden lists against `updateSet()` column by
   column, so the pre-flight can neither drift into flagging a legitimate write nor go quiet on a
   column nobody owns. A violation on production still means the live table differs from the tested
   shape, not that the test was optimistic.

5. **Only then** un-scope it. The env line above is a one-off shell invocation; the scheduled run
   takes its values from repo Variables, which you have not touched.

**If the pre-flight run is slow, the first lever is `ANILIST_BATCH_SIZE`, not the pacing.** R3 packs
25 `Media(id: …)` lookups into one document, and AniList's GraphQL layer charges each alias as its
own query: a batch of 25 costs roughly 25× the *complexity* of a single lookup even though it is one
request against the 30/min *rate* window. Those are two different ceilings and only the first one a
batch can hit. The client handles the rejection without losing the titles: `classifyGraphQLError()`
(`anilist.mjs`) sorts a 200-with-`errors` response three ways, because the status code cannot tell
them apart and the old code assumed every one of them was permanent. A **transient** message
(`Too many requests`, `temporarily`, `unavailable`, a timeout) backs off through the same limiter as
a 5xx and retries inside the attempt budget. A **complexity** message is the batch being too big, not
the call being wrong, so `mediaByIds()` halves it and asks twice in smaller documents — each half
paced, each counted in `requests_made`, the whole recovery reported as `bisects` in the summary line.
Anything **else** is still sent once and thrown, since a malformed document does not become valid on
retry. The ordering of those checks is not incidental: AniList's rate message contains the words
"too many", which a complexity pattern would also match, and mis-classifying it would answer a
request to slow down with twice the requests. `config`-level proof is in `rate.test.mjs` section 6.
Measure before tuning — `duration_ms / requests_made` from the summary, and the byte size of the
response — and if a 25-alias document is genuinely the problem, halve it as a repo Variable:

```
gh variable set ANILIST_BATCH_SIZE --body '10' -R <owner>/<repo>     # 10 titles per request
```

Nothing else needs to change: `ANILIST_BATCH_SIZE` is the chunking of one document, and the slice
that reads the catalogue is `4 ×` it, so a run simply makes more, smaller requests at the same
pacing. The field set is already the lean one — `anilist.mjs:51-54` asks for
`id idMal title{romaji english native} format type status season seasonYear averageScore
bannerImage coverImage{large extraLarge color} description genres episodes duration trending
popularity nextAiringEpisode{airingAt episode} startDate{year}` and no `staff`, `studios`,
`relations`, `tags`, `externalLinks` or `recommendations`, all of which are the expensive subtrees.
`description` is the only heavy field left and it is what `synopsis` is made from, so it is the last
thing to drop, not the first.

### Phase 1 — mirror (the default)

```
MODE unset   LEGACY_WRITER_ACTIVE unset   CLOUD_CREATES_ROWS unset   CLOUD_OWNS_GENRES=0
```

Refreshes metadata for titles the catalogue already holds, beside the local task, in the same
minute. It cannot create a row and cannot write a `sched_*` or `trend_rank` value, so the worst it
can do is restyle a poster. Leave it here for a few days, then read `report`.

*Check:* `Phase 1 never created a row` must be OK. That count is rows carrying only
`cloud_synced_at` — in this mode, proof of an insert.
*Rollback:* nothing to do (it is the default); or stop the workflow. The local task never stopped.

### Phase 2 — delta (the cloud may create rows)

```
CLOUD_CREATES_ROWS=1        # LEGACY_WRITER_ACTIVE stays unset
```

Now a queued AniList id becomes a row, and the insert-only columns are filled from the same
derivations the local task uses: `added_at` = `datetime('now')` text, `anime_genre` from
`Media.genres` mapped through the `genre` table's own labels, `trend_rank` = the title's position
in AniList's trending page, `sched_*` = `airSlot()`, byte-for-byte
`tools/hourly-refresh.mjs:119` (same Sunday-as-7 numbering, same `Oct 13` / `01:00` / `Fall 2026`).

Queue a title — this is the step that replaces `tools/catalogue-sources.json` on the machine:

```sql
INSERT INTO sync_pending (anilist_id, slug, added_at, note)
VALUES (98596, 'a-test-title', CAST(strftime('%s','now') AS INTEGER) * 1000, 'operator request');
```

The slug is advisory: the sync recomputes it from the English (then Romaji) title with the same
`slugify()` as `tools/discover-titles.mjs`, and refuses to move a row that a *different* AniList id
already holds — that is a franchise collision, and re-pointing it would misattribute every episode
and every skip key the row holds. A queue entry is consumed only once the run reached a decision
about it: a title AniList has not published artwork for stays queued (a tile with a broken poster
is worse than a wait), a dead id is dropped so the queue can drain.

**Whose rows does the local task refresh?** Every row in the table, including ones it never created.
`tools/hourly-refresh.mjs:153` selects `id, source_ids` from `anime` with no `WHERE` — no
`catalogue_synced_at IS NOT NULL`, no provenance filter — and then writes `trend_rank` for each
title it finds (`:90`) and the whole five-column air slot for each (`:115`), NULLing the slot when
AniList reports no `nextAiringEpisode` (`:106`). A row this job inserts in Phase 2 therefore gets
its schedule refreshed by the hourly task on its next tick, exactly like a locally-created row; the
insert fills the slot from the same field (`airSlot()`), so there is no window in which the row is
on the shelf with an empty slot and nobody assigned to fill it. That is why Phase 2 does **not**
need a schedule switch to be complete, and why `CLOUD_OWNS_SCHEDULE` exists at default 0 rather than
being folded into the mode: it is for the case where that task is broken or disabled while
`LEGACY_WRITER_ACTIVE` still says `1`.

Which is a state you can now not fall into by accident either: `resolveMode` refuses
`LEGACY_WRITER_ACTIVE=0` together with `CLOUD_CREATES_ROWS=0` outright (`gives nobody the sched_*
columns`), because that combination is precisely "the local task is stopped, and the cloud is not
allowed to write what it owns". The residual gap is the one no config read can see — the task is
*enabled* in the flag but has stopped succeeding — and `verify.mjs` checks it against data:
`someone still owns the schedule shelf` WARNs when the `hourly_sync` heartbeat is older than
`LEGACY_QUIET_MS` while the mode leaves those columns to it.

*Check:* `report` → `every cloud-written row is on a genre shelf` OK. `migration.test.mjs` T7 runs
the actual `functions/api/anime` and `functions/api/schedule` queries against a real SQLite
database, so "a cloud-created row is indistinguishable from a locally-created one" is a test, not
a claim.
*Rollback to Phase 1:*

```
gh variable set CLOUD_CREATES_ROWS --body '0' -R <owner>/<repo>    # or: gh variable delete CLOUD_CREATES_ROWS -R <owner>/<repo>
gh variable set LEGACY_WRITER_ACTIVE --body '1' -R <owner>/<repo>  # Phase 2 never asked you to touch this; it stays 1 — say so explicitly rather than leaving it unset and hoping the derivation is read the same way next month
gh variable set CLOUD_OWNS_GENRES --body '0' -R <owner>/<repo>     # only if you had turned it on
gh variable set CLOUD_OWNS_SCHEDULE --body '0' -R <owner>/<repo>   # only if you had turned it on
gh variable delete MODE -R <owner>/<repo>                          # run this one even if you never set MODE by hand
```

That last line is not optional hygiene. `resolveMode()` refuses to start a run whose explicit `MODE`
contradicts the two switches, and rolling back the switches *is* the contradiction: `MODE=delta` held
while `CLOUD_CREATES_ROWS` goes to `0` means every scheduled run exits 1 and the catalogue stops
silently, which is the worst possible behaviour for a rollback. Delete `MODE` and the derivation
(`:426`) lands on `mirror` on its own. The same applies to the Phase 3 and Phase 2 rollbacks below:
**if you ever set `MODE` explicitly, every later switch change has to delete it in the same breath.**

`--body` takes a literal string — see the warning above the table, this is the command that corrupts
a rollout when typed as JSON. Rows already created stay: they are ordinary rows, and `delta`'s
overwrite set is `mirror`'s, so the only local-task column a Phase 2 row ever held is the one its own
insert filled from `airSlot()` — which the hourly task recomputes on its next tick. Nothing is
undone by switching back; the queue keeps its entries and `mirror` simply does not read them (the
report says so as `queued titles can be drained from this mode`).

### Phase 3 — takeover (the handover)

```
schtasks /Change /TN AniHubHourlyRefresh /DISABLE     # the local task, not this job
LEGACY_WRITER_ACTIVE=0   CLOUD_CREATES_ROWS=1
```

`takeover` claims `sched_*` and `trend_rank` on existing rows. It **refuses to start** while the
task's own heartbeat — `sync_meta.hourly_sync`, written by every local run — is younger than
`LEGACY_QUIET_MS` (2h: one missed tick plus slack). That is a real check, not a config read:
disabling the task is a thing you can forget, and this is the one mode that can put two writers on
one column. It exits `exit_reason: "legacy_still_running"` with exit code 1, so CI alerts.

To cross the window deliberately — you disabled the task an hour ago and the heartbeat is still
young — answer the interlock with evidence rather than by waiting it out:

```
node cloud-sync/sync-anilist.mjs --force-takeover      # or tick the box on a dispatched run
```

That writes `sync_meta.cloud_takeover` (`{at, at_iso, owner, reason}`) and proceeds. The marker is
durable, so later ticks pass without needing the flag again, and `report` judges every row against
it.

**The flag is read only in `takeover`.** `mirror` and `delta` never run an interlock for it to
override, so a forced dispatch taken while the switches still mean `delta` stamps no marker — and
the first run after `LEGACY_WRITER_ACTIVE=0` lands on `legacy_still_running` as if the box had never
been ticked. Switch first, force second: that dispatch *is* the Phase 3 run.

A takeover run that gets through honestly — the task really was disabled, so the heartbeat was
already stale — writes the same marker with `reason` naming the quiet window. It is not a record of
you overriding something; it is the instant this job started owning `sched_*`, which is the instant
the query below needs to compare against. Without it the Phase 3 audit would have nothing to check,
because the honest path involves no flag.

*Check — the verification query.* A row stamped by the local tools **after** the marker means a
second writer is live on a column this job now claims:

```sql
SELECT count(*) AS overlap_since_takeover
FROM anime
WHERE catalogue_synced_at > (
  SELECT CAST(json_extract(value, '$.at') AS INTEGER) FROM sync_meta WHERE key = 'cloud_takeover');
```

Must be `0`. It is `verify.mjs`'s `no local write after the takeover marker`. It is only meaningful
from Phase 3; in Phases 1-2 the local task *should* keep stamping, which is why the disjointness
there is proved in the other direction:

```sql
-- Phase 1 only: any row the cloud stamped and the local tools never did is an insert that must not exist.
SELECT count(*) AS cloud_created_rows FROM anime
WHERE catalogue_synced_at IS NULL AND cloud_synced_at IS NOT NULL;

-- Any phase: each writer sets only its own stamp, so attribution is never a guess.
SELECT sum(catalogue_synced_at IS NOT NULL AND cloud_synced_at IS NOT NULL) AS both,
       sum(catalogue_synced_at IS NULL    AND cloud_synced_at IS NOT NULL) AS cloud_only,
       sum(catalogue_synced_at IS NOT NULL AND cloud_synced_at IS NULL)    AS local_only,
       sum(catalogue_synced_at IS NULL    AND cloud_synced_at IS NULL)     AS neither
FROM anime;
```

The first is a *data* check. The column sets themselves are disjoint by construction, and that is a
*code* invariant: `updateSet('mirror')` ∩ `LEGACY_OWNED` is empty, `updateSet` never contains
`added_at`, `rank`, `alt_seasons` or the skip keys, and the one way `sched_*` can enter a
non-takeover update list is the fill — which is not a claim on the column, because
`SCHED_FILL_GUARD` refuses every row the local task has stamped or that already holds any part of a
slot. All of it is pinned in `rate.test.mjs`, which fails before the cron tick does.

*Rollback:* `gh variable set LEGACY_WRITER_ACTIVE --body '1' -R <owner>/<repo>` and
`gh variable delete CLOUD_CREATES_ROWS -R <owner>/<repo>` (delete, not `--body '0'`: unset is the
documented Phase 1, and it removes the chance of the two switches disagreeing with an explicit
`MODE`) and `gh variable delete MODE -R <owner>/<repo>` — which you must run if `MODE` says
`takeover`, because `takeover` against `LEGACY_WRITER_ACTIVE=1` is precisely the contradiction the
derivation refuses to guess at, and `resolveMode` answers it by exiting 1. Then
`schtasks /Change /TN AniHubHourlyRefresh /ENABLE`. If you had turned on the fill,
`gh variable set CLOUD_OWNS_SCHEDULE --body '0' -R <owner>/<repo>` too — nothing it wrote needs
undoing, since it only ever filled a slot that was empty on a row nobody had stamped, and the local
task recomputes that row on its next tick. Then read it back — `gh variable get LEGACY_WRITER_ACTIVE
-R <owner>/<repo>` must print `1`. This is the rollback where a JSON `--body` is not a cosmetic
mistake: a value the cloud cannot parse means the switch it was set to is *not* the switch the cloud
reads, and Phase 3 is the one mode where reading it wrong puts a second writer on `sched_*`. The
cloud now refuses to start on a value that is not exactly `0` or `1`, so the failure is a stopped
cron job with an explanation, not a silent claim. The local task recomputes every column it owns on
its next run, so nothing Phase 3 wrote needs undoing. The interlock re-arms by itself: once the task
beats again its heartbeat is newer than any marker, so a later `takeover` refuses until you force
it. Leave the marker where it is — it is the anchor for the query above, and the next Phase 3 run
only refreshes it.

### Phase 4 — decommission the machine

Once `report` has been green for a week in Phase 3, the task can stay off and the machine can stop
being a writer. What none of the above replaces, and still runs there:

- `tools/discover-titles.mjs` and `tools/import-backlog.mjs` — the *choosing* of new titles from
  AniList's trending and popularity lists. Growth in the cloud is a `sync_pending` insert; the
  chooser that decides which ids to queue has no cloud equivalent yet. Queue by hand, or keep the
  task enabled for its choosing only: it writes through `sync-catalogue.mjs`, which stamps
  `catalogue_synced_at`, so its work stays visible in the queries above.
- `tools/sync-catalogue.mjs` for a full rebuild, and `seed.sql` application. Both are deliberate
  and operator-run, and both stamp, so the audit can tell their writes from ours.

### Env, default, phase, rollback

`gh variable set NAME --body VALUE` takes a **literal string**. `--body '{"value":"1"}'` — the shape
a `gh api` example would give you — stores that JSON text as the variable's value, and the sync
refuses to start on it. So: `--body '0'`, `--body '1'`, and read it back with
`gh variable get NAME -R <owner>/<repo>`. The refusal is deliberate rather than forgiving: coerced,
that text is `NaN`, and `NaN` answers to whichever comparison the parser uses — `!== '0'` reads it
as *active*, `=== '1'` as *inactive*. Those are opposite phases, and for the switches below the
difference is who owns `sched_*`, which is the one failure this design must not have.

Everything the code reads, with its default. `--env-file=.env` takes them from the file; a workflow
takes them from repo Variables (or Secrets, for the four marked *secret*). "Phase" is where the
value matters: an off-phase setting is either ignored or the default.

| variable | default | phase | one-line rollback |
| --- | --- | --- | --- |
| `CF_ACCOUNT_ID` | — *secret, required* | all | rotate it: `gh secret set CF_ACCOUNT_ID -R <owner>/<repo>` (re-paste the value) — `gh secret delete` is the rollback that stops every job with `d1: missing environment`, which is the correct outcome for a leaked one |
| `CF_DATABASE_ID` | — *secret, required* | all | `gh secret set CF_DATABASE_ID -R <owner>/<repo>` as above; this one identifies the database, so a wrong value points the sync at a different one rather than failing |
| `CF_API_TOKEN` | — *secret, required* | all | `gh secret set CF_API_TOKEN -R <owner>/<repo>` with a freshly minted token, then revoke the old one in Cloudflare — it can write every row in `anime` |
| `MODE` | unset → derived (=`mirror`) | 1-3 | `gh variable delete MODE -R <owner>/<repo>` — and delete it in the *same* command batch as any phase-switch change, since `resolveMode()` exits 1 when an explicit `MODE` contradicts the switches it also reads |
| `CLOUD_CREATES_ROWS` | unset → `0` | 2-3 | `gh variable set CLOUD_CREATES_ROWS --body '0' -R <owner>/<repo>` |
| `LEGACY_WRITER_ACTIVE` | unset → `1` | 3 | `gh variable set LEGACY_WRITER_ACTIVE --body '1' -R <owner>/<repo>` + `schtasks /Change /TN AniHubHourlyRefresh /ENABLE` |
| `CLOUD_OWNS_GENRES` | unset → `0` | 1-3 | `gh variable set CLOUD_OWNS_GENRES --body '0' -R <owner>/<repo>` |
| `CLOUD_OWNS_SCHEDULE` | unset → `0` | 1-2 | `gh variable set CLOUD_OWNS_SCHEDULE --body '0' -R <owner>/<repo>` (not a phase: it cannot change `MODE`, only fill an empty slot on a row nobody stamped) |
| `LEGACY_QUIET_MS` | `7200000` | 3 | `gh variable delete LEGACY_QUIET_MS -R <owner>/<repo>`; it only guards the handover |
| `MAX_ITEMS_PER_RUN` | `1000` | 1-3 | `gh variable delete MAX_ITEMS_PER_RUN -R <owner>/<repo>` |
| `ANILIST_REWALK_AFTER_MS` | `86400000` | 1-3 | `gh variable delete ANILIST_REWALK_AFTER_MS -R <owner>/<repo>` |
| `ANILIST_TRENDING_PAGE_SIZE` | `50` | 2-3 | `gh variable delete ANILIST_TRENDING_PAGE_SIZE -R <owner>/<repo>` |
| `ANILIST_ENDPOINT` | `https://graphql.anilist.co` | all | `gh variable delete ANILIST_ENDPOINT -R <owner>/<repo>` |
| `ANILIST_METHOD` | `auto` | all | `gh variable delete ANILIST_METHOD -R <owner>/<repo>` |
| `ANILIST_RELAY_PREFIX` | unset → direct | all *secret* | `gh secret delete ANILIST_RELAY_PREFIX -R <owner>/<repo>` — a secret because a relay URL carries its own authorisation; `auto` may fall back to it on a non-JSON 403/405 and **never** on a `blocked` 403 |
| `ANILIST_USER_AGENT` | `AniHubStream/1.0 (catalogue sync; contact: …)` | all | `gh variable delete ANILIST_USER_AGENT -R <owner>/<repo>` (R13: keep a contact route in it) |
| `ANILIST_MIN_INTERVAL_MS` | `2500` | all | `gh variable delete ANILIST_MIN_INTERVAL_MS -R <owner>/<repo>`; clamped up if it would breach the ceiling |
| `ANILIST_RATE_CEILING_RPM` | `24` | all | `gh variable delete ANILIST_RATE_CEILING_RPM -R <owner>/<repo>` — do not raise it; this is the number AniList's window is measured against |
| `ANILIST_BATCH_SIZE` | `25` | all | `gh variable set ANILIST_BATCH_SIZE --body '10' -R <owner>/<repo>` — the first lever when a batched document is slow or rejected (query complexity, above) |
| `ANILIST_INTERVAL_CAP_MS` | `30000` | all | `gh variable delete ANILIST_INTERVAL_CAP_MS -R <owner>/<repo>` |
| `ANILIST_BREAKER_COOLDOWN_MS` | `600000` | all | `gh variable delete ANILIST_BREAKER_COOLDOWN_MS -R <owner>/<repo>` |
| `ANILIST_DAILY_BUDGET` | `4000` | all | `gh variable set ANILIST_DAILY_BUDGET --body '60' -R <owner>/<repo>` for a scoped run; delete to restore |
| `D1_MAX_PARAMS_PER_STATEMENT` | `90` | all | `gh variable delete D1_MAX_PARAMS_PER_STATEMENT -R <owner>/<repo>` — Cloudflare's ceiling, not a tuning knob |
| `D1_MAX_SQL_BYTES` | `90000` | all | `gh variable delete D1_MAX_SQL_BYTES -R <owner>/<repo>` |
| `D1_TIMEOUT_MS` | `30000` | all | `gh variable delete D1_TIMEOUT_MS -R <owner>/<repo>` |
| `SYNC_LEASE_TTL_MS` | `1200000` | all | `gh variable delete SYNC_LEASE_TTL_MS -R <owner>/<repo>` |
| `SYNC_LEASE_RENEW_REQUESTS` | `10` | all | `gh variable delete SYNC_LEASE_RENEW_REQUESTS -R <owner>/<repo>` |
| `KITSU_BASE_URL` | `https://kitsu.io/api/edge` | kitsu | `gh variable delete KITSU_BASE_URL -R <owner>/<repo>` |
| `KITSU_MIN_INTERVAL_MS` | `45000` | kitsu | `gh variable delete KITSU_MIN_INTERVAL_MS -R <owner>/<repo>` |
| `KITSU_PAGE_SIZE` | `20` (clamped to 20) | kitsu | `gh variable set KITSU_PAGE_SIZE --body '20' -R <owner>/<repo>` (or `delete`; 20 is Kitsu's own maximum, so a bigger number is the same run) |
| `KITSU_PAGES_PER_RUN` | `4` | kitsu | `gh variable set KITSU_PAGES_PER_RUN --body '4' -R <owner>/<repo>` — this is the throughput knob: each page is `KITSU_PAGE_SIZE` titles, so 4 pages per 30 minutes is the real rate, and the budget below has to agree with it |
| `KITSU_RUNS_PER_DAY` | `2` | kitsu | `gh variable set KITSU_RUNS_PER_DAY --body '2' -R <owner>/<repo>` — this is the cron in `catalog-sync.yml` (`0 2,14 * * *` × 2) written down, because a runner cannot ask what schedule woke it. `config.test.mjs` parses that cron and fails if the two disagree, so changing the schedule means changing this number in the same commit |
| `KITSU_DAILY_BUDGET` | `KITSU_RUNS_PER_DAY × KITSU_PAGES_PER_RUN + 8` (= 200 at the default) | kitsu | `gh variable set KITSU_DAILY_BUDGET --body '200' -R <owner>/<repo>` — 80 was the value that made every run after roughly the 20th of the day a no-op; raise the budget or cut the pages, but do not leave the two disagreeing |
| `KITSU_TIMEOUT_MS` | `30000` | kitsu | `gh variable set KITSU_TIMEOUT_MS --body '30000' -R <owner>/<repo>` (or `delete` to take the default) |
| `KITSU_USER_AGENT` | same shape as `ANILIST_USER_AGENT` | kitsu | `gh variable delete KITSU_USER_AGENT -R <owner>/<repo>` |
| `HIANIME_PAGES_PER_RUN` | `4` | hianime | `gh variable set HIANIME_PAGES_PER_RUN --body '4' -R <owner>/<repo>` |
| `HIANIME_PAGE_SIZE` | `50` (clamped to 50) | hianime | `gh variable set HIANIME_PAGE_SIZE --body '50' -R <owner>/<repo>` |
| `HIANIME_TIMEOUT_MS` | `25000` | hianime | `gh variable set HIANIME_TIMEOUT_MS --body '25000' -R <owner>/<repo>` |
| `HIANIME_PAGE_DELAY_MS` | `1500` | hianime | `gh variable delete HIANIME_PAGE_DELAY_MS -R <owner>/<repo>` |
| `PROVIDERS_BATCH_SIZE` | `50` | providers | `gh variable set PROVIDERS_BATCH_SIZE --body '50' -R <owner>/<repo>` |
| `EPISODES_BATCH_LIMIT` | `50` | episodes | `gh variable set EPISODES_BATCH_LIMIT --body '50' -R <owner>/<repo>` |
| `PRUNE_RETENTION_DAYS` | `30` | maintenance | `gh variable set PRUNE_RETENTION_DAYS --body '30' -R <owner>/<repo>` |
| `PROVIDER_HEALTH_SAMPLE_SIZE` | `20` | providers | `gh variable set PROVIDER_HEALTH_SAMPLE_SIZE --body '20' -R <owner>/<repo>` |
| `QUIET` | unset | report | `gh variable delete QUIET -R <owner>/<repo>` — `verify.mjs` prints one line instead of an indented object |
| *any switch the run refused to parse* | — | 1-3 | `gh variable set <NAME> --body '<0 or 1>' -R <owner>/<repo>` then `gh variable get <NAME>` — see below, a refused run wrote nothing |

**Not in this table on purpose:** `JITTER_WINDOW_S`. It is read by the workflow's bash step, not by
any Node script, and its default lives next to the `sleep` that uses it in `catalog-sync.yml`. A variable a script never reads does not belong in a table of script
configuration.

**The Kitsu rate, stated as a number rather than as a setting.** `catalog-sync.yml` fires on
`0 2,14 * * *` — 2 runs a day — and each run takes at most `KITSU_PAGES_PER_RUN` (4) pages of
`KITSU_PAGE_SIZE` (20) titles, spaced by `KITSU_MIN_INTERVAL_MS` (45s).
The default budget is `KITSU_RUNS_PER_DAY × KITSU_PAGES_PER_RUN + 8` (16).
`KITSU_RUNS_PER_DAY` is the schedule written down once, in the one place the budget reads it: it cannot be discovered at
runtime, so `config.test.mjs` reads `catalog-sync.yml`, counts the firings, and fails if the constant no
longer matches the cron. That coupling is deliberate — the bug this table row replaced was exactly a
number that had stopped agreeing with a schedule.

**A switch the run refused to parse** (any of the four above, `MAX_ITEMS_PER_RUN` and the other
integers likewise — the error names the variable and shows the value it read):

```
gh variable set <NAME> --body '<0 or 1>' -R <owner>/<repo> && gh variable get <NAME> -R <owner>/<repo>
```

Nothing was written by a run that refused, so the rollback is the corrected value and nothing else:
the cursor, the throttle and the queue are untouched, and the phase you meant to be in is still the
phase the data is in. `Actions → catalog-sync` will pass on the next tick; check with `report`.

`MODE` is the only variable that changes *what gets written*. `CLOUD_CREATES_ROWS` and
`LEGACY_WRITER_ACTIVE` change it by deriving it, and an `MODE` that contradicts them is refused.
`CLOUD_OWNS_GENRES` and `CLOUD_OWNS_SCHEDULE` widen what a mode may write on an existing row without
changing which mode it is. The rest change how fast, how often, and how loudly it refuses.

## What is structurally guaranteed, and what is not

Guaranteed by the code:

- **≤ 24 req/min to AniList, worst case.** Requests are serialized through one promise
  chain and spacing is measured start-to-start inside it, so no parallel path can shorten
  it. `ANILIST_RATE_CEILING_RPM` clamps the floor: an `ANILIST_MIN_INTERVAL_MS` of 100 is
  refused and clamped to 2500ms with a warning, rather than silently giving 600/min.
- **No retry storm on a 403.** Three consecutive 403s open the circuit; a second opening
  aborts the run with state saved. A `blocked` 403 skips straight to the breaker instead
  of burning attempts.
- **No overlapping cloud writers.** GitHub Actions `concurrency` group plus the D1 lease,
  and the lease TTL means a SIGKILLed run cannot hold the lock forever.
- **No overlapping local writers.** Column ownership, not locking: `updateSet(mode)` and the
  local task's write set are disjoint in Phase 1-2 (pinned in `rate.test.mjs`), row creation is
  structurally impossible in `mirror`, and Phase 3 refuses to start while the task's heartbeat is
  young. `verify.mjs` checks the same claim against the data, via the two stamps. The one exception
  is `CLOUD_OWNS_SCHEDULE=1`, and there the disjointness moves from columns to *rows*: the fill
  reaches `sched_*` only inside `SCHED_FILL_GUARD`, which is part of the SQL statement, so a row the
  local task has ever stamped, or that holds any part of a slot, is not writable by it — and it can
  never clear a value, which is the direction that actually loses data.
- **No phase where nobody owns a column.** `LEGACY_WRITER_ACTIVE=0` with `CLOUD_CREATES_ROWS=0` is
  refused at startup: that combination means the local task is stopped while the mode leaves
  `sched_*` to it, so the schedule shelf would silently stop moving and every other check would keep
  passing. The three real answers are in the error (go to `takeover`, put the task back, or turn on
  the fill), and `verify.mjs` reports the same state from data as `someone still owns the schedule
  shelf` for the case a config read cannot see — the task enabled, and not running.
- **No lost or duplicated work.** The cursor advances only after a slice commits, and every
  write is an upsert keyed by id, so replaying a slice is harmless.
- **Every tunable is an env var** with a documented default.

Not guaranteed, and you should not pretend otherwise:

- **That AniList never 403s you.** On a shared IP another tenant can warm the limit for
  you. The breaker and the persisted interval turn that into a slow run, not a ban.
- **That the lease is atomic.** The take-if-expired statement is one CAS, but two writers
  reaching it simultaneously can both win. The CI concurrency group is what closes that
  gap — run one scheduled job per endpoint and do not disable it.
- **Daily budget precision.** The stored total is re-read every 25 spends, so a concurrent
  runner can make us overshoot by up to that check interval before noticing.
- **GitHub Actions cron punctuality.** Scheduled workflows are best-effort and can lag
  minutes during peak load; jittered start plus the cursor make that harmless.
- **That a manual rebuild and a cloud run agree on one column.** `source_ids` is merged in
  SQLite (`json_patch`), so a key the catalogue tools added between our read and our write
  survives. The plain metadata columns are not merged: if you run `tools/sync-catalogue.mjs` by
  hand while a cloud run is in flight, whichever commits last decides `title`/`art`/`rating` for
  that row — and the eleven NOT NULL columns are additionally answered from the row this run read
  (see the clearability table), so a value the local tools changed mid-slice is written back as we
  saw it. Nothing stops you; the two use different lease names. Do it deliberately, not
  simultaneously.
- **That a cloud-created row is curated.** It gets AniList's genres, AniList's artwork and a
  palette accent chosen by id, which is what a locally-created row looks like before an operator
  touches it. `rank`, `alt_seasons` and the AniSkip keys are never written here in any mode, so
  those stay whoever-else-made-them and NULL until you set them.
- **That the overlap check sees every local write.** `no local write after the takeover marker`
  reads `catalogue_synced_at`, which `tools/hourly-refresh.mjs` and `tools/sync-catalogue.mjs` set
  on every row they write. A task running from an old checkout — one from before the stamp existed
  — would collide on `sched_*` and leave nothing behind for the audit to find. After Phase 3 the
  proof is therefore two things: the query, and the task being off. `schtasks /Query /TN AniHubHourlyRefresh`
  says which one you have. And the two clocks differ in resolution: the local stamp is
  `strftime('%s') * 1000`, so it is whole seconds, while the marker is milliseconds. A local write
  in the same second the marker was set is not caught by `>`. Anything from the next second on is.

## If 403s still happen

Raise the interval first — it is the only lever AniList actually measures.

| symptom | change |
| --- | --- |
| occasional 429, `by403` empty | `ANILIST_MIN_INTERVAL_MS` 2500 → 4000 |
| `by403.challenge` | a Cloudflare bot rule, not a rate limit. Lower `ANILIST_DAILY_BUDGET`, slow the cadence; a faster interval will not help |
| `by403.disabled` | AniList's own outage. Do nothing; the breaker is protecting the IP |
| `by403.blocked`, `exit_reason: breaker_aborted` | this egress IP is blocked. Nothing here fixes it: stop the schedule and contact AniList. Do **not** point `ANILIST_RELAY_PREFIX` at it |
| `bisects` > 0 in a summary line | the aliased batch is over AniList's *complexity* budget, so the client is halving it mid-run. Nothing is lost, but each split costs extra requests: set `ANILIST_BATCH_SIZE` **down** (25 → 10), which is the opposite direction from the row below |
| runs never finish the backlog | `ANILIST_BATCH_SIZE` 25 → 40 (fewer requests per title), not a shorter interval |
| catalogue grows faster than one pass/day | `ANILIST_REWALK_AFTER_MS` down, or `MAX_ITEMS_PER_RUN` up — both cost requests, so check `budget_remaining` first |

The relay (`ANILIST_RELAY_PREFIX`) exists for a network path that cannot POST. The
auto-fallback in R12 deliberately refuses to use it when the 403 says *manually blocked* —
that is AniList declining your IP on purpose, and reaching around it through a third-party
proxy is an API-terms problem for you and an account-ban problem for a free host. `pnpm
test`/`node --test` pins that behaviour (`does not fall back to a relay...`).

## Reading a run

One JSON line per run, also stored in `sync_runs`:

```json
{"run_id":"…","mode":"delta","items_processed":100,"created":2,"requests_made":5,"s403":0,"s429":0,
 "breaker_opens":0,"bisects":0,"backoffs":1,"unmapped":2,"skipped":1,"skipped_ids":["some-title (held by anilist 152128)"],
 "genre_labels_unmapped":[["Psychological",34]],
 "effective_interval_ms":2500,"budget_remaining":3991,
 "cursor":{"after":"yuruyuri","pendingAfter":98596,"done":false,"doneAt":0},
 "duration_ms":10240,"exit_reason":"item_cap"}
```

`exit_reason` — `item_cap` (read its share, resume next run), `catalogue_end`/`cursor_end`
(a full pass finished), `budget_exhausted` (daily ceiling), `lease_held` (another cloud
writer owns the lease — expected and harmless), `breaker_aborted` (403s; look at `by403`),
`legacy_still_running` (takeover with the local task still ticking: disable the task, pass
`--force-takeover`, or go back to `mirror`), `schema_mismatch` (production `anime` lacks a column
`ANIME_COLUMNS` names or lacks a table the run reaches: apply `cloud-sync/schema.sql` or fix the
list — the run stopped before the lease and wrote nothing but its own run record, so this is a
schema decision, not a failure to retry), `schema_unwritable` (exit code 1: nothing is missing,
but `anime` has an extra column that is `NOT NULL` with no default, so every insert that omits it
would fail — give it a default or make it nullable), `schema_probe_failed` (exit code 2: the reads
themselves failed — the endpoint refused both the table-valued `pragma_table_info` SELECT and the
`sqlite_master` fallback — which is a different failure from a mismatch, and the fix is to make the
probe answer, see the deploy notes above). Before hunting a column, run `Actions → cloud-ops → doctor-secrets`:
a stored secret with a line break *inside* it never reaches Cloudflare at all, because `Headers.append`
refuses the value, and the runner masks exactly that value to `***` in the log — measured on the pinned
Node, a break at the END of a value is trimmed and sent, so the only version of this failure is a break
at index 0 or somewhere in the middle, and the doctor's two digests say whether the saved secret is the
right token pasted badly or a different string entirely. Then `lease_lost` and `fatal` (exit code 1, alert on these).

`items_processed` counts catalogue rows *read*, not rows written; `created` is how many of them
were inserts; `unmapped` is how many carry no `source_ids.anilist`, so they cannot be refreshed
from here at all; `extra_columns` is how many columns `anime` has that this job never names
(`catalogue_synced_at` and the rest of the local task's set — a count, not a verdict, and it is
non-zero on a healthy database; the one extra shape that is a verdict, `NOT NULL` with no default,
never reaches this count because the run stops as `schema_unwritable` instead). `schema_via` says
which read answered the gate — `pragma_table_info` normally, `sqlite_master` when the endpoint
refused the table-valued SELECT and the columns came from parsed DDL — and it is the same field
the probe prints, there beside `columns.raw`/`tables.raw`, the rows the answer was computed from.
`skipped` is the
hydrated media this run decided not to write, with the reason
per slug. `genre_labels_unmapped` is the AniList labels that have no row in the site's `genre`
table — a growing list there means the shelves need a new genre row, not a new mapping rule.

## Environment

The full list, with defaults, phases and one-line rollbacks, is the table in *Env, default, phase,
rollback* above; `.env.example` is the same set shaped for `--env-file`. The three that decide
whether you get blocked: `ANILIST_MIN_INTERVAL_MS` (2500), `ANILIST_BATCH_SIZE` (25), and
`ANILIST_DAILY_BUDGET` (4000).

## Relationship to `tools/`

`tools/hourly-refresh.mjs` is the same kind of job written for one machine that can reach
AniList: it uses wrangler for D1 and keeps its title list in `tools/catalogue-sources.json`.
This is the version for an environment where nothing is on disk between runs, so the cursor,
the learned interval and the budget all live in D1 — and, from Phase 2, the *title list* does
too, as `sync_pending`.

In Phase 1 they are designed to run side by side, and in Phase 2 they are designed to run side by
side *on one table with two insertion paths*: the local task creates rows from its own curated list,
and from Phase 2 the cloud creates rows from `sync_pending`. That is why an insert is an
`INSERT … ON CONFLICT DO UPDATE` and never `INSERT OR REPLACE` — when both writers reach for the
same slug in the same hour, the row must survive with the union of what each knows, not be replaced
by whichever wrote last. The local task owns `trend_rank` and the `sched_*` air slots in both phases
(it refreshes every row in the table, cloud-created ones included), and cloud-sync owns the metadata
and whatever it created from the queue. What the local task still does that this job does not
replace is *choosing* titles — `discover-titles.mjs` and `import-backlog.mjs` decide which AniList ids
to add by walking the trending and popularity lists; the cloud adds the ones it is told about. Until
that chooser has a cloud equivalent, its decision can be a `sync_pending` insert made by hand, and
the task can stay enabled for the choosing while this job does the refreshing (see Phase 4).
`catalogue-sources.json` is the curation list the local tools use; the cloud job never reads
it, which is why it can be stateless.

### The local task is a second AniList client, and nothing paces it

Everything about rate control in this directory applies to `cloud-sync/anilist.mjs`. The Windows task
is a separate process, on a separate IP — the residential one — with its own `fetch` to
`https://graphql.anilist.co` and **no limiter**: `tools/hourly-refresh.mjs:62` and
`tools/discover-titles.mjs:71` retry on 429/5xx and back off, which is a policy, but they send the
next request as soon as the last one answered, which is not pacing.

The volume is arithmetic, not a guess. Per run: 1 trending page + one 8-id aliased page per eight
titles (`hourly-refresh.mjs:106`) + 1 discovery page when discovery is due + 1 backlog page, so
**2 + ceil(N/8)** AniList requests per hour at N rows carrying an `anilist` id. At the 198 rows in
`seed.sql` that is 27 requests an hour; at 364, 48. They are issued back-to-back inside one chunked
loop, so the peak is not "requests per hour" — it is however many fit in a 60-second window, and on a
fast network that is a number nobody has measured.

That matters for two reasons, and the second is the one that can cost the rollout. The cloud's budget,
breaker and learned interval do not protect this IP: if AniList throttles the residential address, the
cloud job will not notice, and **Phase 3's rollback is "re-enable the Windows task"**. An escape hatch
that has been blocked for a month is not an escape hatch.

So the task now reports its own shape. Every AniList POST from either module is recorded
(`noteAnilistSend()`), and each run appends `anilist_rate: { requests, peak_per_minute, min_gap_ms }`
to its summary line and to `sync_meta.hourly_sync`. Run it for a day and read the worst
`peak_per_minute` — if it is near or above the 24/min the cloud client holds itself to, the local task
should get the same floor, and that is a change to make deliberately, with the task's own timing, not
as a side effect of a migration.

### The three writers agree on the air slot because one function and one test make them

`sched_*` is written from `Media.nextAiringEpisode.airingAt` by three files:
`tools/sync-catalogue.mjs:314` (on insert), `tools/hourly-refresh.mjs:114` and `:119` (hourly), and
`cloud-sync/sync-anilist.mjs` `airSlot()`. All five columns, formatted identically, or the schedule
shelf shows a title moving when it is only being re-labelled.

The quarter rule is now one function — `tools/season.mjs`, called by all three writers — so they
cannot disagree about it by construction. That replaced three hand-written spellings of the same
boundary arithmetic: two ternaries (`tools/hourly-refresh.mjs`, `tools/sync-catalogue.mjs`) and
`airSlot()`'s twelve-entry month-indexed `SEASONS` array, which was correct but was carried by a
comment — the array itself does not say whose quarters it holds, and it sat three lines under
`SEASON_NAME = { WINTER: 'Winter', SPRING: 'Spring', … }`, AniList's own enum, whose quarters are
different. Nothing tested any of the three against the page that reads the column. What an editor who
trusted the wrong convention would have produced, month by month:

| airing in | AniList's quarters | the site requires |
| --- | --- | --- |
| March 2026 | `Spring 2026` | `Winter 2026` |
| June 2026 | `Summer 2026` | `Spring 2026` |
| September 2026 | `Fall 2026` | `Summer 2026` |
| December 2026 | `Winter 2026` | `Fall 2026` |

Jan/Feb, Apr/May, Jul/Aug and Oct/Nov agree under both rules, which is why a wrong quarter is not loud:
it hides four months a year from the shelf the page opens on, and shows the same rows on four shelves
nobody is looking at. `config.test.mjs` pins two things a shared function cannot pin by itself:

- **The JS rule against the frontend's copy, by running both.** `src/data/model.ts:27` computes the
  season the schedule page opens on, and `functions/api/schedule.js:9` matches `sched_season` with an
  exact `=` — so the page's filter and the column it filters on are two derivations in two languages
  that have to be compared over every month edge. The tsconfig covers only `src/`, so the frontend
  cannot import a `.mjs`; executing both is the strongest agreement available. The test also fails if
  a writer re-spells the quarter boundaries instead of calling `seasonKey()`, which is what keeps the
  table above from coming back as an index or as a fourth ternary.
- **Both writers clear the same five columns** when a title stops airing: `airSlot()` returns all-NULL
  for a missing, zero, negative or non-integer `airingAt`, and the legacy statement nulls exactly those
  five. If one cleared and the other left a value, the slot would go stale on one side of the handover.

No production row carries a wrong season label from this: the cloud job has never run, and the local
task rewrites the slot for every row every hour. Had a wrong label been written, `mirror` could not
have repaired it — `sched_*` is deliberately not in its write set — so the fix is a takeover run, or
the local task's next pass, which is the same thing Phase 3 removes.

`cloud-sync/schema.sql` also documents itself as safe to apply to the live database as-is: the
catalogue tables it touches are only `ALTER`ed, additively, and the three state tables it creates
are used by nothing but this job.
