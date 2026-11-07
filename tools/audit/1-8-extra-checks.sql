SELECT 'mal_dupes' AS c, COUNT(*) AS n FROM (
  SELECT mal_id FROM anime_id_map WHERE mal_id IS NOT NULL
  GROUP BY mal_id HAVING COUNT(*) > 1
)
UNION ALL
SELECT 'kitsu_dupes', COUNT(*) FROM (
  SELECT kitsu_id FROM anime_id_map WHERE kitsu_id IS NOT NULL
  GROUP BY kitsu_id HAVING COUNT(*) > 1
)
UNION ALL
SELECT 'anime_total', COUNT(*) FROM anime
UNION ALL
SELECT 'redirects_total', COUNT(*) FROM anime_redirect;
