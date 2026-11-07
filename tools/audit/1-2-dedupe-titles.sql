-- ============================================================
-- PHASE 1.2 — Delete safe hash-suffix anime rows
--
-- Uses GLOB (SQLite LIKE doesn't support character classes)
-- Only deletes hash-suffix anime where hash_ep <= canonical_ep
-- DANGER (hash_eps > canon_eps) and NO_CANONICAL are excluded
-- ============================================================

-- Step 1: Build safe-to-delete list
DROP TABLE IF EXISTS _safe_to_delete;
CREATE TABLE _safe_to_delete AS
SELECT
  a_hash.id AS hash_id,
  a_hash.title AS hash_title,
  (SELECT COUNT(*) FROM episode WHERE anime_id = a_hash.id) AS hash_eps,
  a_canon.id AS canonical_id,
  (SELECT COUNT(*) FROM episode WHERE anime_id = a_canon.id) AS canon_eps
FROM anime a_hash
JOIN anime a_canon
  ON LOWER(a_canon.title) = LOWER(a_hash.title)
  AND a_canon.id != a_hash.id
WHERE a_hash.id GLOB '*-[a-z0-9][a-z0-9][a-z0-9][a-z0-9]'
  AND (SELECT COUNT(*) FROM episode WHERE anime_id = a_hash.id)
   <= (SELECT COUNT(*) FROM episode WHERE anime_id = a_canon.id);

-- Step 2: Deduplicate (a hash might match multiple canonicals)
DROP TABLE IF EXISTS _safe_final;
CREATE TABLE _safe_final AS
SELECT hash_id, canonical_id, hash_eps, canon_eps
FROM (
  SELECT *,
    ROW_NUMBER() OVER (PARTITION BY hash_id ORDER BY canonical_id ASC) AS rn
  FROM _safe_to_delete
) WHERE rn = 1;

-- Step 3: Pre-flight safety check
SELECT 'PRE_FLIGHT_SAFE_COUNT' AS check_name, COUNT(*) AS n FROM _safe_final;
SELECT 'PRE_FLIGHT_DANGER_LEAK' AS check_name, COUNT(*) AS n
FROM _safe_final WHERE hash_eps > canon_eps;

-- Step 4: Insert redirects
INSERT OR IGNORE INTO anime_redirect (from_id, to_id)
SELECT hash_id, canonical_id FROM _safe_final WHERE hash_id != canonical_id;

-- Step 5: Delete the anime rows (FK cascade handles episodes, id_map, provider_mapping)
DELETE FROM anime
WHERE id IN (SELECT hash_id FROM _safe_final WHERE hash_id != canonical_id);

-- Step 6: Cleanup
DROP TABLE _safe_to_delete;
DROP TABLE _safe_final;
