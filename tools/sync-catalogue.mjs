/* ============================================================
   tools/sync-catalogue.mjs — builds seed.sql from real community data.

     Kitsu   title, native title, synopsis, rating, status, poster + episode
             art, and the per-episode list (the only reachable source that
             publishes one).
     AniList season/seasonYear, key-art banner, genre tiles, franchise
             relations and the broadcast slot for whatever is airing now.
     AniSkip intro/outro windows, where one exists under this title's own ids.

   Nothing here runs in the browser or in a Pages Function: a third party's
   outage must never be able to take the site down, and AniList's 30 requests
   per minute makes request-time fetching impossible anyway. Run it by hand:

     node tools/sync-catalogue.mjs            # full sync -> seed.sql
     node tools/sync-catalogue.mjs --title=one-piece
     node tools/sync-catalogue.mjs --no-skips # skip the AniSkip pass (fastest)

   Then apply: wrangler d1 execute anihub --local --file=seed.sql
   Every row records where it came from; fields we could not get are left NULL
   rather than invented.

   Air slots and trending ranks do NOT wait for this tool: tools/hourly-refresh.mjs
   re-reads each title's next broadcast slot and its AniList trending position
   straight into D1 every hour, run by the "AniHubHourlyRefresh" Windows task on
   the operator machine (AniList serves 403 to Cloudflare's shared egress, so the
   job cannot run there). That hourly job also grows the catalogue itself:
   tools/discover-titles.mjs adds a couple of currently-airing trending titles a
   day and calls this tool per title (--title=<id>), appending each to
   tools/catalogue-sources.json so a later full rebuild keeps it. This tool
   remains the full rebuild (titles, episodes, artwork, skip windows).
   ============================================================ */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GENRES } from '../src/data/anime.ts';
import { foldSearch } from '../functions/api/_lib.js';

const ROOT = resolve(import.meta.dirname, '..');
const CACHE = resolve(ROOT, 'tools/.cache');
const TARGETS = JSON.parse(readFileSync(resolve(ROOT, 'tools/catalogue-sources.json'), 'utf8'));
const EPISODE_FETCH_CAP = 200; // Kitsu pages 10 episodes per request; long runners are capped and reported

const args = process.argv.slice(2);
/* One or many --title=<id> flags; empty set means the full rebuild. */
const only = new Set(args.filter((a) => a.startsWith('--title=')).map((a) => a.split('=')[1]));
const wantSkips = !args.includes('--no-skips');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- HTTP ---------------- */

async function request(url, init, label, wait = 0) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    if (wait) await sleep(wait);
    let res;
    try {
      res = await fetch(url, { ...init, headers: { 'user-agent': 'AniHubStream catalogue sync (one-off seed build)', ...init?.headers } });
    } catch (err) {
      if (attempt === 4) throw new Error(`${label}: ${err.cause?.code || err.message}`);
      await sleep(2000 * attempt);
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      const backoff = Number(res.headers.get('retry-after')) * 1000 || 1500 * attempt;
      console.log(`      ${label} ${res.status}, retrying in ${backoff}ms`);
      await sleep(backoff);
      continue;
    }
    const text = await res.text();
    if (!res.ok) throw new Error(`${label} -> HTTP ${res.status}: ${text.slice(0, 200)}`);
    return JSON.parse(text);
  }
  throw new Error(`${label}: unreachable`);
}

const KITSU_FIELDS = 'slug,canonicalTitle,titles,synopsis,description,averageRating,startDate,endDate,subtype,status,episodeCount,episodeLength,posterImage,coverImage,nsfw,ratingRank';
const kitsu = (path) => request(`https://kitsu.io/api/edge/${path}`, { headers: { accept: 'application/vnd.api+json' } }, `kitsu ${path.split('?')[0]}`, 250);

