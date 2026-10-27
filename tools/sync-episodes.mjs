// @ts-check
/**
 * tools/sync-episodes.mjs
 *
 * Universal Episode & Metadata Synchronizer:
 * 1. Synchronizes official episode metadata (canonical titles, synopses, thumbnails) from Kitsu API.
 * 2. Synchronizes real release airdates, episode numbers, and timestamps from AniKoto API.
 * 3. Synchronizes verified intro/outro skip intervals from AniSkip API into `episode.markers`.
 * 4. Ensures fallback key art for all episodes with missing or empty thumbnails.
 *
 * Runs locally against .wrangler/state/v3/d1/.../miniflare-D1DatabaseObject/*.sqlite.
 * 100% Free, Zero Ads, Pure REST.
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
  console.error('Local D1 SQLite database not found.');
  process.exit(1);
}

const db = new DatabaseSync(sqlitePath);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA busy_timeout = 15000;');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Parse CLI flags: --anime <id>, --limit <n>, --skip-aniskip
const args = process.argv.slice(2);
const targetAnimeId = args.includes('--anime') ? args[args.indexOf('--anime') + 1] : null;
const batchLimit = Number(args.includes('--limit') ? args[args.indexOf('--limit') + 1] : 50) || 50;
const skipAniSkip = args.includes('--skip-aniskip');

/**
 * Fetch episode list from Kitsu
 */
async function fetchEpisodesFromKitsu(kitsuId) {
  let episodes = [];
  let nextUrl = `https://kitsu.io/api/edge/episodes?filter[mediaId]=${kitsuId}&page[limit]=20&sort=number`;
  let pageCount = 0;

  while (nextUrl && pageCount < 6) {
    pageCount++;
    try {
      const res = await fetch(nextUrl, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/vnd.api+json' },
        signal: AbortSignal.timeout(4000),
      });

      if (!res.ok) break;
      const data = await res.json();
      const list = Array.isArray(data?.data) ? data.data : [];
      if (list.length === 0) break;

      episodes.push(...list);
      nextUrl = data?.links?.next || null;
      if (nextUrl) await sleep(100);
    } catch {
      break;
    }
  }

  return episodes;
}

/**
 * Fetch released episodes and airdates from AniKoto
 */
async function fetchEpisodesFromAniKoto(anikotoSlug) {
  try {
    const cleanSlug = anikotoSlug.replace(/^anikoto:/i, '').trim();
    const watchRes = await fetch(`https://anikoto.cz/watch/${cleanSlug}`, {
      headers: { referer: 'https://anikoto.cz/', 'user-agent': USER_AGENT },
      signal: AbortSignal.timeout(3500),
    });
    if (!watchRes.ok) return [];

    const html = await watchRes.text();
    const watchId = html.match(/<[^>]+\bid="watch-main"[^>]+\bdata-id="([^"]*)"/i)?.[1];
    if (!watchId) return [];

    const epRes = await fetch(`https://anikoto.cz/ajax/episode/list/${watchId}?vrf=`, {
      headers: {
        'x-requested-with': 'XMLHttpRequest',
        referer: `https://anikoto.cz/watch/${cleanSlug}`,
        'user-agent': USER_AGENT,
      },
      signal: AbortSignal.timeout(3500),
    });
    if (!epRes.ok) return [];

    const epJson = await epRes.json();
    const epHtml = epJson.result || epJson.html || '';

    const results = [];
    for (const m of epHtml.matchAll(/<a\b[^>]*data-ids="[^"]*"[^>]*>[\s\S]*?<\/a>/gi)) {
      const tag = m[0];
      const numRaw = tag.match(/data-num="([^"]*)"/i)?.[1]?.trim() ?? '';
      const num = /^\d+$/.test(numRaw) ? Number(numRaw) : results.length + 1;
      const ts = tag.match(/data-timestamp="([^"]*)"/i)?.[1]?.trim();
      const airdate = ts && /^\d+$/.test(ts) ? new Date(Number(ts) * 1000).toISOString().split('T')[0] : null;
      const title = tag.match(/class="[^"]*d-title[^"]*"[^>]*>([\s\S]*?)<\/[^>]*>/i)?.[1]?.trim() || `Episode ${num}`;
      const mal = tag.match(/data-mal="(\d+)"/i)?.[1];

      results.push({ num, airdate, title, mal, externalId: `anikoto:${watchId}:${num}` });
    }

    return results;
  } catch {
    return [];
  }
}

