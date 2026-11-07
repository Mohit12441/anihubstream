-- ============================================================
-- PHASE 4 — Migrate missing slugs from anime_id_map to anime_provider_mapping
--
-- Only inserts rows where the mapping doesn't already exist.
-- Expected additions: anikoto +25, hianime +1, aniwatch +1
-- ============================================================

-- Anikoto
INSERT OR IGNORE INTO anime_provider_mapping
  (anime_id, provider_id, provider_slug, confidence, updated_at)
SELECT anime_id, 'anikoto', anikoto_slug, 1.0, datetime('now')
FROM anime_id_map
WHERE anikoto_slug IS NOT NULL
  AND anime_id IN (SELECT id FROM anime)
  AND NOT EXISTS (
    SELECT 1 FROM anime_provider_mapping pm
    WHERE pm.anime_id = anime_id_map.anime_id
      AND pm.provider_id = 'anikoto'
  );

-- Hianime
INSERT OR IGNORE INTO anime_provider_mapping
  (anime_id, provider_id, provider_slug, confidence, updated_at)
SELECT anime_id, 'hianime', hianime_slug, 1.0, datetime('now')
FROM anime_id_map
WHERE hianime_slug IS NOT NULL
  AND anime_id IN (SELECT id FROM anime)
  AND NOT EXISTS (
    SELECT 1 FROM anime_provider_mapping pm
    WHERE pm.anime_id = anime_id_map.anime_id
      AND pm.provider_id = 'hianime'
  );

-- Aniwatch
INSERT OR IGNORE INTO anime_provider_mapping
  (anime_id, provider_id, provider_slug, confidence, updated_at)
SELECT anime_id, 'aniwatch', aniwatch_slug, 1.0, datetime('now')
FROM anime_id_map
WHERE aniwatch_slug IS NOT NULL
  AND anime_id IN (SELECT id FROM anime)
  AND NOT EXISTS (
    SELECT 1 FROM anime_provider_mapping pm
    WHERE pm.anime_id = anime_id_map.anime_id
      AND pm.provider_id = 'aniwatch'
  );
