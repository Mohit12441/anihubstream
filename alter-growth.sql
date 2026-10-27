-- Catalogue growth (2026-10-14): the site now grows by 15-20 real titles per
-- 30 minutes through tools/import-backlog.mjs, and the home page shows a
-- "Just Added" shelf. That needs an entry timestamp per title, plus indexes
-- for the sorts the scaled API runs against. Existing rows (the hand-picked
-- seeds and the first two discovered titles) are backfilled to a fixed
-- earlier timestamp so they never outrank real imports on the shelf.

ALTER TABLE anime ADD COLUMN added_at TEXT;

UPDATE anime SET added_at = '2026-10-13 00:00:00' WHERE added_at IS NULL;

CREATE INDEX IF NOT EXISTS anime_by_trend ON anime(trend_rank);
CREATE INDEX IF NOT EXISTS anime_by_added ON anime(added_at DESC);
