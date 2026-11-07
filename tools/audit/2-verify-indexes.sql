SELECT name FROM sqlite_master
WHERE type='index' AND name LIKE 'uk_%'
ORDER BY name;
