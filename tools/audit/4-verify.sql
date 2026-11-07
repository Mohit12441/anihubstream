SELECT
  (SELECT COUNT(*) FROM anime_id_map WHERE anikoto_slug IS NOT NULL) AS id_ani,
  (SELECT COUNT(*) FROM anime_provider_mapping WHERE provider_id='anikoto') AS pm_ani,
  (SELECT COUNT(*) FROM anime_id_map WHERE hianime_slug IS NOT NULL) AS id_hia,
  (SELECT COUNT(*) FROM anime_provider_mapping WHERE provider_id='hianime') AS pm_hia,
  (SELECT COUNT(*) FROM anime_id_map WHERE aniwatch_slug IS NOT NULL) AS id_aw,
  (SELECT COUNT(*) FROM anime_provider_mapping WHERE provider_id='aniwatch') AS pm_aw,
  (SELECT COUNT(*) FROM anime_provider_mapping) AS pm_total;
