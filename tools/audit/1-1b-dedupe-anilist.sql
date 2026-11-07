-- ============================================================
-- PHASE 1.1b — Dedupe anilist_id (adjusted for GLOB + DANGER cases)
-- Note: D1 authorizer blocks CREATE TEMP TABLE, so we use regular tables with cleanup
-- ============================================================

DROP TABLE IF EXISTS _anilist_groups;
DROP TABLE IF EXISTS _anilist_scored;
DROP TABLE IF EXISTS _canonical_anilist;
DROP TABLE IF EXISTS _safe_redirects;
DROP TABLE IF EXISTS _unsafe_anilist;

-- Step 1: Build annotated group table
CREATE TABLE _anilist_groups AS
SELECT
  m.anilist_id,
  m.anime_id,
  a.added_at,
  (SELECT COUNT(*) FROM episode WHERE anime_id = m.anime_id) AS ep_count,
  CASE WHEN a.id GLOB '*-[a-z0-9][a-z0-9][a-z0-9][a-z0-9]' THEN 1 ELSE 0 END AS is_hash_like,
  LENGTH(a.id) AS id_len
FROM anime_id_map m
JOIN anime a ON a.id = m.anime_id
WHERE m.anilist_id IS NOT NULL
  AND m.anilist_id IN (
    SELECT anilist_id FROM anime_id_map
    WHERE anilist_id IS NOT NULL
    GROUP BY anilist_id HAVING COUNT(*) > 1
  );

-- Step 2: Score each row (rn=1 is canonical)
CREATE TABLE _anilist_scored AS
SELECT anilist_id, anime_id, ep_count,
  ROW_NUMBER() OVER (
    PARTITION BY anilist_id
    ORDER BY ep_count DESC, is_hash_like ASC, added_at ASC, id_len ASC
  ) AS rn
FROM _anilist_groups;

-- Step 3: Pick canonical
CREATE TABLE _canonical_anilist AS
SELECT anilist_id, anime_id AS canonical_id, ep_count AS canonical_eps
FROM _anilist_scored WHERE rn = 1;

-- Step 4: Identify SAFE redirects (all non-canonical episodes exist in canonical)
CREATE TABLE _safe_redirects AS
SELECT s.anilist_id, s.anime_id AS from_id, c.canonical_id
FROM _anilist_scored s
JOIN _canonical_anilist c ON c.anilist_id = s.anilist_id
WHERE s.rn > 1
  AND NOT EXISTS (
    SELECT 1 FROM episode e_hash
    WHERE e_hash.anime_id = s.anime_id
      AND NOT EXISTS (
        SELECT 1 FROM episode e_canon
        WHERE e_canon.anime_id = c.canonical_id
          AND e_canon.n = e_hash.n
      )
  );

-- Step 5: Identify UNSAFE (DANGER) — non-canonical that can't be fully redirected
CREATE TABLE _unsafe_anilist AS
SELECT s.anilist_id, s.anime_id, c.canonical_id
FROM _anilist_scored s
JOIN _canonical_anilist c ON c.anilist_id = s.anilist_id
WHERE s.rn > 1
  AND NOT EXISTS (
    SELECT 1 FROM _safe_redirects sr WHERE sr.from_id = s.anime_id
  );

-- Step 6: Apply SAFE — insert redirect, delete id_map row
INSERT OR IGNORE INTO anime_redirect (from_id, to_id)
SELECT from_id, canonical_id FROM _safe_redirects WHERE from_id != canonical_id;

DELETE FROM anime_id_map
WHERE anime_id IN (SELECT from_id FROM _safe_redirects);

-- Step 7: Apply UNSAFE — null out anilist_id (UNIQUE-safe because NULL doesn't conflict)
UPDATE anime_id_map
SET anilist_id = NULL
WHERE anime_id IN (SELECT anime_id FROM _unsafe_anilist);

-- Step 8: Cleanup tables
DROP TABLE IF EXISTS _anilist_groups;
DROP TABLE IF EXISTS _anilist_scored;
DROP TABLE IF EXISTS _canonical_anilist;
DROP TABLE IF EXISTS _safe_redirects;
DROP TABLE IF EXISTS _unsafe_anilist;
