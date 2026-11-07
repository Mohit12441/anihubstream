-- ============================================================
-- FINAL D1 AUDIT
-- Covers: duplicates, orphans, drift, dead data, mapping integrity
-- ============================================================

-- ════════════════════════════════════════════════════════════
-- 1. ALL DUPLICATE COUNTS (one row per check)
-- ════════════════════════════════════════════════════════════
SELECT '=== DUPLICATES ===' AS section;

SELECT 'anilist_dupes' AS check_name, COUNT(*) AS n FROM (
  SELECT anilist_id FROM anime_id_map
  WHERE anilist_id IS NOT NULL GROUP BY anilist_id HAVING COUNT(*) > 1
) UNION ALL
SELECT 'mal_dupes', COUNT(*) FROM (
  SELECT mal_id FROM anime_id_map
  WHERE mal_id IS NOT NULL GROUP BY mal_id HAVING COUNT(*) > 1
) UNION ALL
SELECT 'kitsu_dupes', COUNT(*) FROM (
  SELECT kitsu_id FROM anime_id_map
  WHERE kitsu_id IS NOT NULL GROUP BY kitsu_id HAVING COUNT(*) > 1
);

SELECT 'anidb_dupes' AS check_name, COUNT(*) AS n FROM (
  SELECT anidb_id FROM anime_id_map
  WHERE anidb_id IS NOT NULL GROUP BY anidb_id HAVING COUNT(*) > 1
) UNION ALL
SELECT 'provider_slug_dupes', COUNT(*) FROM (
  SELECT provider_id, provider_slug FROM anime_provider_mapping
  GROUP BY provider_id, provider_slug HAVING COUNT(*) > 1
) UNION ALL
SELECT 'title_dupes', COUNT(*) FROM (
  SELECT LOWER(title) FROM anime GROUP BY LOWER(title) HAVING COUNT(*) > 1
);

-- ════════════════════════════════════════════════════════════
-- 2. ORPHAN COUNTS (rows pointing to deleted parents)
-- ════════════════════════════════════════════════════════════
SELECT '=== ORPHANS ===' AS section;

SELECT 'anime_id_map_orphans' AS check_name, COUNT(*) AS n
FROM anime_id_map m LEFT JOIN anime a ON a.id = m.anime_id WHERE a.id IS NULL
UNION ALL
SELECT 'provider_mapping_orphans', COUNT(*) FROM anime_provider_mapping pm
  LEFT JOIN anime a ON a.id = pm.anime_id WHERE a.id IS NULL
UNION ALL
SELECT 'provider_route_orphans', COUNT(*) FROM provider_route pr
  LEFT JOIN anime a ON a.id = pr.anime_id WHERE a.id IS NULL
UNION ALL
SELECT 'episode_orphans', COUNT(*) FROM episode e
  LEFT JOIN anime a ON a.id = e.anime_id WHERE a.id IS NULL
UNION ALL
SELECT 'redirect_target_orphans', COUNT(*) FROM anime_redirect r
  LEFT JOIN anime a ON a.id = r.to_id WHERE a.id IS NULL;

SELECT 'franchise_anime_orphans' AS check_name, COUNT(*) AS n FROM anime_franchise_relation r
  LEFT JOIN anime a ON a.id = r.anime_id WHERE a.id IS NULL
UNION ALL
SELECT 'franchise_related_orphans', COUNT(*) FROM anime_franchise_relation r
  LEFT JOIN anime a ON a.id = r.related_id WHERE a.id IS NULL
UNION ALL
SELECT 'genre_orphans', COUNT(*) FROM anime_genre ag
  LEFT JOIN anime a ON a.id = ag.anime_id WHERE a.id IS NULL
UNION ALL
SELECT 'library_anime_orphans', COUNT(*) FROM library l
  LEFT JOIN anime a ON a.id = l.anime_id WHERE a.id IS NULL
UNION ALL
SELECT 'position_episode_orphans', COUNT(*) FROM position p
  LEFT JOIN episode e ON e.id = p.episode_id WHERE e.id IS NULL;

-- ════════════════════════════════════════════════════════════
-- 3. DEAD/EXPIRED DATA
-- ════════════════════════════════════════════════════════════
SELECT '=== DEAD DATA ===' AS section;

