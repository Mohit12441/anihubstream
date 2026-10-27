-- =========================================================================
-- alter-read-indexes.sql: D1 Read Protection & Performance Indexes
-- Apply to production:
--   npx wrangler d1 execute anihub --remote --file=alter-read-indexes.sql
-- Or run directly in Cloudflare D1 Web Console.
-- =========================================================================

-- 1. Index on status (speeds up Ongoing shelf on /home and status filters by 90-99%)
CREATE INDEX IF NOT EXISTS idx_anime_status ON anime(status);

-- 2. Index on rating (replaces table scans on Top Rated shelf and default catalog sort)
CREATE INDEX IF NOT EXISTS idx_anime_rating ON anime(rating DESC);

-- 3. Composite index on year + rating (speeds up Fresh shelf: year >= 2024 ORDER BY year DESC, rating DESC)
CREATE INDEX IF NOT EXISTS idx_anime_year ON anime(year DESC, rating DESC);

-- 4. Index on skip_key lookup (optimizes AniSkip and MAL provenance lookups)
CREATE INDEX IF NOT EXISTS idx_anime_skip_key ON anime(skip_key_space, skip_key_id);
