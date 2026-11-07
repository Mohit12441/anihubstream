SELECT a_hash.id AS hash_id, (SELECT COUNT(*) FROM episode WHERE anime_id = a_hash.id) AS hash_eps, a_canon.id AS canon_id, (SELECT COUNT(*) FROM episode WHERE anime_id = a_canon.id) AS canon_eps, a_hash.title
FROM anime a_hash
JOIN anime a_canon ON LOWER(a_canon.title) = LOWER(a_hash.title)
  AND NOT (a_canon.id GLOB '*-[a-z0-9][a-z0-9][a-z0-9][a-z0-9]')
  AND a_canon.id != a_hash.id
WHERE a_hash.id GLOB '*-[a-z0-9][a-z0-9][a-z0-9][a-z0-9]'
  AND (SELECT COUNT(*) FROM episode WHERE anime_id = a_hash.id) > (SELECT COUNT(*) FROM episode WHERE anime_id = a_canon.id)
ORDER BY a_hash.title;
