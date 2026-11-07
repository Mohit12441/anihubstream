-- ============================================================
-- PHASE 2 — Add UNIQUE constraints
-- Requires Phase 1 clean: anilist_id, mal_id, kitsu_id, (provider_id, provider_slug)
-- ============================================================

-- Anilist (was 214 dupes, now 0)
CREATE UNIQUE INDEX IF NOT EXISTS uk_id_map_anilist
  ON anime_id_map(anilist_id) WHERE anilist_id IS NOT NULL;

-- MAL (was 0 dupes)
CREATE UNIQUE INDEX IF NOT EXISTS uk_id_map_mal
  ON anime_id_map(mal_id) WHERE mal_id IS NOT NULL;

-- Kitsu (was 15 dupes, now 0 after Phase 1.7b)
CREATE UNIQUE INDEX IF NOT EXISTS uk_id_map_kitsu
  ON anime_id_map(kitsu_id) WHERE kitsu_id IS NOT NULL;

-- Provider slug (was 6 dupes, now 0 after Phase 1.5)
CREATE UNIQUE INDEX IF NOT EXISTS uk_provider_map_slug
  ON anime_provider_mapping(provider_id, provider_slug);
