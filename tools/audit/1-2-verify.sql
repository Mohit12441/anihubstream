SELECT 'anime_total' AS c, COUNT(*) AS n FROM anime
UNION ALL
SELECT 'hash_remaining', COUNT(*) FROM anime
  WHERE id GLOB '*-[a-z0-9][a-z0-9][a-z0-9][a-z0-9]'
UNION ALL
SELECT 'redirects_total', COUNT(*) FROM anime_redirect
UNION ALL
SELECT 'anilist_dupes', COUNT(*) FROM (
  SELECT anilist_id FROM anime_id_map
  WHERE anilist_id IS NOT NULL
  GROUP BY anilist_id HAVING COUNT(*) > 1
)
UNION ALL
SELECT 'title_dupes', COUNT(*) FROM (
  SELECT LOWER(title) FROM anime
  GROUP BY LOWER(title) HAVING COUNT(*) > 1
);
