SELECT 'anilist_dupes' AS c, COUNT(*) AS n FROM (
  SELECT anilist_id FROM anime_id_map
  WHERE anilist_id IS NOT NULL
  GROUP BY anilist_id HAVING COUNT(*) > 1
)
UNION ALL
SELECT 'null_anilist', COUNT(*) FROM anime_id_map WHERE anilist_id IS NULL
UNION ALL
SELECT 'redirects_total', COUNT(*) FROM anime_redirect;