SELECT 'expired_locks' AS check_name, COUNT(*) AS n FROM sync_lock
WHERE expires_at < CAST(strftime('%s','now') AS INTEGER) * 1000
UNION ALL
SELECT 'expired_cache', COUNT(*) FROM stream_cache
WHERE expires_at < CAST(strftime('%s','now') AS INTEGER) * 1000
UNION ALL
SELECT 'empty_markers_episodes', COUNT(*) FROM episode WHERE markers = '[]';

-- ════════════════════════════════════════════════════════════
-- 4. METADATA MAPPING COVERAGE
-- ════════════════════════════════════════════════════════════
SELECT '=== MAPPING COVERAGE ===' AS section;

SELECT 'total_anime' AS metric, COUNT(*) AS n FROM anime
UNION ALL
SELECT 'anime_with_id_map', COUNT(*) FROM anime a
  WHERE EXISTS (SELECT 1 FROM anime_id_map m WHERE m.anime_id = a.id)
UNION ALL
SELECT 'anime_with_anilist', COUNT(*) FROM anime_id_map WHERE anilist_id IS NOT NULL
UNION ALL
SELECT 'anime_with_mal', COUNT(*) FROM anime_id_map WHERE mal_id IS NOT NULL;

SELECT 'anime_with_kitsu' AS metric, COUNT(*) AS n FROM anime_id_map WHERE kitsu_id IS NOT NULL
UNION ALL
SELECT 'anime_with_anidb', COUNT(*) FROM anime_id_map WHERE anidb_id IS NOT NULL
UNION ALL
SELECT 'anime_with_provider_mapping', COUNT(DISTINCT anime_id) FROM anime_provider_mapping
UNION ALL
SELECT 'anime_with_any_provider', COUNT(*) FROM anime a
  WHERE EXISTS (SELECT 1 FROM anime_provider_mapping pm WHERE pm.anime_id = a.id);

-- ════════════════════════════════════════════════════════════
-- 5. SOURCE_IDS CONSISTENCY (does source_ids agree with anime_id_map?)
-- ════════════════════════════════════════════════════════════
SELECT '=== SOURCE_IDS CONSISTENCY ===' AS section;

SELECT 'anilist_mismatch' AS check_name, COUNT(*) AS n
FROM anime a JOIN anime_id_map m ON m.anime_id = a.id
WHERE a.source_ids IS NOT NULL AND json_valid(a.source_ids) = 1
  AND m.anilist_id IS NOT NULL
  AND json_extract(a.source_ids, '$.anilist') IS NOT NULL
  AND CAST(json_extract(a.source_ids, '$.anilist') AS INTEGER) != m.anilist_id
UNION ALL
SELECT 'mal_mismatch', COUNT(*) FROM anime a JOIN anime_id_map m ON m.anime_id = a.id
WHERE a.source_ids IS NOT NULL AND json_valid(a.source_ids) = 1
  AND m.mal_id IS NOT NULL
  AND json_extract(a.source_ids, '$.mal') IS NOT NULL
  AND CAST(json_extract(a.source_ids, '$.mal') AS INTEGER) != m.mal_id
UNION ALL
SELECT 'kitsu_mismatch', COUNT(*) FROM anime a JOIN anime_id_map m ON m.anime_id = a.id
WHERE a.source_ids IS NOT NULL AND json_valid(a.source_ids) = 1
  AND m.kitsu_id IS NOT NULL
  AND json_extract(a.source_ids, '$.kitsu') IS NOT NULL
  AND CAST(json_extract(a.source_ids, '$.kitsu') AS INTEGER) != m.kitsu_id;

-- ════════════════════════════════════════════════════════════
-- 6. LEGACY SLUG COLUMNS STILL POPULATED?
-- (these were supposed to be consolidated into provider_mapping)
-- ════════════════════════════════════════════════════════════
SELECT '=== LEGACY SLUG COLUMNS ===' AS section;

