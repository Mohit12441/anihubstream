-- ============================================================
-- PHASE 3a — Add anidb_id column + indexes
-- No data written. Purely additive.
-- ============================================================

-- Add the column (NULL by default, no constraint at this point)
ALTER TABLE anime_id_map ADD COLUMN anidb_id INTEGER;

-- Regular index for lookups by anidb_id
CREATE INDEX IF NOT EXISTS id_map_by_anidb
  ON anime_id_map(anidb_id);

-- UNIQUE index for enforcement (NULLs don't conflict, so this is safe)
CREATE UNIQUE INDEX IF NOT EXISTS uk_id_map_anidb
  ON anime_id_map(anidb_id) WHERE anidb_id IS NOT NULL;
