SELECT '=== COUNTS ===' AS section;
SELECT 'anime' AS t, COUNT(*) AS n FROM anime UNION ALL
SELECT 'anime_id_map', COUNT(*) FROM anime_id_map UNION ALL
SELECT 'anime_provider_mapping', COUNT(*) FROM anime_provider_mapping UNION ALL
SELECT 'provider_route', COUNT(*) FROM provider_route;

SELECT 'episode' AS t, COUNT(*) AS n FROM episode UNION ALL
SELECT 'anime_redirect', COUNT(*) FROM anime_redirect UNION ALL
SELECT 'stream_cache', COUNT(*) FROM stream_cache UNION ALL
SELECT 'sync_lock', COUNT(*) FROM sync_lock;

SELECT '=== DUPLICATES ===' AS section;
SELECT 'anilist_id_dupes' AS check_name, COUNT(*) AS n FROM (
  SELECT anilist_id FROM anime_id_map WHERE anilist_id IS NOT NULL
  GROUP BY anilist_id HAVING COUNT(*) > 1
) UNION ALL
SELECT 'title_dupes', COUNT(*) FROM (
  SELECT LOWER(title) FROM anime GROUP BY LOWER(title) HAVING COUNT(*) > 1
) UNION ALL
SELECT 'provider_slug_dupes', COUNT(*) FROM (
  SELECT provider_id, provider_slug FROM anime_provider_mapping
  GROUP BY provider_id, provider_slug HAVING COUNT(*) > 1
);

SELECT '=== ORPHANS ===' AS section;
SELECT 'redirect_orphans' AS check_name, COUNT(*) AS n
FROM anime_redirect r LEFT JOIN anime a ON a.id = r.to_id WHERE a.id IS NULL;

SELECT '=== EXPIRED ===' AS section;
SELECT 'expired_locks' AS check_name, COUNT(*) AS n FROM sync_lock
WHERE expires_at < CAST(strftime('%s','now') AS INTEGER) * 1000 UNION ALL
SELECT 'expired_cache', COUNT(*) FROM stream_cache
WHERE expires_at < CAST(strftime('%s','now') AS INTEGER) * 1000;

SELECT '=== INTEGRITY ===' AS section;
SELECT 'source_ids_disagreements' AS check_name, COUNT(*) AS n
FROM anime a JOIN anime_id_map m ON m.anime_id = a.id
WHERE a.source_ids IS NOT NULL AND m.anilist_id IS NOT NULL
  AND json_valid(a.source_ids) = 1
  AND json_extract(a.source_ids, '$.anilist') IS NOT NULL
  AND CAST(json_extract(a.source_ids, '$.anilist') AS INTEGER) != m.anilist_id;

SELECT '=== SCHEMA ===' AS section;
SELECT COUNT(*) AS has_anidb_column FROM pragma_table_info('anime_id_map')
WHERE name = 'anidb_id';

PRAGMA foreign_keys;
