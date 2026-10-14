SELECT
  (SELECT COUNT(*) FROM anime) AS anime,
  (SELECT COUNT(*) FROM episode) AS episodes,
  (SELECT COUNT(*) FROM episode WHERE markers <> '[]') AS eps_with_windows,
  (SELECT COUNT(*) FROM anime WHERE art LIKE 'http%') AS absolute_posters,
  (SELECT COUNT(*) FROM anime WHERE rating = 0) AS unrated,
  (SELECT COUNT(*) FROM anime WHERE sched_day IS NOT NULL) AS air_slots,
  (SELECT COUNT(*) FROM episode WHERE airdate IS NOT NULL) AS eps_with_airdate,
  (SELECT COUNT(*) FROM episode WHERE runtime_seconds = 0) AS eps_no_length,
  (SELECT COUNT(*) FROM episode WHERE thumb = '') AS eps_no_thumb,
  (SELECT COUNT(*) FROM anime WHERE skip_key_id IS NOT NULL) AS verified_skip_keys,
  (SELECT COUNT(*) FROM library) AS library_rows,
  (SELECT COUNT(*) FROM position) AS position_rows;

SELECT id, title, year, rating, season, episode_total, sched_season, sched_time
FROM anime ORDER BY rank LIMIT 6;
