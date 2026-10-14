-- AniHubStream catalogue + viewer library, Cloudflare D1 (SQLite).
-- Apply with: wrangler d1 execute anihub --local --file=schema.sql

CREATE TABLE IF NOT EXISTS anime (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  native       TEXT NOT NULL,
  year         INTEGER NOT NULL,
  rating       REAL NOT NULL,
  season       TEXT NOT NULL,
  kind         TEXT NOT NULL,
  status       TEXT NOT NULL,
  art          TEXT NOT NULL,            -- poster art key, resolved to a URL by the client
  key_art      TEXT NOT NULL,            -- wide key-art key
  accent       TEXT NOT NULL,
  synopsis     TEXT NOT NULL,
  rank         INTEGER,
  /* Position in AniList's global trending list at the last hourly refresh by
     sync-worker/; NULL when the title is not trending at that moment. */
  trend_rank   INTEGER,
  alt_seasons  TEXT,                     -- JSON array
  sched_day        INTEGER,
  sched_day_label  TEXT,
  sched_date       TEXT,
  sched_time       TEXT,
  sched_season     TEXT,
  /* Provenance for rows pulled from the community databases by tools/sync-catalogue.mjs:
     source_ids is a JSON object of {kitsu, anilist, mal}; episode_total is the source's own
     episode count, which can be larger than the number of rows we actually store;
     skip_key_id/skip_key_space record the id AniSkip was queried under for this title, and
     are only filled in when that id's own reported episode lengths agreed with Kitsu's. */
  source_ids     TEXT,
  skip_key_id    INTEGER,
  skip_key_space TEXT,
  episode_total  INTEGER,
  /* When this title entered the catalogue ('datetime' text). Preserved across
     rebuilds by the sync's ON CONFLICT update; the "Just Added" shelf sorts on it. */
  added_at       TEXT,
  /* Folded title + native + kind + status, built by tools/sync-catalogue.mjs via
     foldSearch() from functions/api/_lib.js. The /api/anime search prefilters on
     this column with LIKE so the ranked matcher never needs a full table scan. */
  search_text    TEXT
);

CREATE INDEX IF NOT EXISTS anime_by_trend ON anime(trend_rank);
CREATE INDEX IF NOT EXISTS anime_by_added ON anime(added_at DESC);

CREATE TABLE IF NOT EXISTS genre (
  id       TEXT PRIMARY KEY,
  label    TEXT NOT NULL,
  tagline  TEXT NOT NULL,
  art      TEXT NOT NULL,
  accent   TEXT NOT NULL,
  position INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS anime_genre (
  anime_id TEXT NOT NULL REFERENCES anime(id) ON DELETE CASCADE,
  genre_id TEXT NOT NULL REFERENCES genre(id),
  PRIMARY KEY (anime_id, genre_id)
);

CREATE TABLE IF NOT EXISTS episode (
  id              TEXT PRIMARY KEY,      -- '<anime_id>#<n>'
  anime_id        TEXT NOT NULL REFERENCES anime(id) ON DELETE CASCADE,
  n               INTEGER NOT NULL,
  title           TEXT NOT NULL,
  runtime         TEXT NOT NULL,
  runtime_seconds INTEGER NOT NULL,
  thumb           TEXT NOT NULL,
  synopsis        TEXT NOT NULL,
  markers         TEXT NOT NULL,         -- JSON array
  airdate         TEXT,                  -- YYYY-MM-DD as published by the source, or NULL
  external_id     TEXT,                  -- the source's own episode id
  UNIQUE (anime_id, n)
);

-- A viewer is an anonymous id in an HttpOnly cookie; nothing here is personally identifying.
CREATE TABLE IF NOT EXISTS viewer (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS library (
  viewer_id TEXT NOT NULL REFERENCES viewer(id) ON DELETE CASCADE,
  anime_id  TEXT NOT NULL REFERENCES anime(id) ON DELETE CASCADE,
  added_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (viewer_id, anime_id)
);

CREATE TABLE IF NOT EXISTS position (
  viewer_id  TEXT NOT NULL REFERENCES viewer(id) ON DELETE CASCADE,
  episode_id TEXT NOT NULL REFERENCES episode(id) ON DELETE CASCADE,
  seconds    REAL NOT NULL CHECK (seconds >= 0),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (viewer_id, episode_id)
);

CREATE INDEX IF NOT EXISTS episode_by_anime ON episode(anime_id, n);
CREATE INDEX IF NOT EXISTS library_by_viewer ON library(viewer_id, added_at DESC);
CREATE INDEX IF NOT EXISTS position_by_viewer ON position(viewer_id, updated_at DESC);

/* Bookkeeping for the hourly sync worker (sync-worker/): one row, 'hourly_sync',
   holding the last run's JSON summary. */
CREATE TABLE IF NOT EXISTS sync_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
