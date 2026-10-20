// @ts-check
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';

const D1_DIR = './.wrangler/state/v3/d1/miniflare-D1DatabaseObject';
const files = fs.readdirSync(D1_DIR).filter(f => f.endsWith('.sqlite') && f !== 'metadata.sqlite');
if (files.length === 0) {
  console.error('No D1 SQLite database found in', D1_DIR);
  process.exit(1);
}

const dbPath = path.join(D1_DIR, files[0]);
console.log('Target Local SQLite Database:', dbPath);
const db = new DatabaseSync(dbPath);

const GENRE_MAP = {
  'action': 'action',
  'adventure': 'adventure',
  'fantasy': 'fantasy',
  'isekai': 'isekai',
  'romance': 'romance',
  'slice of life': 'slice-of-life',
  'horror': 'horror',
  'comedy': 'comedy',
  'supernatural': 'supernatural',
  'sci-fi': 'sci-fi',
  'drama': 'drama',
  'mystery': 'mystery',
  'psychological': 'mystery',
  'thriller': 'mystery',
};

const BATCH_SIZE = 40;
const DELAY_MS = 1200;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const query = `
  query ($malIds: [Int]) {
    Page(page: 1, perPage: 50) {
      media(idMal_in: $malIds, type: ANIME) {
        id
        idMal
        title {
          english
          romaji
          native
        }
        genres
        episodes
        status
        season
        seasonYear
        bannerImage
        coverImage {
          large
          extraLarge
        }
      }
    }
  }
`;

async function fetchAniListBatch(malIds) {
  try {
    const res = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'AniHubStream/1.0 (Automated ID Mapping Reconciliation; mailto:admin@anihubstream.com)',
      },
      body: JSON.stringify({ query, variables: { malIds } }),
      signal: AbortSignal.timeout(15000),
    });

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('retry-after') || 15);
      console.warn(`[AniList Rate Limit] 429 received. Backing off for ${retryAfter}s...`);
      await sleep(retryAfter * 1000 + 1000);
      return fetchAniListBatch(malIds);
    }

    if (!res.ok) {
      console.warn(`AniList responded with HTTP ${res.status}`);
      return [];
    }

    const json = await res.json();
    return json?.data?.Page?.media || [];
  } catch (err) {
    console.error('Fetch error:', err.message);
    return [];
  }
}

async function main() {
  console.log('🚀 Starting Automated AniList ID & Genre Backfill...\n');

  // Find all unmapped titles
  const unmapped = db.prepare(`
    SELECT a.id, a.source_ids, m.mal_id
    FROM anime a
    JOIN anime_id_map m ON a.id = m.anime_id
    WHERE m.anilist_id IS NULL AND m.mal_id IS NOT NULL AND m.mal_id > 0
  `).all();

  console.log(`Found ${unmapped.length.toLocaleString()} titles missing anilist_id with valid mal_id.`);
  if (unmapped.length === 0) {
    console.log('No unmapped titles found. Everything is already up to date!');
    return;
  }

  // Prepared statements
  const updateMapStmt = db.prepare(`
    UPDATE anime_id_map 
    SET anilist_id = ?1, updated_at = datetime('now')
    WHERE anime_id = ?2
  `);

  const updateAnimeStmt = db.prepare(`
    UPDATE anime 
    SET source_ids = ?1,
        episode_total = coalesce(episode_total, ?2)
    WHERE id = ?3
  `);

  const insertGenreStmt = db.prepare(`
    INSERT OR IGNORE INTO anime_genre (anime_id, genre_id)
    VALUES (?1, ?2)
  `);

  let resolvedTotal = 0;
  let genresTotal = 0;

  for (let i = 0; i < unmapped.length; i += BATCH_SIZE) {
    const chunk = unmapped.slice(i, i + BATCH_SIZE);
    const malToAnimeId = new Map();
    const malIds = [];

    for (const r of chunk) {
      malToAnimeId.set(r.mal_id, r);
      malIds.push(r.mal_id);
    }

    const results = await fetchAniListBatch(malIds);

    for (const media of results) {
      const animeRecord = malToAnimeId.get(media.idMal);
      if (!animeRecord) continue;

      const animeId = animeRecord.id;
      const anilistId = media.id;

      // 1. Update anime_id_map
      updateMapStmt.run(anilistId, animeId);

      // 2. Update anime.source_ids
      let sources = {};
      try {
        sources = animeRecord.source_ids ? JSON.parse(animeRecord.source_ids) : {};
      } catch {}
      sources.anilist = anilistId;
      sources.mal = media.idMal;

      updateAnimeStmt.run(JSON.stringify(sources), media.episodes || null, animeId);

      // 3. Insert genres
      if (Array.isArray(media.genres)) {
        for (const g of media.genres) {
          const mappedGenre = GENRE_MAP[g.toLowerCase()];
          if (mappedGenre) {
            insertGenreStmt.run(animeId, mappedGenre);
            genresTotal++;
          }
        }
      }

      resolvedTotal++;
    }

    const percent = Math.min(100, Math.round(((i + chunk.length) / unmapped.length) * 100));
    console.log(`[${percent}%] Processed ${i + chunk.length}/${unmapped.length} | Resolved: ${resolvedTotal} | Genres: ${genresTotal}`);

    await sleep(DELAY_MS);
  }

  console.log('\n====================================================');
  console.log('BACKFILL COMPLETE:');
  console.log(`✓ Total AniList IDs Resolved: ${resolvedTotal.toLocaleString()}`);
  console.log(`✓ Total Genres Associated:    ${genresTotal.toLocaleString()}`);
  console.log('====================================================');

  // Verify DB state
  const finalStats = db.prepare(`
    SELECT 
      count(anime_id) as total,
      count(anilist_id) as has_anilist,
      count(mal_id) as has_mal
    FROM anime_id_map
  `).get();
  console.log('Final anime_id_map status:', finalStats);

  const finalGenres = db.prepare(`
    SELECT count(DISTINCT anime_id) as anime_with_genres, count(*) as total_genre_relations
    FROM anime_genre
  `).get();
  console.log('Final anime_genre status:', finalGenres);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
