-- Migration 0003: Sanitize specials with cloned episode shells
DELETE FROM episode 
WHERE anime_id = 'renegade-immortal-slaying-the-blood-progenitor' AND n > 1;

UPDATE anime 
SET episode_total = 1, kind = 'Special' 
WHERE id = 'renegade-immortal-slaying-the-blood-progenitor';
