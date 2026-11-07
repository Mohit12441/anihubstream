-- For every hash-suffix anime, compare its episode count against the
-- canonical anime with the same title. Verdict tells us if deleting
-- the hash-suffix is safe or would destroy data via FK cascade.

SELECT
  a_hash.id AS hash_id,
  a_hash.title AS hash_title,
  (SELECT COUNT(*) FROM episode WHERE anime_id = a_hash.id) AS hash_eps,
  a_canon.id AS canon_id,
  (SELECT COUNT(*) FROM episode WHERE anime_id = a_canon.id) AS canon_eps,
  CASE
    WHEN a_canon.id IS NULL THEN 'NO_CANONICAL_DO_NOT_DELETE'
    WHEN (SELECT COUNT(*) FROM episode WHERE anime_id = a_hash.id) = 0
      THEN 'SAFE_NO_EPISODES'
    WHEN (SELECT COUNT(*) FROM episode WHERE anime_id = a_hash.id)
       = (SELECT COUNT(*) FROM episode WHERE anime_id = a_canon.id)
      THEN 'SAFE_SAME_COUNT'
    WHEN (SELECT COUNT(*) FROM episode WHERE anime_id = a_hash.id)
       < (SELECT COUNT(*) FROM episode WHERE anime_id = a_canon.id)
      THEN 'SAFE_FEWER'
    ELSE 'DANGER_MORE_EPISODES'
  END AS verdict
FROM anime a_hash
LEFT JOIN anime a_canon
  ON LOWER(a_canon.title) = LOWER(a_hash.title)
  AND NOT (a_canon.id GLOB '*-[a-z0-9][a-z0-9][a-z0-9][a-z0-9]')
  AND a_canon.id != a_hash.id
WHERE a_hash.id GLOB '*-[a-z0-9][a-z0-9][a-z0-9][a-z0-9]'
ORDER BY verdict, a_hash.title;
