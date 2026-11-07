DROP TABLE IF EXISTS _provider_dupes_to_delete;
CREATE TABLE _provider_dupes_to_delete AS
SELECT provider_id, provider_slug, anime_id
FROM (
  SELECT pm.provider_id, pm.provider_slug, pm.anime_id,
    ROW_NUMBER() OVER (
      PARTITION BY pm.provider_id, pm.provider_slug
      ORDER BY
        CASE WHEN a.id = pm.provider_slug THEN 0 ELSE 1 END ASC,
        CASE WHEN a.id GLOB '*-[a-z0-9][a-z0-9][a-z0-9][a-z0-9]' THEN 1 ELSE 0 END ASC,
        a.added_at ASC,
        a.id ASC
    ) AS rn
  FROM anime_provider_mapping pm
  JOIN anime a ON a.id = pm.anime_id
  WHERE (pm.provider_id, pm.provider_slug) IN (
    SELECT provider_id, provider_slug FROM anime_provider_mapping
    GROUP BY provider_id, provider_slug HAVING COUNT(*) > 1
  )
) WHERE rn > 1;

DELETE FROM anime_provider_mapping
WHERE (provider_id, provider_slug, anime_id) IN (
  SELECT provider_id, provider_slug, anime_id FROM _provider_dupes_to_delete
);

DROP TABLE IF EXISTS _provider_dupes_to_delete;
