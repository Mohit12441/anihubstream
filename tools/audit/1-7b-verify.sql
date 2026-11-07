SELECT 'kitsu_dupes_after' AS c, COUNT(*) AS n FROM (
  SELECT kitsu_id FROM anime_id_map WHERE kitsu_id IS NOT NULL
  GROUP BY kitsu_id HAVING COUNT(*) > 1
)
UNION ALL
SELECT 'kitsu_null', COUNT(*) FROM anime_id_map WHERE kitsu_id IS NULL;
