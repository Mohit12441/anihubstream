-- Adds the columns tools/sync-catalogue.mjs writes.
-- Apply to an existing database with:
--   wrangler d1 execute anihub --local  --file=alter-sync.sql
--   wrangler d1 execute anihub --remote --file=alter-sync.sql
-- Every statement is a no-op-safe ADD COLUMN; existing rows keep their values and
-- simply read back as NULL until the next sync fills them in.

ALTER TABLE anime ADD COLUMN source_ids TEXT;
ALTER TABLE anime ADD COLUMN skip_key_id INTEGER;
ALTER TABLE anime ADD COLUMN skip_key_space TEXT;
ALTER TABLE anime ADD COLUMN episode_total INTEGER;
ALTER TABLE episode ADD COLUMN airdate TEXT;
ALTER TABLE episode ADD COLUMN external_id TEXT;