const ANILIST_QUERY = `query($id:Int!){ Media(id:$id, type:ANIME){
  id idMal title{romaji english native} season seasonYear format status episodes duration
  averageScore bannerImage coverImage{large} startDate{year month day} description
  nextAiringEpisode{ episode airingAt }
  genres tags{ name }
  studios(isMain:true){ nodes{ name } }
  relations{ edges{ relationType node{ id title{romaji english} format seasonYear status } } }
} }`;
const anilist = (id) => request('https://graphql.anilist.co', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ query: ANILIST_QUERY, variables: { id } }),
}, `anilist ${id}`, 2200).then((j) => {
  if (j.errors) throw new Error(`anilist ${id}: ${JSON.stringify(j.errors).slice(0, 200)}`);
  return j.data.Media;
});

/* ---------------- AniSkip ---------------- */

const SKIP_KIND = { op: ['intro', 'Opening'], ed: ['outro', 'Ending'] };
const skipCache = new Map();

async function skipTimes(key, ep) {
  const ck = `${key}/${ep}`;
  if (!skipCache.has(ck)) {
    skipCache.set(ck, request(
      `https://api.aniskip.com/v1/skip-times/${key}/${ep}?types=op&types=ed`,
      undefined, `aniskip ${ck}`, 550,
    ).then((r) => r?.results || []));
  }
  return skipCache.get(ck);
}

/* AniSkip indexes windows by a bare numeric id and does not document which id space a
   given show was submitted under — One Piece answers under its AniList id, Frieren under
   nothing we can reach. Worse, an id belonging to some other show still returns tidy,
   plausible openings. So an id is accepted only when it has submissions for three separate
   episodes of this title and the episode length it reports for each agrees with the length
   Kitsu publishes, within 5%. A key that fails ships empty markers, which the player
   already handles by not offering a skip button. */
const DRIFT = 0.05;

async function findSkipKey(candidates, samples) {
  const usable = samples.filter((s) => s.runtimeSeconds);
  if (usable.length < 3) return null;
  for (const { id, space } of candidates) {
    if (!id) continue;
    let agreeing = 0;
    let drift = 0;
    for (const s of usable) {
      const len = (await skipTimes(id, s.n))[0]?.episode_length;
      if (!len) continue;
      const d = Math.abs(len - s.runtimeSeconds) / s.runtimeSeconds;
      if (d > DRIFT) { drift = Math.max(drift, d); break; }
      agreeing++;
    }
    if (drift) {
      console.log(`      AniSkip ${space}/${id} rejected: episode length off by ${Math.round(drift * 100)}% from Kitsu`);
      continue;
    }
    if (agreeing >= 3) return { id, space };
    console.log(`      AniSkip ${space}/${id}: no submissions for these episodes`);
  }
  return null;
}

function toMarkers(results, runtimeSeconds) {
  const out = [];
  for (const kind of ['op', 'ed']) {
    const best = results.filter((r) => r.skip_type === kind).sort((a, b) => a.interval.start_time - b.interval.start_time)[0];
    if (!best) continue;
    const [k, label] = SKIP_KIND[kind];
    const start = Math.max(0, Math.round(best.interval.start_time));
    const end = Math.min(runtimeSeconds, Math.round(best.interval.end_time));
    if (end > start) out.push({ kind: k, label, start, end });
  }
  return out;
}

/* ---------------- field mapping ---------------- */

const KIND = { tv: 'TV', movie: 'Movie', ova: 'OVA', ona: 'ONA', special: 'Special', music: 'Special' };
const STATUS = { current: 'Ongoing', finished: 'Finished', unreleased: 'Upcoming', upcoming: 'Upcoming', tba: 'Upcoming' };
const SEASON_NAME = { WINTER: 'Winter', SPRING: 'Spring', SUMMER: 'Summer', FALL: 'Fall' };
const DAY_LABEL = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
/* Our own design accent, chosen per title by id hash — not a fact about the show. */
const PALETTE = ['#ff1f4a', '#a24bff', '#3b82ff', '#ff9420', '#ffc247', '#2ee6a8', '#24d3ee', '#ff3d8b', '#8b5cf6', '#2f7bff'];

