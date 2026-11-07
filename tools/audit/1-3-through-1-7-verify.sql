SELECT 'redirect_targets_missing' AS c, COUNT(*) AS n
  FROM anime_redirect r LEFT JOIN anime a ON a.id = r.to_id WHERE a.id IS NULL
UNION ALL
SELECT 'source_ids_disagreements', COUNT(*) FROM anime a JOIN anime_id_map m ON m.anime_id = a.id
  WHERE a.source_ids IS NOT NULL AND m.anilist_id IS NOT NULL
    AND json_valid(a.source_ids) = 1
    AND json_extract(a.source_ids, '$.anilist') IS NOT NULL
    AND CAST(json_extract(a.source_ids, '$.anilist') AS INTEGER) != m.anilist_id
UNION ALL
SELECT 'provider_slug_dupes', COUNT(*) FROM (
  SELECT provider_id, provider_slug FROM anime_provider_mapping
  GROUP BY provider_id, provider_slug HAVING COUNT(*) > 1
)
UNION ALL
SELECT 'expired_locks', COUNT(*) FROM sync_lock
  WHERE expires_at < CAST(strftime('%s','now') AS INTEGER) * 1000
UNION ALL
SELECT 'expired_cache', COUNT(*) FROM stream_cache
  WHERE expires_at < CAST(strftime('%s','now') AS INTEGER) * 1000;
