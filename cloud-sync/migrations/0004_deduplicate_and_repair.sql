-- Migration 0004: Deduplicate anime records, resolve cross-season ID collisions, and align episode counts

-- 1. Create redirect table if not exists
CREATE TABLE IF NOT EXISTS anime_redirect (
  from_id TEXT PRIMARY KEY,
  to_id   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS redirect_to ON anime_redirect(to_id);

-- 2. Merge movie duplicate: fullmetal-alchemist-the-movie-conqueror-of-shamballa-6pb0
INSERT OR REPLACE INTO anime_redirect (from_id, to_id) 
VALUES ('fullmetal-alchemist-the-movie-conqueror-of-shamballa-6pb0', 'fullmetal-alchemist-the-movie-conqueror-of-shamballa');

UPDATE OR IGNORE anime_provider_mapping 
SET anime_id = 'fullmetal-alchemist-the-movie-conqueror-of-shamballa' 
WHERE anime_id = 'fullmetal-alchemist-the-movie-conqueror-of-shamballa-6pb0';

DELETE FROM anime_provider_mapping WHERE anime_id = 'fullmetal-alchemist-the-movie-conqueror-of-shamballa-6pb0';
DELETE FROM episode WHERE anime_id = 'fullmetal-alchemist-the-movie-conqueror-of-shamballa-6pb0';
DELETE FROM anime_genre WHERE anime_id = 'fullmetal-alchemist-the-movie-conqueror-of-shamballa-6pb0';
DELETE FROM anime_id_map WHERE anime_id = 'fullmetal-alchemist-the-movie-conqueror-of-shamballa-6pb0';
DELETE FROM anime WHERE id = 'fullmetal-alchemist-the-movie-conqueror-of-shamballa-6pb0';

-- 3. Merge movie duplicate: fullmetal-alchemist-the-sacred-star-of-milos-5iet
INSERT OR REPLACE INTO anime_redirect (from_id, to_id) 
VALUES ('fullmetal-alchemist-the-sacred-star-of-milos-5iet', 'fullmetal-alchemist-the-sacred-star-of-milos');

UPDATE OR IGNORE anime_provider_mapping 
SET anime_id = 'fullmetal-alchemist-the-sacred-star-of-milos' 
WHERE anime_id = 'fullmetal-alchemist-the-sacred-star-of-milos-5iet';

DELETE FROM anime_provider_mapping WHERE anime_id = 'fullmetal-alchemist-the-sacred-star-of-milos-5iet';
DELETE FROM episode WHERE anime_id = 'fullmetal-alchemist-the-sacred-star-of-milos-5iet';
DELETE FROM anime_genre WHERE anime_id = 'fullmetal-alchemist-the-sacred-star-of-milos-5iet';
DELETE FROM anime_id_map WHERE anime_id = 'fullmetal-alchemist-the-sacred-star-of-milos-5iet';
DELETE FROM anime WHERE id = 'fullmetal-alchemist-the-sacred-star-of-milos-5iet';

-- 4. Merge duplicate: kakegurui-compulsive-gambler -> kakegurui
INSERT OR REPLACE INTO anime_redirect (from_id, to_id) 
VALUES ('kakegurui-compulsive-gambler', 'kakegurui');

UPDATE OR IGNORE anime_provider_mapping 
SET anime_id = 'kakegurui' 
WHERE anime_id = 'kakegurui-compulsive-gambler';

DELETE FROM anime_provider_mapping WHERE anime_id = 'kakegurui-compulsive-gambler';
DELETE FROM episode WHERE anime_id = 'kakegurui-compulsive-gambler';
DELETE FROM anime_genre WHERE anime_id = 'kakegurui-compulsive-gambler';
DELETE FROM anime_id_map WHERE anime_id = 'kakegurui-compulsive-gambler';
DELETE FROM anime WHERE id = 'kakegurui-compulsive-gambler';

-- Ensure kakegurui has Season 1 IDs
UPDATE anime_id_map SET mal_id = 34933, anilist_id = 98314 WHERE anime_id = 'kakegurui';

-- 5. Fix cross-season AniList ID collisions and restore titles
UPDATE anime SET title = 'Kamisama Kiss' WHERE id = 'kamisama-kiss';
UPDATE anime_id_map SET anilist_id = 14713 WHERE anime_id = 'kamisama-kiss';

UPDATE anime SET title = 'Cells at Work!' WHERE id = 'cells-at-work';
UPDATE anime_id_map SET anilist_id = 100977 WHERE anime_id = 'cells-at-work';

-- 6. Align episode_total with actual database episode counts
UPDATE anime SET episode_total = 1358 WHERE id = 'shin-chan' AND (episode_total IS NULL OR episode_total < 1358);
UPDATE anime SET episode_total = 389 WHERE id = 'holo-no-graffiti' AND (episode_total IS NULL OR episode_total < 389);
UPDATE anime SET episode_total = 120 WHERE id = 'the-disastrous-life-of-saiki-k' AND (episode_total IS NULL OR episode_total < 120);
UPDATE anime SET episode_total = 3 WHERE id = '5-centimeters-per-second' AND (episode_total IS NULL OR episode_total < 3);
UPDATE anime SET episode_total = 180 WHERE id = 'renegade-immortal' AND (episode_total IS NULL OR episode_total < 180);
