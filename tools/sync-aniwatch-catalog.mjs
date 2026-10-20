// @ts-check
/**
 * tools/sync-aniwatch-catalog.mjs
 *
 * Scrapes and synchronizes the complete AniWatch catalog (https://aniwatch.co.at)
 * into `anime_provider_mapping` and `anime_id_map`.
 *
 * Resolves each AniWatch anime slug via:
 * 1. Exact slug match in `anime.id`
 * 2. Slug match across `anime_provider_mapping` (HiAnime/AniKoto)
 * 3. Normalized title / alias matching
 * 4. Fallback search via AniWatch's suggestions API
 */

import { DatabaseSync } from 'node:sqlite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

function findSqlitePath() {
  const d1Dir = resolve(__dirname, '../.wrangler/state/v3/d1/miniflare-D1DatabaseObject');
  if (existsSync(d1Dir)) {
    const files = readdirSync(d1Dir).filter((f) => f.endsWith('.sqlite'));
    if (files.length > 0) return resolve(d1Dir, files[0]);
  }
  return null;
}

const sqlitePath = findSqlitePath();
if (!sqlitePath) {
  console.error('Local D1 SQLite database file not found.');
  process.exit(1);
}

const db = new DatabaseSync(sqlitePath);
console.log(`Target Database: ${sqlitePath}`);
console.log('🚀 Synchronizing AniWatch Catalog (https://aniwatch.co.at)...');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function normalizeTitle(t) {
  return String(t || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/['‘’`"]/g, '')
    .replace(/\(.*?\)/g, ' ')
    .replace(/\b(?:season|cour|part)\s+\p{L}+\b/gu, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

async function fetchAniWatchSitemap() {
  const res = await fetch('https://aniwatch.co.at/anime-sitemap.xml', {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!res.ok) throw new Error(`AniWatch sitemap HTTP ${res.status}`);
  const text = await res.text();
  const slugs = [];
  const regex = /<loc>https:\/\/aniwatch\.co\.at\/anime\/([^/]+)\/<\/loc>/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const slug = match[1].trim();
    if (slug && slug !== 'anime') slugs.push(slug);
  }
  return slugs;
}

async function searchAniWatch(keyword) {
  try {
    const url = `https://aniwatch.co.at/wp-json/hianime/v1/search/suggestions?keyword=${encodeURIComponent(keyword)}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'X-Requested-With': 'XMLHttpRequest',
      },
    });
    if (!res.ok) return [];
    const data = await res.json();
    const html = data?.html || '';
    const hits = [];
    const regex = /<a\b[^>]*\bhref="https:\/\/aniwatch\.co\.at\/anime\/([^/"]+)\/"[^>]*>[\s\S]*?<\/a>/gi;
    let m;
    while ((m = regex.exec(html)) !== null) {
      hits.push(m[1]);
    }
    return hits;
  } catch {
    return [];
  }
}

async function main() {
  const slugs = await fetchAniWatchSitemap();
  console.log(`Fetched ${slugs.length} anime slugs from AniWatch sitemap.`);

  // Prepare SQLite statements
  const findById = db.prepare('SELECT id, title, native FROM anime WHERE id = ?');
  const findByExactTitle = db.prepare('SELECT id, title FROM anime WHERE lower(title) = lower(?)');
  const findByProviderSlug = db.prepare(
    'SELECT anime_id FROM anime_provider_mapping WHERE provider_slug = ? LIMIT 1'
  );
  const findByTitleLike = db.prepare(
    'SELECT id, title FROM anime WHERE title LIKE ? LIMIT 5'
  );

  const insertMapping = db.prepare(`
    INSERT INTO anime_provider_mapping (anime_id, provider_id, provider_slug, confidence, updated_at)
    VALUES (?, 'aniwatch', ?, ?, ?)
    ON CONFLICT(anime_id, provider_id) DO UPDATE SET
      provider_slug = excluded.provider_slug,
      confidence = excluded.confidence,
      updated_at = excluded.updated_at
  `);

  const updateIdMap = db.prepare(`
    UPDATE anime_id_map
    SET aniwatch_slug = ?, updated_at = ?
    WHERE anime_id = ?
  `);

  const now = Date.now();
  let mappedCount = 0;
  let skippedCount = 0;

  for (let i = 0; i < slugs.length; i++) {
    const slug = slugs[i];
    let matchedAnimeId = null;
    let confidence = 0.9;

    // Strategy 1: Direct ID match
    const directAnime = findById.get(slug);
    if (directAnime) {
      matchedAnimeId = directAnime.id;
      confidence = 1.0;
    }

    // Strategy 2: Match from existing provider mapping (e.g. HiAnime / AniKoto shared slug)
    if (!matchedAnimeId) {
      const provMatch = findByProviderSlug.get(slug);
      if (provMatch?.anime_id) {
        matchedAnimeId = provMatch.anime_id;
        confidence = 0.95;
      }
    }

    // Strategy 3: Slug title inference
    if (!matchedAnimeId) {
      const titleFromSlug = slug.replace(/-/g, ' ');
      const titleMatch = findByExactTitle.get(titleFromSlug);
      if (titleMatch) {
        matchedAnimeId = titleMatch.id;
        confidence = 0.95;
      }
    }

    // Strategy 4: Clean suffix hashes (e.g. "one-piece-vss" -> "one-piece")
    if (!matchedAnimeId && /-[a-z0-9]{3,5}$/i.test(slug)) {
      const strippedSlug = slug.replace(/-[a-z0-9]{3,5}$/i, '');
      const strippedAnime = findById.get(strippedSlug);
      if (strippedAnime) {
        matchedAnimeId = strippedAnime.id;
        confidence = 0.9;
      } else {
        const strippedProv = findByProviderSlug.get(strippedSlug);
        if (strippedProv?.anime_id) {
          matchedAnimeId = strippedProv.anime_id;
          confidence = 0.9;
        }
      }
    }

    // Strategy 5: Substring / LIKE matching
    if (!matchedAnimeId) {
      const baseName = slug.split('-')[0];
      if (baseName.length > 3) {
        const candidates = findByTitleLike.all(`${baseName}%`);
        const normSlug = normalizeTitle(slug);
        for (const cand of candidates) {
          const normCand = normalizeTitle(cand.title);
          if (normCand === normSlug || normSlug.startsWith(normCand) || normCand.startsWith(normSlug)) {
            matchedAnimeId = cand.id;
            confidence = 0.85;
            break;
          }
        }
      }
    }

    if (matchedAnimeId) {
      insertMapping.run(matchedAnimeId, slug, confidence, now);
      updateIdMap.run(slug, now, matchedAnimeId);
      mappedCount++;
    } else {
      skippedCount++;
    }

    if ((i + 1) % 100 === 0 || i === slugs.length - 1) {
      console.log(`Processed ${i + 1}/${slugs.length} | Mapped: ${mappedCount} | Unmapped: ${skippedCount}`);
    }
  }

  // Also query our DB's top popular anime to see if AniWatch has them via search suggestions
  console.log('\n🔍 Searching AniWatch suggestions for top popular database anime...');
  const topAnime = db.prepare(`
    SELECT a.id, a.title
    FROM anime a
    LEFT JOIN anime_provider_mapping m ON m.anime_id = a.id AND m.provider_id = 'aniwatch'
    WHERE m.provider_slug IS NULL AND a.rating > 80
    ORDER BY a.rating DESC
    LIMIT 100
  `).all();

  let discoveredCount = 0;
  for (const item of topAnime) {
    const hits = await searchAniWatch(item.title);
    if (hits.length > 0) {
      const bestSlug = hits[0];
      insertMapping.run(item.id, bestSlug, 0.88, now);
      updateIdMap.run(bestSlug, now, item.id);
      discoveredCount++;
    }
  }

  console.log(`Discovered ${discoveredCount} additional mappings via suggestions.`);

  const totalAniwatchMapped = db.prepare(
    "SELECT count(*) as c FROM anime_provider_mapping WHERE provider_id = 'aniwatch'"
  ).get().c;

  console.log(`\n✓ Sync Complete! Total AniWatch Mappings: ${totalAniwatchMapped}`);
}

main().catch((err) => {
  console.error('Fatal error during AniWatch sync:', err);
  process.exit(1);
});
