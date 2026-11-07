-- A. Are all anilist dupes (canonical, hash) pairs?
SELECT 'A_pattern' AS section, m.anilist_id, COUNT(*) AS group_size,
  GROUP_CONCAT(
    CASE WHEN a.id GLOB '*-[a-z0-9][a-z0-9][a-z0-9][a-z0-9]'
      THEN 'HASH:' || a.id ELSE 'CANON:' || a.id END, ' | '
  ) AS ids
FROM anime_id_map m JOIN anime a ON a.id = m.anime_id
WHERE m.anilist_id IS NOT NULL
GROUP BY m.anilist_id HAVING COUNT(*) > 1
ORDER BY m.anilist_id LIMIT 20;

-- B. Both sides canonical? (unexpected — would need manual review)
SELECT 'B_both_canonical' AS section, m.anilist_id,
  GROUP_CONCAT(a.id, ' | ') AS ids
FROM anime_id_map m JOIN anime a ON a.id = m.anime_id
WHERE m.anilist_id IS NOT NULL
  AND NOT (a.id GLOB '*-[a-z0-9][a-z0-9][a-z0-9][a-z0-9]')
GROUP BY m.anilist_id HAVING COUNT(*) > 1 LIMIT 20;

-- C. Both sides hash? (also unexpected)
SELECT 'C_both_hash' AS section, m.anilist_id,
  GROUP_CONCAT(a.id, ' | ') AS ids
FROM anime_id_map m JOIN anime a ON a.id = m.anime_id
WHERE m.anilist_id IS NOT NULL
  AND a.id GLOB '*-[a-z0-9][a-z0-9][a-z0-9][a-z0-9]'
GROUP BY m.anilist_id HAVING COUNT(*) > 1 LIMIT 20;

-- D. How many would be redirected (hash-suffix side)
SELECT 'D_would_redirect' AS section, COUNT(*) AS n
FROM anime_id_map m JOIN anime a ON a.id = m.anime_id
WHERE m.anilist_id IS NOT NULL
  AND a.id GLOB '*-[a-z0-9][a-z0-9][a-z0-9][a-z0-9]'
  AND EXISTS (
    SELECT 1 FROM anime_id_map m2 JOIN anime a2 ON a2.id = m2.anime_id
    WHERE m2.anilist_id = m.anilist_id
      AND NOT (a2.id GLOB '*-[a-z0-9][a-z0-9][a-z0-9][a-z0-9]')
  );

-- E. SAFETY GATE: hash-only titles with no canonical (cannot delete)
SELECT 'E_hash_only' AS section, a.id, a.title
FROM anime a
WHERE a.id GLOB '*-[a-z0-9][a-z0-9][a-z0-9][a-z0-9]'
  AND NOT EXISTS (
    SELECT 1 FROM anime a2
    WHERE LOWER(a2.title) = LOWER(a.title)
      AND NOT (a2.id GLOB '*-[a-z0-9][a-z0-9][a-z0-9][a-z0-9]')
  ) LIMIT 20;
