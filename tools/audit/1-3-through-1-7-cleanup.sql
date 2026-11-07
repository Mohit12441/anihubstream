-- ============================================================
-- PHASE 1.3-1.7 — remaining cleanup steps
-- All safe: no anime deletes, no cascade risk
-- ============================================================

-- Phase 1.3: clean redirect targets (all should be valid → likely 0 rows)
DELETE FROM anime_redirect
WHERE to_id NOT IN (SELECT id FROM anime);

-- Phase 1.4: sync source_ids from anime_id_map
UPDATE anime
SET source_ids = json_set(
  source_ids, '$.anilist',
  (SELECT anilist_id FROM anime_id_map WHERE anime_id = anime.id)
)
WHERE id IN (
  SELECT a.id FROM anime a JOIN anime_id_map m ON m.anime_id = a.id
  WHERE a.source_ids IS NOT NULL AND json_valid(a.source_ids) = 1
    AND m.anilist_id IS NOT NULL
    AND json_extract(a.source_ids, '$.anilist') IS NOT NULL
    AND CAST(json_extract(a.source_ids, '$.anilist') AS INTEGER) != m.anilist_id
);

-- Phase 1.5: provider slug dedupe (D1 blocks TEMP TABLE → use regular table)
DROP TABLE IF EXISTS _canonical_provider;
CREATE TABLE _canonical_provider AS
SELECT pm.provider_id, pm.provider_slug, pm.anime_id AS canonical_id
FROM anime_provider_mapping pm JOIN anime a ON a.id = pm.anime_id
WHERE pm.anime_id = (
  SELECT a2.id FROM anime_provider_mapping pm2 JOIN anime a2 ON a2.id = pm2.anime_id
  WHERE pm2.provider_id = pm.provider_id
    AND pm2.provider_slug = pm.provider_slug
  ORDER BY
    CASE WHEN a2.id GLOB '*-[a-z0-9][a-z0-9][a-z0-9][a-z0-9]' THEN 1 ELSE 0 END ASC,
    a2.added_at ASC
  LIMIT 1
);

DELETE FROM anime_provider_mapping
WHERE (provider_id, provider_slug) IN
  (SELECT provider_id, provider_slug FROM _canonical_provider)
  AND anime_id NOT IN (SELECT canonical_id FROM _canonical_provider);

DROP TABLE IF EXISTS _canonical_provider;

-- Phase 1.6: prune expired locks
DELETE FROM sync_lock
WHERE expires_at < CAST(strftime('%s','now') AS INTEGER) * 1000;

-- Phase 1.7: prune expired cache
DELETE FROM stream_cache
WHERE expires_at < CAST(strftime('%s','now') AS INTEGER) * 1000;
