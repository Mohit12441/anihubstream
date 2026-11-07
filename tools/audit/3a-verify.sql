SELECT 'column_exists' AS c,
  COUNT(*) AS n
FROM pragma_table_info('anime_id_map')
WHERE name = 'anidb_id'
UNION ALL
SELECT 'indexes_exist', COUNT(*)
FROM sqlite_master
WHERE type = 'index' AND name IN ('id_map_by_anidb', 'uk_id_map_anidb')
UNION ALL
SELECT 'anidb_null_count', COUNT(*)
FROM anime_id_map WHERE anidb_id IS NULL
UNION ALL
SELECT 'anidb_populated', COUNT(*)
FROM anime_id_map WHERE anidb_id IS NOT NULL;
