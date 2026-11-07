SELECT 'anidb_populated' AS c, COUNT(*) AS n FROM anime_id_map WHERE anidb_id IS NOT NULL
UNION ALL
SELECT 'anidb_null', COUNT(*) FROM anime_id_map WHERE anidb_id IS NULL
UNION ALL
SELECT 'anidb_dupe_groups', COUNT(*) FROM (
  SELECT anidb_id FROM anime_id_map
  WHERE anidb_id IS NOT NULL
  GROUP BY anidb_id HAVING COUNT(*) > 1
)
UNION ALL
SELECT 'anilist_dupes', COUNT(*) FROM (
  SELECT anilist_id FROM anime_id_map
  WHERE anilist_id IS NOT NULL
  GROUP BY anilist_id HAVING COUNT(*) > 1
)
UNION ALL
SELECT 'mal_dupes', COUNT(*) FROM (
  SELECT mal_id FROM anime_id_map
  WHERE mal_id IS NOT NULL
  GROUP BY mal_id HAVING COUNT(*) > 1
);
