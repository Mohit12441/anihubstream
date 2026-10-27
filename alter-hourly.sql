-- One-time migration for the hourly sync worker (sync-worker/).
-- trend_rank: this title's position in AniList's global trending list at the last
--   hourly refresh; NULL when the title is not currently trending.
-- sync_meta: bookkeeping for the worker (last run stamp), surfaced by its health check.
-- Apply: wrangler d1 execute anihub --local --file=alter-hourly.sql   (then --remote)

ALTER TABLE anime ADD COLUMN trend_rank INTEGER;

CREATE TABLE IF NOT EXISTS sync_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
