-- ============================================================
-- FINAL D1 CLEANUP — SAFE PHASE
-- Only touches:
--   1. Orphan rows (data integrity)
--   2. Source_ids drift (metadata consistency)
-- Does NOT touch any column that code still reads.
-- ============================================================

-- ════════════════════════════════════════════════════════════
-- STEP 1 — Clean 20 provider_route orphans
-- ════════════════════════════════════════════════════════════
DELETE FROM provider_route
WHERE anime_id NOT IN (SELECT id FROM anime);

-- ════════════════════════════════════════════════════════════
-- STEP 2 — Sync 101 kitsu_id mismatches
-- ════════════════════════════════════════════════════════════
UPDATE anime
SET source_ids = json_set(
  source_ids,
  '$.kitsu',
  (SELECT kitsu_id FROM anime_id_map WHERE anime_id = anime.id)
)
WHERE id IN (
  SELECT a.id FROM anime a
  JOIN anime_id_map m ON m.anime_id = a.id
  WHERE a.source_ids IS NOT NULL AND json_valid(a.source_ids) = 1
    AND m.kitsu_id IS NOT NULL
    AND json_extract(a.source_ids, '$.kitsu') IS NOT NULL
    AND CAST(json_extract(a.source_ids, '$.kitsu') AS INTEGER) != m.kitsu_id
);

-- ════════════════════════════════════════════════════════════
-- STEP 3 — Sync 6 mal_id mismatches
-- ════════════════════════════════════════════════════════════
UPDATE anime
SET source_ids = json_set(
  source_ids,
  '$.mal',
  (SELECT mal_id FROM anime_id_map WHERE anime_id = anime.id)
)
WHERE id IN (
  SELECT a.id FROM anime a
  JOIN anime_id_map m ON m.anime_id = a.id
  WHERE a.source_ids IS NOT NULL AND json_valid(a.source_ids) = 1
    AND m.mal_id IS NOT NULL
    AND json_extract(a.source_ids, '$.mal') IS NOT NULL
    AND CAST(json_extract(a.source_ids, '$.mal') AS INTEGER) != m.mal_id
);
