SELECT 'targets_missing' AS check_name, COUNT(*) AS n
FROM anime_redirect r
LEFT JOIN anime a ON a.id = r.to_id WHERE a.id IS NULL;

SELECT 'sources_missing' AS check_name, COUNT(*) AS n
FROM anime_redirect r
LEFT JOIN anime a ON a.id = r.from_id WHERE a.id IS NULL;

SELECT 'both_exist' AS check_name, COUNT(*) AS n
FROM anime_redirect r
JOIN anime a ON a.id = r.to_id
JOIN anime b ON b.id = r.from_id;

SELECT 'self_loops' AS check_name, COUNT(*) AS n
FROM anime_redirect WHERE from_id = to_id;
