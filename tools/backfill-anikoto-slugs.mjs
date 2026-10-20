// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import { search } from '../api/anikoto.mjs';
import { slugify } from './discover-titles.mjs';

const SOURCES_PATH = path.resolve('tools/catalogue-sources.json');
const TITLES_PATH = path.resolve('tools/anime-titles.json');
const PROGRESS_PATH = path.resolve('tools/anikoto-slugs-progress.json');
const SEED_SQL_PATH = path.resolve('tools/id-map-seed.sql');

const CONCURRENCY = 4;
const DELAY_MS = 120;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function cleanTitle(str) {
  return (str || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

/**
 * Normalizes title for AniKoto search query:
 * Uses slugify to strip diacritics (NFKD), punctuation, combining marks,
 * and decorative symbols (☆, ★, ♪), then expands hyphens back to clean search terms.
 */
function normalizeSearchTerm(str) {
  if (!str) return '';
  return slugify(str, { maxLength: 120 }).replace(/-/g, ' ');
}

async function run() {
  const sources = JSON.parse(fs.readFileSync(SOURCES_PATH, 'utf8'));
  const titles = JSON.parse(fs.readFileSync(TITLES_PATH, 'utf8'));

  let progress = {};
  if (fs.existsSync(PROGRESS_PATH)) {
    try {
      progress = JSON.parse(fs.readFileSync(PROGRESS_PATH, 'utf8'));
    } catch {}
  }

  // Pre-seed known verified 10
  progress['attack-on-titan'] = 'attack-on-titan-bgaoa';
  progress['jujutsu-kaisen-season-2'] = 'jujutsu-kaisen-2nd-season-hk2c9';
  progress['spy-x-family-season-2'] = 'spy-x-family-season-2-qlfdj';
  progress['demon-slayer-kimetsu-no-yaiba-entertainment-district-arc'] = 'demon-slayer-entertainment-district-arc-bl5lk';
  progress['kaguya-sama-love-is-war-ultra-romantic'] = 'kaguya-sama-love-is-war-ultra-romantic-xptpu';
  progress['fate-stay-night-unlimited-blade-works'] = 'fate-stay-night-unlimited-blade-works-sd3tq';
  progress['bocchi-the-rock'] = 'bocchi-the-rock-ecwgh';
  progress['sword-art-online-alicization-war-of-underworld'] = 'sword-art-online-alicization-war-of-underworld-ek5lz';
  progress['my-hero-academia-season-6'] = 'my-hero-academia-season-6-thlwp';
  progress['re-zero-starting-life-in-another-world'] = 're-zero-starting-life-in-another-world-scuep';

  const pending = sources.filter((s) => !progress[s.id]);
  console.log(`Total titles: ${sources.length}, Already resolved: ${Object.keys(progress).length}, Pending: ${pending.length}`);

  let completed = 0;
  let matchesFound = 0;

  async function worker(items) {
    for (const item of items) {
      const id = item.id;
      const title = titles[id] || id;

      try {
        await sleep(DELAY_MS);
        let hits = await search(title, { signal: AbortSignal.timeout(8_000) }).catch(() => []);
        if (!hits || hits.length === 0) {
          // Retry with slugify-normalized search term
          const normalized = normalizeSearchTerm(title);
          if (normalized && normalized !== title.toLowerCase()) {
            await sleep(DELAY_MS);
            hits = await search(normalized, { signal: AbortSignal.timeout(8_000) }).catch(() => []);
          }
        }

        if (hits && hits.length > 0) {
          // Find hit matching title best
          const cTarget = cleanTitle(title);
          const best = hits.find((h) => cleanTitle(h.title) === cTarget) || hits[0];
          if (best?.slug) {
            progress[id] = best.slug;
            matchesFound++;
          }
        } else {
          // Fallback search with simplified title
          const simple = title.split(/[:\-(]/)[0].trim();
          if (simple && simple !== title) {
            await sleep(DELAY_MS);
            const fallbackHits = await search(simple, { signal: AbortSignal.timeout(8_000) }).catch(() => []);
            if (fallbackHits && fallbackHits.length > 0) {
              progress[id] = fallbackHits[0].slug;
              matchesFound++;
            }
          }
        }
      } catch (err) {
        // Skip on error, will leave unmapped
      }

      completed++;
      if (completed % 25 === 0 || completed === pending.length) {
        fs.writeFileSync(PROGRESS_PATH, JSON.stringify(progress, null, 2), 'utf8');
        console.log(`[Progress] ${completed}/${pending.length} processed (${matchesFound} AniKoto slugs resolved, total mapped: ${Object.keys(progress).length})`);
      }
    }
  }

  // Partition across workers
  const chunks = Array.from({ length: CONCURRENCY }, () => []);
  pending.forEach((item, idx) => {
    chunks[idx % CONCURRENCY].push(item);
  });

  await Promise.all(chunks.map((chunk) => worker(chunk)));

  // Final write
  fs.writeFileSync(PROGRESS_PATH, JSON.stringify(progress, null, 2), 'utf8');
  console.log(`\nBackfill complete. Total mapped: ${Object.keys(progress).length}`);

  // Apply to catalogue-sources.json
  for (const s of sources) {
    if (progress[s.id]) {
      s.anikoto = progress[s.id];
    }
  }
  fs.writeFileSync(SOURCES_PATH, JSON.stringify(sources, null, 2), 'utf8');
  console.log(`Updated ${SOURCES_PATH} with AniKoto slugs.`);

  // Regenerate id-map-seed.sql
  const val = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? v : `'${String(v).replace(/'/g, "''")}'`);
  const sql = [
    '-- Generated from verified catalogue sources and AniKoto slug resolution',
    '-- Populates anime_id_map with cross-referenced IDs and provider slugs',
    '',
  ];

  for (const s of sources) {
    sql.push(
      `INSERT INTO anime_id_map (anime_id, mal_id, anilist_id, kitsu_id, anikoto_slug, hianime_slug, aniwatch_slug, adb_slug, waw_slug, confidence, updated_at) ` +
      `VALUES (${val(s.id)}, ${val(s.mal)}, ${val(s.anilist)}, ${val(s.kitsu)}, ${val(s.anikoto || s.id)}, ${val(s.hianime)}, NULL, NULL, NULL, ${s.mal ? 1.0 : 0.85}, datetime('now')) ` +
      `ON CONFLICT(anime_id) DO UPDATE SET mal_id=coalesce(excluded.mal_id, anime_id_map.mal_id), anilist_id=coalesce(excluded.anilist_id, anime_id_map.anilist_id), kitsu_id=coalesce(excluded.kitsu_id, anime_id_map.kitsu_id), anikoto_slug=coalesce(excluded.anikoto_slug, anime_id_map.anikoto_slug), hianime_slug=coalesce(excluded.hianime_slug, anime_id_map.hianime_slug), confidence=excluded.confidence, updated_at=datetime('now');`
    );
  }
  fs.writeFileSync(SEED_SQL_PATH, sql.join('\n'), 'utf8');
  console.log(`Regenerated ${SEED_SQL_PATH} (${sql.length} rows).`);
}

run().catch((e) => {
  console.error('Backfill error:', e);
  process.exit(1);
});