const artKey = (url) => {
  const m = /\/art\/(.+)\.jpe?g$/i.exec(url);
  if (!m) throw new Error(`not an art url: ${url}`);
  return m[1];
};

const GENRE_MAP = {
  Action: 'action', Adventure: 'adventure', Fantasy: 'fantasy', Drama: 'drama', Comedy: 'comedy',
  Romance: 'romance', 'Sci-Fi': 'sci-fi', Supernatural: 'supernatural', Mystery: 'mystery',
  'Slice of Life': 'slice-of-life', Horror: 'horror', Isekai: 'isekai',
};

const mapGenres = (media, dropped) => {
  const names = [...media.genres, ...media.tags.map((t) => t.name)];
  const ids = [];
  for (const name of names) {
    const id = GENRE_MAP[name];
    if (id && !ids.includes(id)) ids.push(id);
    else if (!id) dropped.add(name);
  }
  return ids;
};

const text = (v) => (v === undefined || v === null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const num = (v) => (v === undefined || v === null || Number.isNaN(Number(v)) ? 'NULL' : String(v));

/* ---------------- one title ---------------- */

const kitsuUrl = (absoluteUrl) =>
  request(absoluteUrl, { headers: { accept: 'application/vnd.api+json' } }, 'kitsu episodes', 250);

async function fetchEpisodes(kitsuId, total) {
  const wanted = Math.min(total || EPISODE_FETCH_CAP, EPISODE_FETCH_CAP);
  /* Kitsu ignores page[number] beyond the first few offsets and hands the same rows back,
     so follow the links it publishes instead and key by episode number as a guard. */
  const byNumber = new Map();
  let next = `https://kitsu.io/api/edge/anime/${kitsuId}/episodes?page[size]=10&sort=number&fields[episodes]=number,canonicalTitle,titles,synopsis,length,airdate,thumbnail`;
  while (next && byNumber.size < wanted) {
    const j = await kitsuUrl(next);
    for (const e of j.data || []) {
      const at = e.attributes;
      if (at.number === null || at.number === undefined || byNumber.has(at.number)) continue;
      byNumber.set(at.number, {
        externalId: e.id,
        n: at.number,
        title: at.canonicalTitle || at.titles?.en || at.titles?.ja_JP || `Episode ${at.number}`,
        length: at.length ?? null,
        airdate: at.airdate ?? null,
        synopsis: (at.synopsis || at.description || '').replace(/\s+/g, ' ').trim(),
        thumb: at.thumbnail?.medium || at.thumbnail?.large || at.thumbnail?.original || null,
      });
    }
    next = j.links?.next ?? null;
  }
  const count = (await kitsu(`anime/${kitsuId}/episodes?page[size]=1`))?.meta?.count ?? byNumber.size;
  const rows = [...byNumber.values()].sort((a, b) => a.n - b.n).slice(0, wanted);
  return { rows, total: count || rows.length };
}

async function syncTarget(target, droppedGenres, stats) {
  const [k, media] = await Promise.all([
    kitsu(`anime/${target.kitsu}?fields[anime]=${KITSU_FIELDS}`),
    anilist(target.anilist),
  ]);
  if (!k?.data) throw new Error(`${target.id}: no Kitsu row for ${target.kitsu}`);
  if (!media) throw new Error(`${target.id}: no AniList row for ${target.anilist}`);
  const at = k.data.attributes;

  const { rows: eps, total: epTotal } = await fetchEpisodes(target.kitsu, at.episodeCount);

  const fallbackLength = at.episodeLength || media.duration || null;
  let runtimeFallbacks = 0;
  const episodes = eps.map((e) => {
    const minutes = e.length ?? fallbackLength;
    if (e.length === null && fallbackLength !== null) runtimeFallbacks++;
    const seconds = minutes ? Math.round(minutes * 60) : null;
    return { ...e, runtimeSeconds: seconds, runtime: seconds ? `${minutes}:00` : null };
  });

  /* AniSkip: only with a verified key, and only the windows it actually returns. */
  let skipKey = null;
  let markerCount = 0;
  if (wantSkips) {
    /* Spread the check across the run rather than trusting episode 1 alone. */
    const picks = [0, Math.floor(episodes.length / 3), Math.floor((episodes.length * 2) / 3)]
      .map((i) => episodes[i])
      .filter((e, i, all) => e && all.indexOf(e) === i);
    skipKey = await findSkipKey(
      [{ id: target.anilist, space: 'anilist' }, { id: media.idMal, space: 'mal' }],
      picks,
    );
    if (skipKey) {
      for (const e of episodes) {
        e.markers = toMarkers(await skipTimes(skipKey.id, e.n), e.runtimeSeconds || 1e9);
        markerCount += e.markers.length;
      }
    }
  }
  episodes.forEach((e) => { e.markers ??= []; });

  const airing = media.nextAiringEpisode?.airingAt ? new Date(media.nextAiringEpisode.airingAt * 1000) : null;
  /* The air slot is this week's broadcast, so the season label must come from the
     airdate — a long-runner like One Piece would otherwise be filed under its 1999 debut. */
  const airingMonth = airing ? airing.getUTCMonth() : 0;
  const airingSeason = airingMonth < 3 ? 'Winter' : airingMonth < 6 ? 'Spring' : airingMonth < 9 ? 'Summer' : 'Fall';
  const rating = at.averageRating ? Math.round(at.averageRating) / 10 : media.averageScore ? media.averageScore / 10 : null;

  const altSeasons = (media.relations?.edges || [])
    .filter((edge) => ['PREQUEL', 'SEQUEL'].includes(edge.relationType))
    .filter((edge) => !TARGETS.some((t) => t.anilist === edge.node?.id))
    .map((edge) => {
      const n = edge.node;
      const title = n.title?.english || n.title?.romaji;
      return title ? `${title}${n.seasonYear ? ` (${n.seasonYear})` : ''}` : null;
    })
    .filter(Boolean)
    .slice(0, 4);

  stats.episodeTotal += epTotal;
  stats.episodesStored += episodes.length;
  stats.markers += markerCount;
  if (runtimeFallbacks) stats.runtimeFallbacks += runtimeFallbacks;

  const row = {
    id: target.id,
    title: media.title?.english || media.title?.romaji || at.canonicalTitle,
    native: at.titles?.ja_JP || media.title?.native || at.canonicalTitle,
    year: Number(String(at.startDate || media.startDate?.year || '').slice(0, 4)) || new Date().getFullYear(),
    rating,
    season: media.season ? `${SEASON_NAME[media.season] || media.season} ${media.seasonYear}` : String(media.seasonYear ?? ''),
    kind: KIND[at.subtype] || 'TV',
    status: STATUS[at.status] || 'Finished',
    /* Kitsu has no poster for titles that have not opened yet; AniList usually does. */
    art: at.posterImage?.medium || at.posterImage?.large || at.coverImage?.large || at.coverImage?.original
      || media.coverImage?.large || media.bannerImage,
    keyArt: media.bannerImage || at.coverImage?.original || at.coverImage?.large || media.coverImage?.large,
    accent: PALETTE[Math.abs([...target.id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)) % PALETTE.length],
    synopsis: (at.description || at.synopsis || media.description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    rank: null,
    altSeasons,
    schedule: airing
      ? {
          day: airing.getUTCDay() === 0 ? 7 : airing.getUTCDay(),
          dayLabel: DAY_LABEL[airing.getUTCDay()],
          date: `${airing.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })} ${airing.getUTCDate()}`,
          time: `${String(airing.getUTCHours()).padStart(2, '0')}:${String(airing.getUTCMinutes()).padStart(2, '0')}`,
          season: `${airingSeason} ${airing.getUTCFullYear()}`,
        }
      : null,
    sourceIds: JSON.stringify({ kitsu: target.kitsu, anilist: target.anilist, mal: media.idMal ?? null }),
    skipKeyId: skipKey?.id ?? null,
    skipKeySpace: skipKey?.space ?? null,
    episodeTotal: epTotal,
    genres: mapGenres(media, droppedGenres),
    episodes,
  };
  if (!row.art || !row.keyArt) throw new Error(`${target.id}: the source published no artwork`);
  console.log(`   ${row.id.padEnd(32)} ${String(episodes.length).padStart(4)}/${String(epTotal).padEnd(5)} eps  ${String(markerCount).padStart(3)} skip windows${skipKey ? ` (aniskip ${skipKey.space}/${skipKey.id})` : ''}${row.schedule ? `  airing ${row.schedule.dayLabel} ${row.schedule.time} UTC` : ''}`);
  return row;
}

/* ---------------- emit ---------------- */

/* Several columns are NOT NULL because the client reads them unconditionally, so an
   absent value from the source becomes the sentinel the UI already treats as "no data"
   (rating 0 -> "Not yet rated", runtime 0 -> "—") rather than an invented number. */
function emit(rows) {
  const ids = rows.map((r) => text(r.id)).join(',');
  /* A --title run must not delete the titles it did not fetch. */
  const scope = only.size ? TARGETS.map((t) => text(t.id)).join(',') : ids;
  const out = [
    `-- Generated by tools/sync-catalogue.mjs on ${new Date().toISOString()}.`,
    `-- Metadata: Kitsu (titles, episodes, artwork) + AniList (season, key art, genres, air times).`,
    `-- Skip windows: AniSkip, and only under an id whose own reported episode lengths agree with Kitsu's.`,
    `-- Where a source publishes nothing the row holds the client's "no data" sentinel (0 / '—'), never an invented value.`,
    `-- Do not edit by hand; re-run the sync instead.`,
    '',
    `DELETE FROM position WHERE episode_id IN (SELECT id FROM episode WHERE anime_id NOT IN (${scope}));`,
    `DELETE FROM library WHERE anime_id NOT IN (${scope});`,
    `DELETE FROM anime_genre WHERE anime_id NOT IN (${scope});`,
    `DELETE FROM episode WHERE anime_id NOT IN (${scope});`,
    `DELETE FROM anime WHERE id NOT IN (${scope});`,
    /* Keep resume positions for the episodes we are about to refresh: only drop the
       tail rows that no longer exist in the source's episode list. */
    ...rows.flatMap((r) => (r.episodes.length
      ? [`DELETE FROM position WHERE episode_id IN (SELECT id FROM episode WHERE anime_id = ${text(r.id)} AND n > ${r.episodes.length});`,
         `DELETE FROM episode WHERE anime_id = ${text(r.id)} AND n > ${r.episodes.length};`]
      : [])),
    '',
    ...GENRES.map((g, i) => `INSERT OR REPLACE INTO genre (id,label,tagline,art,accent,position) VALUES (${text(g.id)},${text(g.label)},${text(g.tagline)},${text(artKey(g.art))},${text(g.accent)},${i});`),
    '',
    /* ON CONFLICT (not INSERT OR REPLACE): REPLACE deletes the conflicting row first,
       which would lose added_at on every rebuild. Only a fresh insert stamps it. */
    ...rows.map((r) => `INSERT INTO anime (id,title,native,year,rating,season,kind,status,art,key_art,accent,synopsis,rank,alt_seasons,sched_day,sched_day_label,sched_date,sched_time,sched_season,source_ids,skip_key_id,skip_key_space,episode_total,added_at,search_text) VALUES (${[
      text(r.id), text(r.title), text(r.native), num(r.year), num(r.rating ?? 0), text(r.season), text(r.kind), text(r.status),
      text(r.art), text(r.keyArt), text(r.accent), text(r.synopsis), num(r.rank), text(JSON.stringify(r.altSeasons)),
      num(r.schedule?.day), text(r.schedule?.dayLabel), text(r.schedule?.date), text(r.schedule?.time), text(r.schedule?.season),
      text(r.sourceIds), num(r.skipKeyId), text(r.skipKeySpace), num(r.episodeTotal), `datetime('now')`,
      text([foldSearch(r.title), foldSearch(r.native), r.kind.toLowerCase(), r.status.toLowerCase()].join(' '))].join(',')}) ON CONFLICT(id) DO UPDATE SET ${
      ['title','native','year','rating','season','kind','status','art','key_art','accent','synopsis','rank','alt_seasons','sched_day','sched_day_label','sched_date','sched_time','sched_season','source_ids','skip_key_id','skip_key_space','episode_total','search_text']
        .map((c) => `${c}=excluded.${c}`).join(',')};`),
    '',
    ...rows.flatMap((r) => r.genres.map((g) => `INSERT OR REPLACE INTO anime_genre (anime_id,genre_id) VALUES (${text(r.id)},${text(g)});`)),
    '',
    ...rows.flatMap((r) => r.episodes.map((e) => `INSERT OR REPLACE INTO episode (id,anime_id,n,title,runtime,runtime_seconds,thumb,synopsis,markers,airdate,external_id) VALUES (${[
      text(`${r.id}#${e.n}`), text(r.id), num(e.n), text(e.title), text(e.runtime ?? '—'), num(e.runtimeSeconds ?? 0),
      text(e.thumb ?? ''), text(e.synopsis), text(JSON.stringify(e.markers)), text(e.airdate), text(e.externalId)].join(',')});`)),
    '',
  ];
  return out.join('\n');
}

/* ---------------- main ---------------- */

console.log(`syncing ${TARGETS.length} titles${wantSkips ? ' (with AniSkip windows)' : ' (AniSkip pass disabled)'}`);
mkdirSync(CACHE, { recursive: true });
const droppedGenres = new Set();
const stats = { episodesStored: 0, episodeTotal: 0, markers: 0, runtimeFallbacks: 0 };

const rows = [];
for (const target of TARGETS) {
  if (only.size && !only.has(target.id)) continue;
  console.log(`\n> ${target.id}  kitsu/${target.kitsu} anilist/${target.anilist}`);
  try {
    rows.push(await syncTarget(target, droppedGenres, stats));
  } catch (err) {
    console.error(`   FAILED ${target.id}: ${err.message}`);
    process.exitCode = 1;
  }
}

if (!only.size) {
  const ranked = [...rows].sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1));
  ranked.forEach((r, i) => { if (r.rating) r.rank = i + 1; });
}

const sql = emit(rows);
writeFileSync(resolve(ROOT, 'seed.sql'), sql, 'utf8');
writeFileSync(
  resolve(CACHE, 'last-sync.json'),
  JSON.stringify({ fetched_at: new Date().toISOString(), titles: rows.map((r) => ({ id: r.id, sources: JSON.parse(r.sourceIds), episodes: r.episodes.length, episodeTotal: r.episodeTotal, skipKey: r.skipKeyId ? `${r.skipKeySpace}/${r.skipKeyId}` : null, markers: r.episodes.reduce((n, e) => n + e.markers.length, 0) })), stats, droppedGenres: [...droppedGenres] }, null, 2),
  'utf8',
);

console.log(`
seed.sql: ${rows.length} anime, ${stats.episodesStored} episode rows (the sources list ${stats.episodeTotal} in total), ${stats.markers} skip windows
  rank 1 = ${rows.find((r) => r.rank === 1)?.id ?? 'n/a'} | ${rows.filter((r) => r.schedule).length} titles carry an air slot
${stats.runtimeFallbacks ? `  ${stats.runtimeFallbacks} episodes had no published length and used the title's own default\n` : ''}${droppedGenres.size ? `  ${droppedGenres.size} AniList genres have no tile on this site and were dropped, not invented (e.g. ${[...droppedGenres].slice(0, 8).join(', ')})\n` : ''}`);
