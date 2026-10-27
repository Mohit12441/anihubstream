-- State for the cloud sync (cloud-sync/) — everything in this file is additive to the
-- catalogue tables, so it is safe to apply to the live database as it stands.
--
-- Apply with:  wrangler d1 execute anihub --remote --file=cloud-sync/schema.sql
--         or:  gh workflow run ops.yml (Actions → Operations → apply-schema)
--
-- Four kinds of state, all of which must survive across runs, because a run that forgets
-- them starts every cron tick at the fastest setting and re-walks the same work:
--   sync_lock    -- one live writer per endpoint (without it an overrunning run overlaps the
--                   next tick and silently doubles the request rate)
--   api_usage    -- per-UTC-day request count, the outer ceiling on AniList spend
--   sync_runs    -- one row per run: the summary line, so a failure is auditable later
--   sync_pending -- the titles the cloud is allowed to create (Phase 2 onwards)
-- The learned throttle interval and the incremental cursor are JSON rows in the existing
-- sync_meta table, under keys namespaced 'cloud_' so they cannot collide with the
-- 'hourly_sync' / 'discovery' records the operator task writes.
--
-- Statements are ordered so that everything idempotent comes first and the run-once ALTER
-- tail last: re-applying the file then completes every CREATE before it stops on the ALTERs.

CREATE TABLE IF NOT EXISTS sync_lock (
  name       TEXT PRIMARY KEY,          -- 'anilist' | 'kitsu'
  owner      TEXT NOT NULL,             -- '<endpoint>-<run_id>'
  expires_at INTEGER NOT NULL           -- unix ms; a dead run's lease simply expires
);

CREATE TABLE IF NOT EXISTS api_usage (
  day       TEXT NOT NULL,              -- YYYY-MM-DD, UTC
  endpoint  TEXT NOT NULL,              -- 'anilist' | 'kitsu'
  requests  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, endpoint)
);

CREATE TABLE IF NOT EXISTS sync_runs (
  run_id      TEXT PRIMARY KEY,
  endpoint    TEXT NOT NULL,
  started_at  INTEGER NOT NULL,         -- unix ms
  duration_ms INTEGER NOT NULL,
  exit_reason TEXT NOT NULL,            -- catalogue_end | item_cap | budget_exhausted | ...
  summary     TEXT NOT NULL             -- the JSON summary line, verbatim
);

CREATE INDEX IF NOT EXISTS sync_runs_by_endpoint ON sync_runs(endpoint, started_at DESC);
CREATE INDEX IF NOT EXISTS api_usage_by_day ON api_usage(day);

-- The discovery queue, and the only place a new title can come from. The sync never walks
-- AniList's popularity or trending lists looking for titles to add (R4: the read path is a
-- keyset walk over rows the catalogue already owns), because that would spend requests on
-- titles the site does not host and would add titles no human chose. So a title is queued on
-- purpose:
--
--   INSERT INTO sync_pending (anilist_id, slug, added_at, note)
--   VALUES (52174, 'frieren-beyond-journeys-end', 1760000000000, 'operator request');
--
-- `slug` is the id the row will get and must be built with the same rule as
-- slugify() in tools/discover-titles.mjs (also exported from cloud-sync/sync-anilist.mjs) —
-- a divergent slug means a second row for a title the catalogue already owns. The sync
-- re-derives the slug from the title AniList reports and uses THAT for the insert, so a
-- wrong `slug` here costs a duplicate rather than corrupting a row: the value is read only
-- to join against `anime` and decide "create or refresh".
--
-- anilist_id is an INTEGER PRIMARY KEY, which in SQLite is the rowid: rows are already
-- stored in keyset order, so no extra index is needed for `WHERE anilist_id > ?`.
CREATE TABLE IF NOT EXISTS sync_pending (
  anilist_id INTEGER PRIMARY KEY,
  slug       TEXT NOT NULL,
  added_at   INTEGER NOT NULL,          -- unix ms; audit only, the cursor is anilist_id
  note       TEXT                       -- who asked for it and why
);

-- ---------------------------------------------------------------------------
-- Run-once tail. SQLite has no ALTER TABLE ... ADD COLUMN IF NOT EXISTS, so
-- re-applying this file stops here with "duplicate column name" — that error IS
-- the guard, and everything above it has already been applied idempotently by
-- the time you see it. Apply the file again only after deleting the two ALTER
-- lines, or use ops.yml's apply-schema step, which reports it as expected.
--
-- The two stamps are what make the handover auditable: each writer sets only its
-- own, so a row's pair of timestamps says which writers have touched it and when.
-- It is also how a cloud-created row is told apart from a catalogue-created one
-- (catalogue_synced_at IS NULL AND cloud_synced_at IS NOT NULL), which is the
-- test CLOUD_OWNS_GENRES=1 uses before it replaces anyone's genre set.
ALTER TABLE anime ADD COLUMN cloud_synced_at INTEGER;
-- TRANSITIONAL. Root schema.sql owns the `anime` table and defines catalogue_synced_at there; this
-- line exists only to bring an existing production database up to the same shape. Once
-- cloud-sync/schema.live.sql shows the column present in production, delete this line: the
-- `schema.sql + cloud-sync/schema.sql` composition test in migration.test.mjs tolerates exactly the
-- one duplicate it produces today and asserts zero duplicates after the deletion.
ALTER TABLE anime ADD COLUMN catalogue_synced_at INTEGER;

-- Indexes for the audit queries in verify.mjs. They follow the ALTERs because they depend on
-- those columns existing, which means a re-run of this file does not reach them — harmless,
-- CREATE INDEX IF NOT EXISTS is a no-op on a database that already ran once.
CREATE INDEX IF NOT EXISTS anime_cloud_synced ON anime(cloud_synced_at);
CREATE INDEX IF NOT EXISTS anime_catalogue_synced ON anime(catalogue_synced_at);