SELECT 'anikoto_slug_in_id_map' AS check_name, COUNT(*) AS n
FROM anime_id_map WHERE anikoto_slug IS NOT NULL
UNION ALL
SELECT 'hianime_slug_in_id_map', COUNT(*) FROM anime_id_map WHERE hianime_slug IS NOT NULL
UNION ALL
SELECT 'aniwatch_slug_in_id_map', COUNT(*) FROM anime_id_map WHERE aniwatch_slug IS NOT NULL
UNION ALL
SELECT 'waw_slug_in_id_map', COUNT(*) FROM anime_id_map WHERE waw_slug IS NOT NULL;

SELECT 'adb_slug_in_id_map' AS check_name, COUNT(*) AS n FROM anime_id_map WHERE adb_slug IS NOT NULL
UNION ALL
SELECT 'provider_mapping_anikoto', COUNT(*) FROM anime_provider_mapping WHERE provider_id = 'anikoto'
UNION ALL
SELECT 'provider_mapping_hianime', COUNT(*) FROM anime_provider_mapping WHERE provider_id = 'hianime'
UNION ALL
SELECT 'provider_mapping_aniwatch', COUNT(*) FROM anime_provider_mapping WHERE provider_id = 'aniwatch';

-- ════════════════════════════════════════════════════════════
-- 7. PROVIDER_ROUTE STATE (the negative cache)
-- ════════════════════════════════════════════════════════════
SELECT '=== PROVIDER_ROUTE ===' AS section;

SELECT provider_id, server, status, COUNT(*) AS n
FROM provider_route GROUP BY provider_id, server, status ORDER BY n DESC;

-- ════════════════════════════════════════════════════════════
-- 8. TABLES WITH 0 ROWS (candidates for drop?)
-- ════════════════════════════════════════════════════════════
SELECT '=== EMPTY TABLES ===' AS section;

SELECT 'anime_redirect' AS t, COUNT(*) AS n FROM anime_redirect
UNION ALL SELECT 'sync_pending', COUNT(*) FROM sync_pending
UNION ALL SELECT 'library', COUNT(*) FROM library
UNION ALL SELECT 'position', COUNT(*) FROM position
UNION ALL SELECT 'viewer', COUNT(*) FROM viewer;

-- ════════════════════════════════════════════════════════════
-- 9. SYNC_META STATE (stale writers?)
-- ════════════════════════════════════════════════════════════
SELECT '=== SYNC_META ===' AS section;

SELECT key, LENGTH(value) AS bytes FROM sync_meta ORDER BY key;

-- ════════════════════════════════════════════════════════════
-- 10. STREAM_CACHE HEALTH
-- ════════════════════════════════════════════════════════════
SELECT '=== STREAM_CACHE ===' AS section;

SELECT
  CASE
    WHEN key LIKE 'stream:%' THEN 'stream'
    WHEN key LIKE 'aniskip:%' THEN 'aniskip'
    ELSE 'other'
  END AS kind,
  COUNT(*) AS n,
  SUM(CASE WHEN expires_at < CAST(strftime('%s','now') AS INTEGER) * 1000 THEN 1 ELSE 0 END) AS expired
FROM stream_cache GROUP BY kind;

-- ════════════════════════════════════════════════════════════
-- 11. INACTIVE PROVIDERS (any provider_id in mapping that isn't in registry?)
-- ════════════════════════════════════════════════════════════
SELECT '=== PROVIDER_MAPPING BY PROVIDER ===' AS section;

SELECT provider_id, COUNT(*) AS n
FROM anime_provider_mapping GROUP BY provider_id ORDER BY n DESC;

-- ════════════════════════════════════════════════════════════
-- 12. ROW COUNTS (final snapshot)
-- ════════════════════════════════════════════════════════════
SELECT '=== FINAL COUNTS ===' AS section;

SELECT 'anime' AS t, COUNT(*) AS n FROM anime
UNION ALL SELECT 'anime_id_map', COUNT(*) FROM anime_id_map
UNION ALL SELECT 'anime_provider_mapping', COUNT(*) FROM anime_provider_mapping
UNION ALL SELECT 'provider_route', COUNT(*) FROM provider_route;

SELECT 'episode' AS t, COUNT(*) AS n FROM episode
UNION ALL SELECT 'anime_redirect', COUNT(*) FROM anime_redirect
UNION ALL SELECT 'stream_cache', COUNT(*) FROM stream_cache;
