-- Search scaling (2026-10-14): /api/anime now ranks matches server-side with
-- the same tokenized matcher the client used. The LIKE prefilter needs a
-- folded copy of the searchable fields on every row; tools/sync-catalogue.mjs
-- fills it from now on, and tools/backfill-search-text.mjs fills the rows
-- that already exist. NULL here reads as "not yet folded", never as "no match"
-- for rows the sync has touched.

ALTER TABLE anime ADD COLUMN search_text TEXT;
