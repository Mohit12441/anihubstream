// @ts-check
import fs from 'node:fs';
import path from 'node:path';

const PROGRESS_PATH = path.resolve('tools/anikoto-slugs-progress.json');
const TITLES_PATH = path.resolve('tools/anime-titles.json');
const DEDUPED_OUT_PATH = path.resolve('tools/anikoto-slugs.json');
const REVIEW_OUT_PATH = path.resolve('tools/anikoto-slugs-review.json');
const SOURCES_PATH = path.resolve('tools/catalogue-sources.json');
const SEED_SQL_PATH = path.resolve('tools/id-map-seed.sql');

function clean(str) {
  return (str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function run() {
  const progress = JSON.parse(fs.readFileSync(PROGRESS_PATH, 'utf8'));
  const titles = JSON.parse(fs.readFileSync(TITLES_PATH, 'utf8'));

  // Group by slug to find collisions
  const bySlug = new Map();
  for (const [id, slug] of Object.entries(progress)) {
    if (!slug) continue;
    if (!bySlug.has(slug)) bySlug.set(slug, []);
    bySlug.get(slug).push(id);
  }

  const cleanMap = {};
  const collisions = [];

  for (const [slug, idList] of bySlug.entries()) {
    if (idList.length === 1) {
      cleanMap[idList[0]] = slug;
    } else {
      // Collision detected! Compare titles to pick the best survivor
      console.log(`[Collision] slug "${slug}" claimed by ${idList.length} titles: ${idList.join(', ')}`);
      let bestId = idList[0];
      let bestScore = -1;

      for (const id of idList) {
        const title = titles[id] || id;
        const cTitle = clean(title);
        const cSlug = clean(slug.replace(/-[a-z0-9]{4,6}$/, ''));
        // Higher score if title matches slug base
        const score = cTitle === cSlug ? 100 : (cTitle.includes(cSlug) || cSlug.includes(cTitle) ? 50 : 0);
        if (score > bestScore) {
          bestScore = score;
          bestId = id;
        }
      }

      cleanMap[bestId] = slug;
      const discarded = idList.filter((id) => id !== bestId);
      collisions.push({
        slug,
        survivor: bestId,
        survivorTitle: titles[bestId],
        discarded: discarded.map((id) => ({ id, title: titles[id] })),
      });
      console.log(`  -> Survivor: "${bestId}", discarded: ${discarded.join(', ')}`);
    }
  }

  console.log(`\nValidation complete:`);
  console.log(`  Total raw mappings: ${Object.keys(progress).length}`);
  console.log(`  Collisions resolved: ${collisions.length}`);
  console.log(`  Final clean unique mappings: ${Object.keys(cleanMap).length}`);

  // Write dedicated clean artifact tools/anikoto-slugs.json
  fs.writeFileSync(DEDUPED_OUT_PATH, JSON.stringify(cleanMap, null, 2), 'utf8');
  console.log(`Wrote clean slugs artifact to ${DEDUPED_OUT_PATH}`);

  // Write review file for collisions
  fs.writeFileSync(REVIEW_OUT_PATH, JSON.stringify(collisions, null, 2), 'utf8');
  console.log(`Wrote collisions report to ${REVIEW_OUT_PATH}`);

  // Update catalogue-sources.json
  const sources = JSON.parse(fs.readFileSync(SOURCES_PATH, 'utf8'));
  for (const s of sources) {
    s.anikoto = cleanMap[s.id] || null;
  }
  fs.writeFileSync(SOURCES_PATH, JSON.stringify(sources, null, 2), 'utf8');

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
      `VALUES (${val(s.id)}, ${val(s.mal)}, ${val(s.anilist)}, ${val(s.kitsu)}, ${val(s.anikoto)}, ${val(s.hianime)}, NULL, NULL, NULL, ${s.mal ? 1.0 : 0.85}, datetime('now')) ` +
      `ON CONFLICT(anime_id) DO UPDATE SET mal_id=coalesce(excluded.mal_id, anime_id_map.mal_id), anilist_id=coalesce(excluded.anilist_id, anime_id_map.anilist_id), kitsu_id=coalesce(excluded.kitsu_id, anime_id_map.kitsu_id), anikoto_slug=coalesce(excluded.anikoto_slug, anime_id_map.anikoto_slug), hianime_slug=coalesce(excluded.hianime_slug, anime_id_map.hianime_slug), confidence=excluded.confidence, updated_at=datetime('now');`
    );
  }
  fs.writeFileSync(SEED_SQL_PATH, sql.join('\n'), 'utf8');
  console.log(`Regenerated ${SEED_SQL_PATH} (${sql.length} rows).`);
}

run();