/**
 * Fetch released episodes from HiAnime / AnimeHot
 */
async function fetchEpisodesFromHiAnime(hianimeSlug) {
  try {
    const cleanSlug = hianimeSlug.replace(/^hianime:/i, '').trim();
    const res = await fetch(`https://animehot.cc/api/anime/${cleanSlug}`, {
      headers: { referer: 'https://animehot.cc/', 'user-agent': USER_AGENT },
      signal: AbortSignal.timeout(3500),
    });
    if (!res.ok) return [];
    const json = await res.json();
    const list = json?.anime?.episodes || json?.episodes || [];
    return list
      .map((e) => ({
        num: Number(e.episodeNumber || e.n || 0),
        title: (e.title || '').trim(),
        slug: e.slug || '',
      }))
      .filter((e) => e.num > 0);
  } catch {
    return [];
  }
}

/**
 * Fetch AniSkip markers for MAL ID and Episode
 */
async function fetchAniSkipMarkers(malId, ep) {
  if (!malId || malId <= 0) return [];
  try {
    const res = await fetch(`https://api.aniskip.com/v2/skip-times/${malId}/${ep}?types[]=op&types[]=ed&types[]=mixed-op&types[]=mixed-ed&types[]=recap&episodeLength=1440`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return [];

    const data = await res.json();
    if (!data?.found || !Array.isArray(data.results)) return [];

    const markers = [];
    for (const r of data.results) {
      const intv = r.interval;
      if (intv?.startTime != null && intv?.endTime != null) {
        const kind = r.skipType === 'recap' ? 'recap' : r.skipType.includes('op') ? 'intro' : 'outro';
        const label = r.skipType === 'recap' ? 'Recap' : r.skipType.includes('op') ? 'Opening' : 'Ending';
        markers.push({ kind, start: Math.round(intv.startTime), end: Math.round(intv.endTime), label });
      }
    }
    return markers;
  } catch {
    return [];
  }
}

export async function syncAnime(anime, { skipAniSkip = false, quiet = false } = {}) {
  if (!quiet) console.log(`\n► Syncing [${anime.id}]: "${anime.title}"`);
  const fallbackArt = anime.key_art || anime.art || '';
  const malId = anime.mal_id || anime.skip_key_id;

  // 1. Kitsu Episodes
  let kitsuEps = [];
  if (anime.kitsu_id) {
    kitsuEps = await fetchEpisodesFromKitsu(anime.kitsu_id);
    if (!quiet && kitsuEps.length > 0) {
      console.log(`  ✓ Kitsu: Found ${kitsuEps.length} catalog episodes`);
    }
  }

  // 2. AniKoto Released Episodes & Airdates
  let anikotoEps = [];
  if (anime.anikoto_slug) {
    anikotoEps = await fetchEpisodesFromAniKoto(anime.anikoto_slug);
    if (!quiet && anikotoEps.length > 0) {
      console.log(`  ✓ AniKoto: Found ${anikotoEps.length} released episodes`);
    }
  }

  // 3. HiAnime Released Episodes
  let hiEps = [];
  if (anime.hianime_slug) {
    hiEps = await fetchEpisodesFromHiAnime(anime.hianime_slug);
    if (!quiet && hiEps.length > 0) {
      console.log(`  ✓ HiAnime: Found ${hiEps.length} catalog episodes`);
    }
  }

  const insertEpisode = db.prepare(`
    INSERT OR REPLACE INTO episode (
      id, anime_id, n, title, runtime, runtime_seconds, thumb, synopsis, markers, airdate, external_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const updateEpisode = db.prepare(`
    UPDATE episode
    SET title = coalesce(nullif(?, ''), title),
        thumb = case when thumb = '' or thumb is null then ? else thumb end,
        airdate = coalesce(nullif(?, ''), airdate),
        markers = case when ? != '[]' then ? else markers end
    WHERE anime_id = ? AND n = ?
  `);

  // Merge episodes
  const isFinished = anime.status?.toLowerCase().includes('finish');
  const now = new Date();
  const kitsuAiredCount = kitsuEps.filter((k) => k.attributes?.airdate && new Date(k.attributes.airdate) <= now).length;
  const maxReleased = anikotoEps.length > 0
    ? anikotoEps.length
    : (hiEps.length > 0 ? hiEps.length : (isFinished ? Math.max(anime.episode_total || 1, kitsuEps.length) : Math.max(1, kitsuAiredCount)));
  const totalCount = isFinished
    ? Math.max(anime.episode_total || 1, kitsuEps.length, anikotoEps.length, hiEps.length)
    : Math.max(1, maxReleased);
  const plannedTotal = Math.max(anime.episode_total || 0, kitsuEps.length, totalCount);
  const anikotoByNum = new Map(anikotoEps.map((e) => [e.num, e]));
  const kitsuByNum = new Map(kitsuEps.map((e) => [Number(e.attributes?.number), e]));
  const hiByNum = new Map(hiEps.map((e) => [e.num, e]));

  for (let n = 1; n <= totalCount; n++) {
    const epId = `${anime.id}#${n}`;
    const ak = anikotoByNum.get(n);
    const kt = kitsuByNum.get(n);
    const hi = hiByNum.get(n);

    const canonicalTitle = (kt?.attributes?.canonicalTitle || kt?.attributes?.titles?.en_us || kt?.attributes?.titles?.en || '').trim();
    const hiTitle = (hi?.title || '').trim();
    const akTitle = (ak?.title || '').trim();

    // Multi-source Title Cascade:
    // 1. Kitsu Canonical Title
    // 2. HiAnime Title (if not generic 'Episode N')
    // 3. AniKoto Title (if not generic 'Episode N')
    // 4. Default 'Episode N'
    let epTitle = `Episode ${n}`;
    if (canonicalTitle && canonicalTitle.toLowerCase() !== `episode ${n}`) {
      epTitle = canonicalTitle;
    } else if (hiTitle && hiTitle.toLowerCase() !== `episode ${n}`) {
      epTitle = hiTitle;
    } else if (akTitle && akTitle.toLowerCase() !== `episode ${n}`) {
      epTitle = akTitle;
    } else if (canonicalTitle) {
      epTitle = canonicalTitle;
    }

    const lenMin = Number(kt?.attributes?.length) || 24;
    const runtime = `${lenMin}:00`;
    const runtimeSeconds = lenMin * 60;

    const ktThumb = kt?.attributes?.thumbnail?.original || kt?.attributes?.thumbnail?.medium || '';
    const thumb = ktThumb || fallbackArt;
    const synopsis = (kt?.attributes?.synopsis || '').trim();
    const airdate = ak?.airdate || kt?.attributes?.airdate || null;
    const externalId = kt?.id ? String(kt.id) : (ak?.externalId || (hi?.slug ? `hianime:${hi.slug}` : null));

    // AniSkip markers (for released episodes only)
    let markers = [];
    if (!skipAniSkip && malId && n <= Math.max(anikotoEps.length, 3)) {
      markers = await fetchAniSkipMarkers(malId, n);
    }
    const markersStr = JSON.stringify(markers);

    // Check existing episode in D1
    const existing = db.prepare('SELECT id, markers FROM episode WHERE anime_id = ? AND n = ?').get(anime.id, n);
    if (!existing) {
      insertEpisode.run(
        epId,
        anime.id,
        n,
        epTitle,
        runtime,
        runtimeSeconds,
        thumb,
        synopsis,
        markersStr,
        airdate,
        externalId
      );
    } else {
      updateEpisode.run(epTitle, thumb, airdate, markersStr, markersStr, anime.id, n);
    }
  }

  // Update anime total if newly discovered
  db.prepare(`
    UPDATE anime
    SET episode_total = max(coalesce(episode_total, 0), ?)
    WHERE id = ?
  `).run(plannedTotal, anime.id);

  if (!quiet) {
    console.log(`  ✓ Synced ${totalCount} released episodes (${plannedTotal} planned total) for "${anime.title}"`);
  }
}

export async function syncEpisodes({ targetAnimeId = null, limit = 50, skipAniSkip = false, quiet = false } = {}) {
  let candidates = [];
  if (targetAnimeId) {
    candidates = db.prepare(`
      SELECT a.id, a.title, a.art, a.key_art, a.episode_total, a.status, a.skip_key_id,
             m.kitsu_id, m.mal_id,
             coalesce(m.anikoto_slug, (SELECT provider_slug FROM anime_provider_mapping WHERE anime_id = a.id AND provider_id = 'anikoto' LIMIT 1)) AS anikoto_slug,
             coalesce(m.hianime_slug, (SELECT provider_slug FROM anime_provider_mapping WHERE anime_id = a.id AND provider_id = 'hianime' LIMIT 1)) AS hianime_slug
      FROM anime a
      LEFT JOIN anime_id_map m ON m.anime_id = a.id
      WHERE a.id = ?
    `).all(targetAnimeId);
  } else {
    // Select ongoing or top anime with missing thumbnails, titles, or empty markers
    candidates = db.prepare(`
      SELECT a.id, a.title, a.art, a.key_art, a.episode_total, a.status, a.skip_key_id,
             m.kitsu_id, m.mal_id,
             coalesce(m.anikoto_slug, (SELECT provider_slug FROM anime_provider_mapping WHERE anime_id = a.id AND provider_id = 'anikoto' LIMIT 1)) AS anikoto_slug,
             coalesce(m.hianime_slug, (SELECT provider_slug FROM anime_provider_mapping WHERE anime_id = a.id AND provider_id = 'hianime' LIMIT 1)) AS hianime_slug
      FROM anime a
      LEFT JOIN anime_id_map m ON m.anime_id = a.id
      WHERE (m.anikoto_slug IS NOT NULL OR m.kitsu_id IS NOT NULL OR a.skip_key_id IS NOT NULL OR m.hianime_slug IS NOT NULL)
      ORDER BY (CASE WHEN a.status = 'Ongoing' THEN 0 ELSE 1 END), a.rating DESC
      LIMIT ?
    `).all(limit);
  }

  if (!quiet) console.log(`Found ${candidates.length} candidate anime to synchronize.`);

  for (let i = 0; i < candidates.length; i++) {
    await syncAnime(candidates[i], { skipAniSkip, quiet });
    await sleep(100);
  }

  return { candidatesCount: candidates.length };
}

async function main() {
  console.log(`Target Database: ${sqlitePath}`);
  console.log('🚀 AniHubStream Universal Episode & Metadata Synchronizer');

  await syncEpisodes({ targetAnimeId, limit: batchLimit, skipAniSkip, quiet: false });

  const finalEpCount = db.prepare('SELECT count(1) as c FROM episode').get().c;
  const animeWithEpisodes = db.prepare('SELECT count(distinct anime_id) as c FROM episode').get().c;

  console.log(`\n========================================`);
  console.log(`✓ Synchronizer completed successfully!`);
  console.log(`Total episodes in database: ${finalEpCount} across ${animeWithEpisodes} anime.`);
  console.log(`========================================\n`);
}

const isCli = process.argv[1] && (
  process.argv[1].endsWith('sync-episodes.mjs') ||
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
);

if (isCli) {
  main().catch((err) => {
    console.error('Fatal error during episode sync:', err);
    process.exit(1);
  });
}
