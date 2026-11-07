-- ============================================================
-- PHASE 1.7b — Dedupe kitsu_id (needed before UNIQUE constraint)
--
-- Strategy: null out kitsu_id on non-canonical. Do NOT delete anime.
-- Reason: kitsu_id is not used for playback; nulling loses nothing.
-- ============================================================

DROP TABLE IF EXISTS _kitsu_groups;
CREATE TABLE _kitsu_groups AS
SELECT m.kitsu_id, m.anime_id,
  (SELECT COUNT(*) FROM episode WHERE anime_id = m.anime_id) AS ep_count,
  CASE WHEN m.anime_id GLOB '*-[a-z0-9][a-z0-9][a-z0-9][a-z0-9]' THEN 1 ELSE 0 END AS is_hash,
  a.added_at,
  LENGTH(m.anime_id) AS id_len
FROM anime_id_map m JOIN anime a ON a.id = m.anime_id
WHERE m.kitsu_id IS NOT NULL
  AND m.kitsu_id IN (
    SELECT kitsu_id FROM anime_id_map
    WHERE kitsu_id IS NOT NULL
    GROUP BY kitsu_id HAVING COUNT(*) > 1
  );

DROP TABLE IF EXISTS _kitsu_ranked;
CREATE TABLE _kitsu_ranked AS
SELECT kitsu_id, anime_id,
  ROW_NUMBER() OVER (
    PARTITION BY kitsu_id
    ORDER BY ep_count DESC, is_hash ASC, added_at ASC, id_len ASC
  ) AS rn
FROM _kitsu_groups;

-- Pre-flight: how many will be nulled
SELECT 'WOULD_NULL' AS c, COUNT(*) AS n FROM _kitsu_ranked WHERE rn > 1;
SELECT 'CANONICAL_KEPT' AS c, COUNT(*) AS n FROM _kitsu_ranked WHERE rn = 1;

UPDATE anime_id_map
SET kitsu_id = NULL
WHERE anime_id IN (SELECT anime_id FROM _kitsu_ranked WHERE rn > 1);

DROP TABLE IF EXISTS _kitsu_groups;
DROP TABLE IF EXISTS _kitsu_ranked;
