// The AniList half of the cloud sync, in one of three phases of increasing ownership.
//
//   mirror   (Phase 1, the default) — refresh metadata for titles the catalogue already
//            holds. Never inserts. Never touches sched_*, trend_rank or added_at.
//   delta    (Phase 2)              — as mirror, plus it creates rows for AniList ids on
//            the sync_pending queue. Insert-only columns (added_at, anime_genre,
//            trend_rank, sched_*) are filled on insert and still never overwritten.
//   takeover (Phase 3)              — also claims sched_* and trend_rank on existing rows,
//            which is only safe once the local hourly task is really stopped. The
//            heartbeat interlock enforces that; --force-takeover overrides it explicitly.
//
// MODE decides everything; CLOUD_CREATES_ROWS and LEGACY_WRITER_ACTIVE only feed the
// derivation when MODE is unset, so the two switches can never disagree with the mode.
// CLOUD_OWNS_SCHEDULE is the one exception to that rule: it does not change the mode, it adds
// a fill-only path to the sched_* columns in mirror/delta, for rows the local task has never
// stamped and whose air slot is empty. Off by default, because that task walks every row in
// `anime` and so refreshes the rows this job creates like any other.
//
// Column ownership, which is what makes two writers survivable when one of them (the local
// task) takes no lease:
//
//   column            mirror  delta  takeover  local task (tools/hourly-refresh.mjs)
//   metadata          cloud   cloud  cloud     —
//   source_ids        cloud(merged) cloud(merged) cloud(whole object)
//   sched_*           —       insert only  cloud    cloud
//   trend_rank        —       insert only  cloud    cloud
//   added_at          —       insert only  insert only  insert only
//   anime_genre       —       cloud*   cloud*       cloud
//   cloud_synced_at   cloud   cloud  cloud          —
//   catalogue_synced_at —     —      —              cloud(local)
//
// (* A row this run created always gets its genre set — R6 requires a cloud row to be
//    indistinguishable from a local one. An EXISTING row's set belongs to whoever made it:
//    delta/takeover add genres to it only while it has none at all, and CLOUD_OWNS_GENRES=1 is
//    what allows a rewrite of a set that already exists on a row the local tools never stamped.
//    A local override — catalogue_synced_at set — is never touched under any setting.)
//
// Reads are keyset-on-id over the catalogue (R4): one request hydrates ANILIST_BATCH_SIZE
// stored ids, so a full pass over ~400 titles costs ~16 requests and spends none on titles
// the site does not host. New titles come from the queue, never from a popularity walk.
//
// Crash semantics: the cursor advances only after a slice's rows are committed, and the
// write is an upsert keyed by id. A SIGKILL anywhere therefore costs at most the current
// slice, and replaying it cannot duplicate a title.
//
//   node cloud-sync/sync-anilist.mjs [--force-takeover]

import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createAnilist, RunAborted, BudgetExhausted } from './anilist.mjs';
import { assertLiveColumns, assertLiveTables, d1All, d1First, d1Query, insertRows, schemaFaults } from './d1.mjs';
import {
  acquireLease, budget, getCursor, getThrottle, leaseKeeper, recordRun, releaseLease, setCursor, setThrottle, utcDay,
} from './state.mjs';
import { foldSearch } from '../functions/api/_lib.js';
/* The season rule is the site's, not this job's, so it lives with the other writer that also
   stamps sched_season rather than being copied here. See tools/season.mjs. */
import { seasonKey } from '../tools/season.mjs';

const RUN_ID = randomUUID();
const ENDPOINT = 'anilist';
const LEASE = 'anilist';
const OWNER = `${ENDPOINT}-${RUN_ID}`;
const THROTTLE_KEY = 'cloud_anilist_throttle';
const CURSOR_KEY = 'cloud_anilist_cursor';
/* The local task's own heartbeat, written by tools/hourly-refresh.mjs every run. */
const LEGACY_HEARTBEAT_KEY = 'hourly_sync';
/* Written by --force-takeover: proof of an operator decision, newer than the heartbeat. */
const TAKEOVER_KEY = 'cloud_takeover';

/* Same rule as d1.mjs's helper, and for the same reason: `Number('abc')` is NaN, and NaN
   compared against a counter is false, so a typo in MAX_ITEMS_PER_RUN would end the run after
   zero titles and report `catalogue_end` as if the walk were complete. Refuse instead. */
const intEnv = (name, fallback) => {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be a positive integer, got ${raw}`);
  return n;
};
const MAX_ITEMS = intEnv('MAX_ITEMS_PER_RUN', 1000);
const REWALK_AFTER_MS = intEnv('ANILIST_REWALK_AFTER_MS', 24 * 60 * 60 * 1000);
/* Two hours: the task's hourly cadence plus slack for a run that started late. A stale
   heartbeat is the only evidence available that it really has been disabled. */
const LEGACY_QUIET_MS = intEnv('LEGACY_QUIET_MS', 2 * 60 * 60 * 1000);
const startedAt = Date.now();

/** The default `updateSet()` describes when no mode is passed: Phase 1, the only mode that is
 *  safe to run beside the Windows task. `resolveMode()` lands on it the same way when the two
 *  phase switches are unset. */
export const MODE_DEFAULT = 'mirror';
export const MODES = ['mirror', 'delta', 'takeover'];

/**
 * Read one of the phase switches as the boolean it is, or refuse.
 *
 * Unset and empty-string both mean "not configured" — a GitHub Actions job that maps an absent
 * repo Variable sends `''`, not a missing key, so `''` has to be the default rather than a
 * parse failure. Any other value has to be exactly `0` or `1`, and anything else THROWS.
 *
 * That strictness is the whole point. The natural way to set one of these by hand is
 * `gh variable set NAME --body '{"value":"1"}'`, copied from a `gh api` example — and `gh
 * variable set --body` takes a literal string, so the value stored IS that JSON text. Coerced,
 * `Number('{"value":"1"}')` is NaN, and NaN answers to whichever comparison the parser uses:
 * `value !== '0'` reads it as active, `value === '1'` reads it as inactive. Those are opposite
 * phases, and for these two switches the difference is whether the cloud or the Windows task owns
 * `sched_*` — the one collision this design exists to prevent, arrived at by a typo. So nothing is
 * guessed: a refused start-up is the only correct outcome, and the message names the command that
 * stored the bad value, because that is the next thing the operator will run.
 */
export function flagEnv(env, name, { dflt }) {
  const raw = env[name];
  if (raw === undefined || String(raw).trim() === '') return dflt;
  const value = String(raw).trim();
  if (value !== '0' && value !== '1') {
    throw new Error(`${name}='${value}' must be exactly 0 or 1 (or unset). If you set it with 'gh variable set ${name} --body …', note that --body takes a LITERAL string: use --body '0' or --body '1', not the JSON body a gh api example would have given you.`);
  }
  return value === '1';
}

/**
 * MODE wins if set; otherwise the two phase switches derive it. An explicit MODE that
 * contradicts them is an operator typo worth failing on rather than guessing at, because
 * the difference between the three is the difference between "safe to run beside the local
 * task" and "claiming the local task's columns".
 */
export function resolveMode(env = process.env) {
  const legacy = flagEnv(env, 'LEGACY_WRITER_ACTIVE', { dflt: true });
  const creates = flagEnv(env, 'CLOUD_CREATES_ROWS', { dflt: false });
  const fillSched = flagEnv(env, 'CLOUD_OWNS_SCHEDULE', { dflt: false });
  const derived = creates ? (legacy ? 'delta' : 'takeover') : MODE_DEFAULT;
  const explicit = env.MODE ? String(env.MODE).trim().toLowerCase() : '';
  if (explicit && !MODES.includes(explicit)) throw new Error(`MODE='${explicit}' is not one of ${MODES.join('|')}`);
  const switchesSet = flagSet(env, 'LEGACY_WRITER_ACTIVE') || flagSet(env, 'CLOUD_CREATES_ROWS');
  if (explicit && switchesSet && explicit !== derived) {
    // When CLOUD_OWNS_SCHEDULE=1 is set, allow explicit MODE=delta with LEGACY_WRITER_ACTIVE=0
    // because delta mode provides the safe, fill-only schedule path while the local task is stopped.
    if (explicit === 'delta' && !legacy && fillSched) {
      // Coherent policy: fill-only schedule management under delta mode
    } else {
      throw new Error(`MODE=${explicit} contradicts LEGACY_WRITER_ACTIVE=${shown(env.LEGACY_WRITER_ACTIVE)} / CLOUD_CREATES_ROWS=${shown(env.CLOUD_CREATES_ROWS)}, which together mean '${derived}'`);
    }
  }
  /* The one combination that is not a typo but an orphan: the local task reported stopped while
     the mode that does not claim its columns is selected. Nothing else in the design notices —
     sched_* would simply stop moving, and the schedule shelf would keep displaying whatever it
     froze on. Phase 3 is legacy=0 AND creates=1; Phases 1-2 are legacy=1. */
  if (flagSet(env, 'LEGACY_WRITER_ACTIVE') && !legacy && !creates) {
    if (!fillSched && explicit !== 'delta') {
      throw new Error(`LEGACY_WRITER_ACTIVE=0 with CLOUD_CREATES_ROWS=0 gives nobody the sched_* columns: the switches mean '${derived}', which leaves them to a task you have just reported stopped. For Phase 3 set CLOUD_CREATES_ROWS=1 as well (takeover). To stay in Phase 1-2, the task is still enabled, so set LEGACY_WRITER_ACTIVE=1. If the task really is broken and you are not moving to Phase 3 yet, CLOUD_OWNS_SCHEDULE=1 lets this job fill empty air slots meanwhile.`);
    }
  }
  return explicit || derived;
}

const flagSet = (env, name) => env[name] !== undefined && String(env[name]).trim() !== '';
const shown = (v) => (v === undefined || String(v).trim() === '' ? 'unset' : String(v).trim());

const MODE = resolveMode();
const CREATES_ROWS = MODE !== 'mirror';
const CLAIMS_SCHEDULE = MODE === 'takeover';
/* An opt-in hole-filler for schedule columns. When CLOUD_OWNS_SCHEDULE=1, both delta and takeover
   modes write sched_* exclusively through fillIf: empty slots are filled (including on legacy-stamped
   rows when the local task is inactive), while complete and partial slots are strictly preserved
   against overwrites or being blanked to null. */
const FILL_SCHEDULE = flagEnv(process.env, 'CLOUD_OWNS_SCHEDULE', { dflt: false });

/* ---------------------------------------------------------------- mapping */

const NAMED = { '&amp;': '&', '&quot;': '"', '&lt;': '<', '&gt;': '>', '&ndash;': '-', '&mdash;': '—', '&rsquo;': '\u2019', '&lsquo;': '\u2018', '&hellip;': '\u2026' };

/** AniList ships descriptions as HTML with entities; the column holds plain prose. */
export function plain(html) {
  const text = String(html ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, c) => String.fromCodePoint(Number(c)))
    .replace(/&#x([0-9a-f]+);/gi, (_, c) => String.fromCodePoint(Number.parseInt(c, 16)))
    .replace(/&[a-z]+;/gi, (m) => NAMED[m.toLowerCase()] ?? '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text === '' ? null : text;
}

/* Identical rule to slugify() in tools/discover-titles.mjs — a divergent copy would
   silently create a second row for a title the catalogue already owns. */
export const slugify = (s) => {
  const slug = String(s)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug.length <= 60) return slug;
  const cut = slug.slice(0, 60);
  return (cut.includes('-') ? cut.slice(0, cut.lastIndexOf('-')) : cut).replace(/-+$/, '');
};

export const mediaSlug = (media) => slugify(media.title?.english || media.title?.romaji || `anilist-${media.id}`);

/* ------------------------------------------------------------------ vocabulary
 * Several anime columns are not free text. functions/api/anime/index.js:24-25 validates
 * ?kind= and ?status= against a closed list and then filters with an exact `=`, and
 * functions/api/schedule.js:9 matches sched_season the same way. Writing AniList's own enum
 * spellings ("RELEASING", "tv", "fall 2026") into them would silently drop every refreshed
 * title out of those filters, so each value is translated into the site's vocabulary using
 * tools/sync-catalogue.mjs:162-164 as the source of truth. Where AniList has a state the site
 * has no word for — CANCELLED, HIATUS — the column is written as NULL, which means "keep what
 * is stored", never as an invented label. */
const KIND = { TV: 'TV', TV_SHORT: 'TV', OVA: 'OVA', ONA: 'ONA', SPECIAL: 'Special', MUSIC: 'Special', MOVIE: 'Movie' };
const STATUS = { RELEASING: 'Ongoing', FINISHING: 'Ongoing', FINISHED: 'Finished', NOT_YET_RELEASED: 'Upcoming' };
const SEASON_NAME = { WINTER: 'Winter', SPRING: 'Spring', SUMMER: 'Summer', FALL: 'Fall' };
/* Only used to pick an accent for a row this run creates; the site's own palette, copied from
   tools/sync-catalogue.mjs:167 so a cloud-created tile is not the odd one out. */
const PALETTE = ['#ff1f4a', '#a24bff', '#3b82ff', '#ff9420', '#ffc247', '#2ee6a8', '#24d3ee', '#ff3d8b', '#8b5cf6', '#2f7bff'];
const paletteAccent = (id) => PALETTE[Math.abs([...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)) % PALETTE.length];

/* Indexed by getUTCMonth(), and the quarters are the site's, not AniList's: Winter is
   Jan-Mar, so a March broadcast is 'Winter 2026'. That is what src/data/model.ts:27
   (SEASON_START_MONTH Winter:0, Spring:3, Summer:6, Fall:9) and both legacy writers compute, and
   /api/schedule matches this column with an exact `=`, so a row labelled with the AniList
   convention — where Spring starts in March — is filtered out of the quarter the page opens on.
   The page cannot be wrong about its own filter, so the sync follows the site here. All three JS
   writers call the same seasonKey() (tools/season.mjs); a lowercase "fall 2026" would likewise be
   a second, unmatchable facet value on the shelf. */
const DAY_LABEL = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const pad = (n) => String(n).padStart(2, '0');

/* Same derivation as tools/hourly-refresh.mjs and tools/sync-catalogue.mjs — same Sunday-as-7
   numbering, same "Oct 14" and "Fall 2026" formats — because two writers formatting one column
   differently is how the schedule shelf starts flip-flopping. All five go NULL when a title stops
   airing, which is the one group of columns that is clearable on purpose (R1). */
export function airSlot(media) {
  const at = media.nextAiringEpisode?.airingAt;
  if (!Number.isInteger(at) || at <= 0) return { sched_day: null, sched_day_label: null, sched_date: null, sched_time: null, sched_season: null };
  const d = new Date(at * 1000);
  return {
    sched_day: d.getUTCDay() === 0 ? 7 : d.getUTCDay(),
    sched_day_label: DAY_LABEL[d.getUTCDay()],
    sched_date: `${d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })} ${d.getUTCDate()}`,
    sched_time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`,
    sched_season: seasonKey(d),
  };
}

export const ANIME_COLUMNS = [
  'id', 'title', 'native', 'year', 'rating', 'season', 'kind', 'status', 'art', 'key_art', 'accent', 'synopsis',
  'rank', 'trend_rank', 'alt_seasons', 'sched_day', 'sched_day_label', 'sched_date', 'sched_time', 'sched_season',
  'source_ids', 'skip_key_id', 'skip_key_space', 'episode_total', 'added_at', 'search_text', 'cloud_synced_at',
];

/* The four tables every sync process reaches through cloud-sync/state.mjs, whichever endpoint it
   walks: the lease (sync_lock), the per-endpoint daily budget (api_usage), the run record
   (sync_runs), and the heartbeat, marker and cursors (sync_meta, which root schema.sql owns).
   sync-kitsu.mjs needs exactly these and nothing more, so they are named once here. */
export const STATE_TABLES = Object.freeze(['sync_lock', 'api_usage', 'sync_runs', 'sync_meta']);

/* Plus the two the genre mapping reads, in every mode: `genre` governs which labels map to real
   ids, and anime_genre is counted in every catalogue slice. */
export const REQUIRED_TABLES = Object.freeze([...STATE_TABLES, 'genre', 'anime_genre']);

/* sync_pending joins the set only for the modes that read it. pendingSlice sits behind
   `CREATES_ROWS ?` in the run loop, so mirror never queries the queue — and in the phase where
   production may not have the table, mirror is the mode that goes first (Phase 1), so requiring
   it there would block the one run the plan starts with. Asserted both ways in the tests, not
   reasoned about here: the answer flips between Phase 1 and Phase 2. */
export const requiredTablesFor = (createsRows) =>
  (createsRows ? [...REQUIRED_TABLES, 'sync_pending'] : [...REQUIRED_TABLES]);

/* The columns a refresh may rewrite. added_at, rank, alt_seasons and the AniSkip keys are
   never in it: a metadata refresh must not reset when a title entered the catalogue (the
   "Just Added" shelf sorts on added_at), overwrite curation, or undo the skip pipeline's
   own provenance. */
const METADATA = [
  'title', 'native', 'year', 'rating', 'season', 'kind', 'status', 'art', 'key_art', 'accent', 'synopsis',
  'source_ids', 'episode_total', 'search_text', 'cloud_synced_at',
];

/* Written by tools/hourly-refresh.mjs on its own schedule, from its own airing list, plus
   trend_rank from its trending fetch. Two derivations of one column landing on the same row
   is how the schedule shelf starts flip-flopping, so they are ours only in takeover. */
export const SCHED_COLUMNS = ['sched_day', 'sched_day_label', 'sched_date', 'sched_time', 'sched_season'];
export const LEGACY_OWNED = [...SCHED_COLUMNS, 'trend_rank'];

/**
 * Which columns a run may write back on a row that already exists, by mode. In mirror and
 * delta the set is identical — that is the point of the stamps: delta differs from mirror
 * only in what it may INSERT, never in what it may overwrite.
 *
 * `fillSchedule` (CLOUD_OWNS_SCHEDULE) adds the air-slot columns to the update list for the
 * modes that do not own them, but they are then written through d1.mjs's fill-only path: the
 * statement itself refuses to touch a row the local writer has stamped, a row whose slot is
 * already populated, or a NULL this run computed. Owning the fill of a hole is not owning the
 * column — which is why trend_rank is not in here at all.
 */
export function updateSet(mode = MODE_DEFAULT, { fillSchedule = false } = {}) {
  if (!MODES.includes(mode)) throw new Error(`unknown mode '${mode}' — expected one of ${MODES.join('|')}`);
  if (mode === 'takeover') return [...METADATA, ...LEGACY_OWNED];
  /* mirror and delta overwrite exactly the same columns; delta only differs in what it may insert. */
  return fillSchedule ? [...METADATA, ...SCHED_COLUMNS] : [...METADATA];
}

/** The predicate ensuring every schedule slot column is empty. */
export const SCHED_EMPTY_GUARD = SCHED_COLUMNS.map((c) => `anime.${c} IS NULL`).join(' AND ');

/** The predicate a fill-only write is allowed to land under when local writer is active:
 *  never stamped by the local tools, and no part of the air slot present. Everything else keeps what it has. */
export const SCHED_FILL_GUARD = `${SCHED_EMPTY_GUARD} AND anime.catalogue_synced_at IS NULL`;

/**
 * Ownership-aware fill guard for sched_* columns.
 * When cloud schedule ownership is enabled (fillSchedule = true) and the local writer is
 * inactive (legacyActive = false), allows filling schedule fields on existing rows whose
 * entire schedule slot is empty, treating catalogue_synced_at as legacy metadata.
 * When the local writer is active (legacyActive = true) or cloud ownership is not enabled,
 * enforces anime.catalogue_synced_at IS NULL to strictly protect local task stamps.
 */
export function schedFillGuard({ fillSchedule = true, cloudOwnsSchedule, legacyActive = true } = {}) {
  const filling = cloudOwnsSchedule !== undefined ? Boolean(cloudOwnsSchedule) : Boolean(fillSchedule);
  if (filling && !legacyActive) {
    return SCHED_EMPTY_GUARD;
  }
  return SCHED_FILL_GUARD;
}

/**
 * Determines whether the legacy local schedule writer is considered active.
 * Active if a heartbeat is within the quiet window and has not been superseded
 * by a takeover marker.
 */
export function isLegacyWriterActive(heartbeat, marker) {
  if (!heartbeat) return false;
  const heartbeatMs = typeof heartbeat === 'string' ? Date.parse(heartbeat) : Number(heartbeat);
  if (!Number.isFinite(heartbeatMs)) return false;
  const markerMs = typeof marker === 'string' ? Date.parse(marker) : Number(marker);
  if (Number.isFinite(markerMs) && markerMs >= heartbeatMs) return false;
  return true;
}

/* R1, per column: an absent AniList value is NULL, and NULL means "keep what is stored" —
   AniList returns explicit JSON null for a field it was asked about but does not have,
   while 0 is a real value (episodes: 0) and '' could be real prose. The columns NOT listed
   here are the clearable ones, and they are clearable on purpose: an air slot must go NULL
   once a title stops airing, and trend_rank must go NULL when a title leaves the list.
   source_ids is merged with json_patch rather than kept-or-replaced. */
export const KEEP_WHEN_ABSENT = METADATA.filter((c) => c !== 'source_ids' && c !== 'cloud_synced_at');

/* Only meaningful when a row is being created, because a NOT NULL column cannot be written as
   NULL. Every value here is the sentinel tools/sync-catalogue.mjs already uses for "the source
   published nothing" (kind 'TV' and status 'Finished' are its own fallbacks at :297-298), so a
   cloud-created row reads the same in the UI as a locally-created one. An UPDATE never sees
   these: it leaves the stored value alone instead. */
const INSERT_DEFAULTS = { native: '', year: 0, rating: 0, season: '', kind: 'TV', status: 'Finished', art: '', key_art: '', synopsis: '' };

/* schema.sql:6-16 makes these eleven NOT NULL. They need special treatment on an UPDATE, which
   keepExisting alone cannot give: SQLite checks an INSERT ... ON CONFLICT's VALUES against the
   table's constraints BEFORE the DO UPDATE runs, so one absent score makes the whole chunked
   statement fail — for every row in the chunk, update included — and the CASE never executes.
   So an absent value for one of these is answered from the row this run read, which is why the
   read selects them. The CASE stays in the SQL for the nullable columns (episode_total,
   search_text, and every sched_* / provenance column) where NULL is allowed and it does work.
   tools/sync-catalogue.mjs and sync-kitsu.mjs already write complete records for the same
   reason; this keeps that rule without losing the keep-when-absent semantics. */
export const NOT_NULL_KEPT = ['title', 'native', 'year', 'rating', 'season', 'kind', 'status', 'art', 'key_art', 'accent', 'synopsis'];

/** title + native + kind + status, in the site's own words, exactly as the local tool folds it. */
const foldFor = (title, native, kind, status) =>
  [foldSearch(title), foldSearch(native ?? ''), kind.toLowerCase(), status.toLowerCase()].join(' ');

/**
 * One anime row from one Media. `existing` is the row's provenance, or null when this run is
 * creating the row. Values AniList does not have become null so the SQL can keep the stored
 * one (R1); for a new row the NOT NULL columns fall back to the site's own sentinels.
 */
export function rowFromMedia(media, existing = null, { trendRank = null, now = Date.now() } = {}) {
  const isNew = existing === null;
  const slot = airSlot(media);
  const sourceIds = { ...(existing?.sourceIds ?? {}), anilist: media.id };
  if (media.idMal) sourceIds.mal = media.idMal;
  const title = media.title?.english || media.title?.romaji || null;
  const native = media.title?.native || null;
  const kind = KIND[media.format] ?? null;
  const status = STATUS[media.status] ?? null;
  const colour = /^#[0-9a-f]{6}$/i.test(media.coverImage?.color ?? '') ? media.coverImage.color : null;
  /* startDate first, then the season's year — the same order of preference as the local tool,
     which reads Kitsu's startDate before falling back to AniList's. */
  const year = [media.startDate?.year, media.seasonYear].map(Number).find((y) => Number.isInteger(y) && y > 0) ?? null;
  const score = Number.isFinite(Number(media.averageScore)) && Number(media.averageScore) > 0 ? Number(media.averageScore) / 10 : null;
  const season = media.season
    ? `${SEASON_NAME[media.season] ?? media.season} ${media.seasonYear ?? year ?? ''}`.trim()
    : year ? String(year) : null;
  /* search_text is built from all four pieces or not at all: a shorter fold would silently
     stop matching a query the stored row answers today, so an unknown kind or status keeps the
     text the local tool wrote. */
  const searchable = title && kind && status;
  const row = {
    id: existing?.id || mediaSlug(media),
    title,
    native,
    year,
    rating: score,
    season,
    kind,
    status,
    art: media.coverImage?.large || null,
    key_art: media.bannerImage?.medium || media.coverImage?.extraLarge || null,
    accent: colour,
    synopsis: plain(media.description),
    rank: existing?.rank ?? null,
    /* The authoritative value is the position in AniList's trending list, which is what the
       column means (schema.sql:18-20) and what tools/hourly-refresh.mjs writes. Media.trending
       is a 24h delta, not a rank, so it is only ever the fallback when the page fetch failed. */
    trend_rank: Number.isInteger(trendRank) ? trendRank : null,
    alt_seasons: existing?.altSeasons ?? null,
    ...slot,
    source_ids: JSON.stringify(sourceIds),
    skip_key_id: existing?.skipKeyId ?? null,
    skip_key_space: existing?.skipKeySpace ?? null,
    episode_total: Number.isInteger(media.episodes) ? media.episodes : null,
    /* 'YYYY-MM-DD HH:MM:SS', i.e. exactly what datetime('now') produces in
       tools/sync-catalogue.mjs:364, because the "Just Added" shelf sorts this column as text. */
    added_at: existing?.addedAt ?? new Date(now).toISOString().slice(0, 19).replace('T', ' '),
    search_text: searchable ? foldFor(title, native, kind, status) : null,
    cloud_synced_at: now,
    /* Not a column — toTuple() ignores it. Rides along so writeGenres() can map the row's
       genres without the caller re-reading the media list. */
    anilist_genres: Array.isArray(media.genres) ? media.genres : [],
  };
  if (isNew) {
    if (row.title === null) row.title = `anilist-${media.id}`;
    for (const [c, v] of Object.entries(INSERT_DEFAULTS)) if (row[c] === null) row[c] = v;
    /* AniList publishes no colour for a fair number of covers; the tile then takes the site's
       own per-id accent exactly as the local tool would have assigned it. */
    if (row.accent === null) row.accent = paletteAccent(row.id);
    row.search_text = foldFor(row.title, row.native, row.kind, row.status);
  }
  return row;
}

/**
 * Fill in the eleven NOT NULL columns an absent AniList value left as NULL, from the row this
 * run read. Called by planRows on the update path only — a creation is already complete, and a
 * refresh must not hand d1.mjs a NULL for a column the table forbids (see NOT_NULL_KEPT).
 *
 * This is a read-then-write, so a value the local tools changed between our read and our write
 * is written back as we saw it. Only the cloud writes these columns from Phase 1 onward, and
 * source_ids — the one column two writers genuinely touch at once — is still merged in SQLite.
 */
export function completeFromStored(row, existing) {
  for (const c of NOT_NULL_KEPT) {
    if (row[c] === null) row[c] = existing.stored?.[c] ?? INSERT_DEFAULTS[c] ?? null;
  }
  /* The fold is rebuilt whenever all four words are known — including the case that made it
     necessary: AniList reporting a state the site has no word for, so the stored status is kept
     and the stored fold would otherwise no longer match the row's own columns. */
  if (row.search_text === null && row.title && row.kind && row.status) {
    row.search_text = foldFor(row.title, row.native, row.kind, row.status);
  }
  return row;
}

export const toTuple = (row) => ANIME_COLUMNS.map((c) => row[c] ?? null);

/** Row provenance, read so a refresh merges into it instead of replacing it. */
export function provenance(row) {
  let sourceIds = {};
  try { sourceIds = JSON.parse(row.source_ids ?? '{}'); } catch { /* unreadable provenance still owns its id */ }
  return {
    id: row.id,
    sourceIds,
    skipKeyId: row.skip_key_id,
    skipKeySpace: row.skip_key_space,
    addedAt: row.added_at,
    rank: row.rank,
    altSeasons: row.alt_seasons,
    catalogueSyncedAt: row.catalogue_synced_at ?? null,
    genreCount: Number(row.genre_count ?? 0),
    /* The NOT NULL metadata as stored, so completeFromStored() can keep one that AniList did
       not answer for. */
    stored: Object.fromEntries(NOT_NULL_KEPT.map((c) => [c, row[c] ?? null])),
  };
}

/* The columns a run needs in order to merge rather than replace, plus two it only reads to
   decide ownership: catalogue_synced_at (did the local tools stamp this row?) and the count of
   its anime_genre rows (does it already have a genre set?). The NOT NULL metadata is read because
   an absent upstream value for one of those has to be answered from the row (NOT_NULL_KEPT)
   rather than written as NULL. */
const ANIME_READ_COLUMNS = ['id', ...NOT_NULL_KEPT, 'source_ids', 'skip_key_id', 'skip_key_space',
  'added_at', 'rank', 'alt_seasons', 'catalogue_synced_at'].join(', ');
const GENRE_COUNT = '(SELECT count(*) FROM anime_genre ag WHERE ag.anime_id = %TABLE%.id) AS genre_count';

const clampLimit = (n) => Math.max(1, Math.min(500, Math.trunc(n) || 1));

/* Keyset, not OFFSET: the legacy task inserts rows while a run is in flight, so an OFFSET
   cursor would re-read titles and step over others. `id > after` is stable under inserts.
   The LIMIT is inlined rather than bound: it is a truncated, clamped number from our own
   config, never input. */
export const catalogueSliceSql = (limit) =>
  `SELECT ${ANIME_READ_COLUMNS}, ${GENRE_COUNT.replace('%TABLE%', 'anime')}
   FROM anime WHERE id > ? ORDER BY id LIMIT ${clampLimit(limit)}`;

async function catalogueSlice(after, limit) {
  const rows = await d1All(catalogueSliceSql(clampLimit(limit)), [after]);
  const known = new Map();
  const anilistIds = [];
  const unmapped = [];
  for (const r of rows) {
    const p = provenance(r);
    known.set(r.id, p);
    const a = p.sourceIds.anilist;
    if (Number.isInteger(a) && a > 0) anilistIds.push(a);
    else unmapped.push(r.id);
  }
  return { rows, known, anilistIds, unmapped, after: rows.length ? rows[rows.length - 1].id : after };
}

/* The queue that replaces tools/catalogue-sources.json in the cloud: (anilist_id, slug) pairs an
   operator or an importer decided belong in the catalogue, drained in a stable keyset order on
   anilist_id. It LEFT JOINs anime so a queued title that turns out to be stored already arrives
   with its provenance: that row is refreshed, never re-created, and its added_at is untouched.
   The page is small (25 = ANILIST_BATCH_SIZE) so the DELETE that follows a drained slice stays
   well under the 90-parameter ceiling (R5). */
const PENDING_PAGE = 25;

export const pendingSliceSql = (limit) =>
  `SELECT p.anilist_id, p.slug, ${ANIME_READ_COLUMNS.split(', ').map((c) => `a.${c}`).join(', ')},
          (SELECT count(*) FROM anime_genre ag WHERE ag.anime_id = p.slug) AS genre_count
   FROM sync_pending p LEFT JOIN anime a ON a.id = p.slug
   WHERE p.anilist_id > ? ORDER BY p.anilist_id LIMIT ${clampLimit(limit)}`;

async function pendingSlice(after, limit) {
  const rows = await d1All(pendingSliceSql(Math.min(PENDING_PAGE, limit)), [after]);
  const ids = [];
  const known = new Map();
  for (const r of rows) {
    ids.push(r.anilist_id);
    /* a.id is NULL for a queued title that is not stored yet — that one is a creation. */
    if (r.id) known.set(r.id, provenance(r));
  }
  return { rows, ids, known, count: rows.length, after: ids.length ? Math.max(...ids) : after };
}

const EMPTY_PENDING = Object.freeze({ rows: [], ids: [], known: new Map(), count: 0, after: 0 });

/** Ids are our own integers read back from the queue, but the placeholder count still matches
 *  the list one for one, so nothing user-shaped can reach the statement. Chunked to stay under
 *  the 90-parameter ceiling (R5). */
async function deletePending(ids) {
  let statements = 0;
  for (let i = 0; i < ids.length; i += PENDING_PAGE) {
    const part = ids.slice(i, i + PENDING_PAGE).filter((n) => Number.isInteger(n));
    if (!part.length) continue;
    await d1Query(`DELETE FROM sync_pending WHERE anilist_id IN (${part.map(() => '?').join(',')})`, part);
    statements++;
  }
  return statements;
}

/**
 * Parameterized query finding existing catalogue rows by canonical stored id or AniList source ID
 * beyond the current catalogue slice. Bounded to stay under SQLite's parameter limits.
 */
export const resolveExistingRecordsSql = (slugCount, anilistCount) => {
  const conditions = [];
  if (slugCount > 0) conditions.push(`anime.id IN (${Array(slugCount).fill('?').join(',')})`);
  if (anilistCount > 0) conditions.push(`json_extract(anime.source_ids, '$.anilist') IN (${Array(anilistCount).fill('?').join(',')})`);
  return `SELECT ${ANIME_READ_COLUMNS.split(', ').map((c) => `anime.${c}`).join(', ')}, ${GENRE_COUNT.replace('%TABLE%', 'anime')}
   FROM anime WHERE ${conditions.join(' OR ')}`;
};

export async function resolveExistingRecords({ slugs = [], anilistIds = [] } = {}) {
  const cleanSlugs = [...new Set(slugs.filter((s) => typeof s === 'string' && s.length > 0))];
  const cleanAnilistIds = [...new Set(anilistIds.filter((n) => Number.isInteger(n) && n > 0))];
  if (!cleanSlugs.length && !cleanAnilistIds.length) return new Map();

  const found = new Map();
  const CHUNK_SIZE = 25;
  for (let i = 0; i < Math.max(cleanSlugs.length, cleanAnilistIds.length); i += CHUNK_SIZE) {
    const slugChunk = cleanSlugs.slice(i, i + CHUNK_SIZE);
    const anilistChunk = cleanAnilistIds.slice(i, i + CHUNK_SIZE);
    if (!slugChunk.length && !anilistChunk.length) continue;
    const sql = resolveExistingRecordsSql(slugChunk.length, anilistChunk.length);
    const params = [...slugChunk, ...anilistChunk];
    const rows = await d1All(sql, params);
    for (const r of rows) {
      const p = provenance(r);
      found.set(r.id, p);
    }
  }
  return found;
}

/**
 * Which hydrated media become writes, and why the rest do not. Pure, so the column-ownership
 * rules can be tested without a database.
 *
 * `known` holds every row this run read — from the catalogue and from the queue's join. A media
 * whose slug is not in it is a creation, which only delta/takeover may do — in mirror it is
 * reported and dropped.
 */
export function planRows(mediaList, known, { mode = 'mirror', trendRanks = new Map(), now = Date.now(), knownByAnilist = null } = {}) {
  const rows = [];
  const skipped = [];
  const created = [];
  const updated = [];
  const seenBatch = new Map();

  const anilistIndex = knownByAnilist instanceof Map ? knownByAnilist : new Map();
  if (!knownByAnilist && known instanceof Map) {
    for (const p of known.values()) {
      const a = p?.sourceIds?.anilist;
      if (Number.isInteger(a) && a > 0) anilistIndex.set(a, p);
    }
  }

  for (const media of mediaList) {
    const slug = mediaSlug(media);
    const prior = anilistIndex.get(media.id) || known.get(slug);
    if (!prior) {
      if (!CREATES_ROWS_BY(mode)) {
        skipped.push({ id: media.id, slug, why: `mode ${mode} does not create rows`, retryable: false });
        continue;
      }
      /* tools/sync-catalogue.mjs:324 refuses a title with no artwork outright, and so must the
         cloud: a row that renders a broken poster is worse than a queue entry left waiting.
         retryable, because AniList usually publishes cover art within a day of announcing. */
      if (!media.coverImage?.large && !media.bannerImage) {
        skipped.push({ id: media.id, slug, why: 'AniList published no artwork', retryable: true });
        continue;
      }
      if (seenBatch.has(slug)) {
        const first = seenBatch.get(slug);
        if (first.id === media.id) {
          skipped.push({ id: media.id, slug, why: 'duplicate media in batch', retryable: false });
        } else {
          skipped.push({ id: media.id, slug, why: `batch slug collision with media ${first.id}`, retryable: false });
        }
        continue;
      }
      const row = rowFromMedia(media, null, { trendRank: trendRanks.get(media.id) ?? null, now });
      rows.push(row);
      created.push(row.id);
      seenBatch.set(slug, { id: media.id, row });
      continue;
    }
    /* A slug already owned by a different AniList id is a franchise collision — two
       seasons folding onto one name. Moving that row's provenance would misattribute every
       episode and every skip key it holds, so the title is skipped and reported. Not retryable:
       it would collide again next pass, and the queue has to be able to drain. */
    if (prior.sourceIds.anilist && prior.sourceIds.anilist !== media.id) {
      skipped.push({ id: media.id, slug, why: `held by anilist ${prior.sourceIds.anilist}`, retryable: false });
      continue;
    }
    const row = completeFromStored(rowFromMedia(media, prior, { trendRank: trendRanks.get(media.id) ?? null, now }), prior);
    rows.push(row);
    updated.push(row.id);
  }
  return { rows, skipped, created, updated };
}

export const CREATES_ROWS_BY = (mode) => mode !== 'mirror';

/** A row whose genre set was made by the local catalogue tools, which cloud must not rewrite. */
export const hasLocalOverride = (row) => Boolean(row?.catalogueSyncedAt);

/* ---------------------------------------------------------------- genres */

/** Normalised AniList genre label -> the site's genre id. Unmapped labels are reported, not
 *  invented: genre.id is a FK, so a made-up id would fail the write outright. */
export function genreIndex(genreRows) {
  const map = new Map();
  for (const g of genreRows) {
    map.set(slugify(g.label), g.id);
    map.set(g.id, g.id);
  }
  return map;
}

export function mapGenres(labels, index) {
  const ids = [];
  const unmapped = [];
  for (const label of labels ?? []) {
    const id = index.get(slugify(label));
    if (id) { if (!ids.includes(id)) ids.push(id); } else unmapped.push(label);
  }
  return { ids, unmapped };
}

/* ---------------------------------------------------------------- interlock */

async function readMetaAt(key) {
  const row = await d1First('SELECT value FROM sync_meta WHERE key = ?', [key]);
  let raw;
  try { raw = JSON.parse(row?.value ?? '{}')?.at; } catch { return 0; }
  const ms = typeof raw === 'string' ? Date.parse(raw) : typeof raw === 'number' ? raw : NaN;
  return Number.isFinite(ms) ? ms : 0;
}

/** The local task's last reported run, or null if it has been quiet long enough. */
async function legacyHeartbeat() {
  const at = await readMetaAt(LEGACY_HEARTBEAT_KEY);
  if (!at || Date.now() - at >= LEGACY_QUIET_MS) return null;
  return new Date(at).toISOString();
}

export const takeoverMarkerSql = (value) =>
  `INSERT INTO sync_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`;

/** --force-takeover: record the decision, so the interlock is answered with evidence
 *  rather than by waiting out the TTL. Deliberately a D1 write: it must outlive this run
 *  and be auditable afterwards. */
async function writeTakeoverMarker(reason) {
  const at = Date.now();
  await d1Query(takeoverMarkerSql(), [TAKEOVER_KEY, JSON.stringify({ at, at_iso: new Date(at).toISOString(), owner: OWNER, reason })]);
  return at;
}

/* ---------------------------------------------------------------- trending */

/**
 * Position in AniList's global trending list, which is what trend_rank means on this site
 * (schema.sql:18-20) and what tools/hourly-refresh.mjs writes. One request per run; a title
 * outside the page is not trending, so it gets NULL rather than an invented rank. Media.trending
 * is deliberately not used as a substitute: it is a 24-hour delta, and writing it into a rank
 * column would put a number with a different meaning into the same field two writers share.
 */
export async function trendingRanks(api, size) {
  const page = await api.pageIds({ page: 1, perPage: size, sort: 'TRENDING_DESC' });
  const map = new Map();
  page.ids.forEach((id, i) => map.set(id, i + 1));
  return map;
}

/* ---------------------------------------------------------------- run */

let stopRequested = false;
const requestStop = () => { stopRequested = true; };

const newSummary = () => ({
  run_id: RUN_ID,
  endpoint: ENDPOINT,
  mode: MODE,
  fill_schedule: FILL_SCHEDULE,
  items_processed: 0,
  planned_creates: 0,
  created: 0,
  updated: 0,
  skipped: 0,
  requests_made: 0,
  s403: 0,
  s429: 0,
  breaker_opens: 0,
  bisects: 0,
  effective_interval_ms: 0,
  budget_remaining: 0,
  /* anime columns production has that this writer never names. Always non-zero on a healthy
     database — the local task's catalogue_synced_at is one — so it is a number, never a verdict. */
  extra_columns: 0,
  /* Which read answered the column probe ('pragma_table_info' or 'sqlite_master'), set at the
     gate. `sqlite_master` in a log line means the endpoint refused the table-valued SELECT and
     the columns came from parsed DDL. */
  schema_via: null,
  cursor: null,
  duration_ms: 0,
  exit_reason: 'fatal',
});

let summary = newSummary();

async function main({ forceTakeover = process.argv.includes('--force-takeover') } = {}) {
  /* The schema gate, before anything is read for a decision and before the takeover marker is
     written: insertRows() names anime's columns, so a column production does not have is not a
     warning — the first chunked upsert dies on `no such column: …` mid-batch, having already taken
     the lease, with an error that says nothing about which assumption broke. Extras are the normal
     state of a shared table (the local task's catalogue_synced_at is one) and are only counted —
     except the one shape of extra that is not normal: NOT NULL with no default, which fails every
     INSERT that omits it. The tables get the same treatment for the same reason: a run that passes
     the columns and then dies mid-flight on `no such table: sync_pending` has moved the failure,
     not prevented it — and which tables the run reaches for depends on the mode, so the check
     asks requiredTablesFor(CREATES_ROWS) rather than a guess. Both reads are one probe: if either
     cannot run, that is schema_probe_failed, never a mismatch. This is the check the ops
     workflow's probe runs and verify.mjs reports; running it here means an operator does not have
     to remember to run it first. */
  let columns;
  let tables;
  try {
    columns = await assertLiveColumns({ columns: ANIME_COLUMNS });
    tables = await assertLiveTables({ tables: requiredTablesFor(CREATES_ROWS) });
  } catch (err) {
    /* The probe itself failed — the endpoint refused the statement, the network dropped, the
       credentials are wrong. Named separately from schema_mismatch on purpose: a run that dies at
       the gate cannot tell the operator which side is broken, and "a column is missing" would send
       them hunting a column that was never missing. Exit 2 so CI can tell the two apart. */
    summary.exit_reason = 'schema_probe_failed';
    summary.error = `could not read the live schema (${err.message}) — this says nothing about the schema; verify.mjs runs the same probe and reports it on its own`;
    summary.duration_ms = Date.now() - startedAt;
    await recordRun({ runId: RUN_ID, endpoint: ENDPOINT, startedAt, durationMs: summary.duration_ms, exitReason: 'schema_probe_failed', summary })
      .catch((recErr) => console.warn(`WARN run record failed: ${recErr.message}`));
    console.log(JSON.stringify(summary));
    process.exitCode = 2;
    return summary;
  }
  summary.schema_via = columns.via;
  summary.extra_columns = columns.extra.length;
  const fault = schemaFaults({ columns, tables });
  if (fault) {
    summary.exit_reason = fault.reason;
    summary.error = fault.error;
    summary.duration_ms = Date.now() - startedAt;
    /* Recorded, unlike a held lease: sync_runs is not `anime`, so the write is unaffected by the
       mismatch, and an operator who reads verify.mjs rather than the Actions log has to see that the
       schedule is gated — a run that silently never happened looks like a paused schedule. Best
       effort: on a database where cloud-sync/schema.sql was never applied there is no sync_runs. */
    await recordRun({ runId: RUN_ID, endpoint: ENDPOINT, startedAt, durationMs: summary.duration_ms, exitReason: fault.reason, summary })
      .catch((err) => console.warn(`WARN run record failed: ${err.message}`));
    console.log(JSON.stringify(summary));
    process.exitCode = 1;
    return summary;
  }

  /* Phase 3 guard: claiming sched_* and trend_rank is a promise that the local hourly task
     is stopped. Its heartbeat is the only evidence available, so takeover refuses to start
     while the heartbeat is young unless --force-takeover records an explicit decision. */
  const heartbeat = await legacyHeartbeat();
  const marker = await readMetaAt(TAKEOVER_KEY);
  let markerWritten = false;
  if (CLAIMS_SCHEDULE && heartbeat && !(marker && marker >= Date.parse(heartbeat))) {
    if (!forceTakeover) {
      summary.exit_reason = 'legacy_still_running';
      summary.error = `takeover mode but tools/hourly-refresh.mjs reported a run at ${heartbeat}; disable the AniHubHourlyRefresh task, or pass --force-takeover`;
      summary.duration_ms = Date.now() - startedAt;
      console.log(JSON.stringify(summary));
      process.exitCode = 1;
      return summary;
    }
    await writeTakeoverMarker(`--force-takeover while heartbeat=${heartbeat}`);
    markerWritten = true;
    console.warn(`WARN takeover forced: heartbeat ${heartbeat} overridden by an operator decision recorded in sync_meta.${TAKEOVER_KEY}`);
  }
  /* The audit's zero-overlap query needs an instant to compare against: "has the local task
     stamped a row since this job started owning sched_*". In the honest path the operator
     disabled the task and never passes --force-takeover, so nothing would ever record that
     instant. Record it on the first run that claims the columns. */
  if (CLAIMS_SCHEDULE && !markerWritten && !marker) {
    await writeTakeoverMarker(`mode=${MODE} claimed the sched_* columns: no hourly_sync heartbeat inside the ${LEGACY_QUIET_MS}ms quiet window`);
  }
  if (!CLAIMS_SCHEDULE && !FILL_SCHEDULE && !heartbeat) {
    console.warn(`WARN mode=${MODE} leaves the sched_* columns to the local task and no hourly_sync heartbeat is inside the quiet window: nobody is filling the schedule shelf. Re-enable AniHubHourlyRefresh, or set CLOUD_OWNS_SCHEDULE=1 to fill empty slots from here, or move to MODE=takeover.`);
  }

  if (!(await acquireLease(LEASE, OWNER))) {
    summary.exit_reason = 'lease_held';
    summary.duration_ms = Date.now() - startedAt;
    console.log(JSON.stringify(summary));
    return summary;
  }

  const stored = await getThrottle(THROTTLE_KEY);
  const limit = intEnv('ANILIST_DAILY_BUDGET', 4000);
  const spend = budget(ENDPOINT, limit, { day: utcDay() });
  const touch = leaseKeeper(LEASE, OWNER);

  const api = createAnilist({
    dailyBudget: limit,
    /* R4: a run always starts at the persisted value, never at the default. */
    startIntervalMs: stored?.ms ?? intEnv('ANILIST_MIN_INTERVAL_MS', 2500),
    reserve: () => spend.reserve(),
    onThrottle: (state) => setThrottle(THROTTLE_KEY, state).catch((err) => console.warn(`WARN throttle persist failed: ${err.message}`)),
  });

  const legacyActive = isLegacyWriterActive(heartbeat, markerWritten ? Date.now() : marker);
  const fillGuard = schedFillGuard({ fillSchedule: FILL_SCHEDULE, legacyActive });
  const update = updateSet(MODE, { fillSchedule: FILL_SCHEDULE });
  const fillIf = FILL_SCHEDULE ? { columns: SCHED_COLUMNS, when: fillGuard } : { columns: [], when: '' };
  const keepExisting = KEEP_WHEN_ABSENT.filter((c) => update.includes(c));
  const ownsGenres = flagEnv(process.env, 'CLOUD_OWNS_GENRES', { dflt: false });
  const cursorKey = `cloud_anilist_cursor:${MODE}`;
  /* Normalised rather than trusted: a cursor written by an older build, or a hand-edited one,
     must not put a non-integer into the queue's keyset or a missing flag into the loop test. */
  const saved = (await getCursor(cursorKey)) ?? {};
  let cursor = {
    after: typeof saved.after === 'string' ? saved.after : '',
    pendingAfter: Number.isInteger(saved.pendingAfter) ? saved.pendingAfter : 0,
    done: saved.done === true,
    doneAt: Number.isInteger(saved.doneAt) ? saved.doneAt : 0,
  };
  /* A finished pass re-scans only after the freshness window, so two consecutive runs never
     reprocess the same title (R9) while the catalogue still keeps up with new seasons. */
  if (cursor.done && Date.now() - cursor.doneAt >= REWALK_AFTER_MS) cursor = { ...cursor, after: '', pendingAfter: 0, done: false };
  summary.cursor = cursor;

  const genres = genreIndex(await d1All('SELECT id, label FROM genre'));
  /* One request, paid only by a mode that may write trend_rank — delta on insert, takeover on
     update. Mirror never writes it, so mirror never spends the call. */
  let trendRanks = new Map();
  if (CREATES_ROWS || CLAIMS_SCHEDULE) {
    try {
      trendRanks = await trendingRanks(api, intEnv('ANILIST_TRENDING_PAGE_SIZE', 50));
    } catch (err) {
      if (err instanceof BudgetExhausted || err instanceof RunAborted) throw err;
      console.warn(`WARN trending page unavailable (${err.message.slice(0, 140)}): trend_rank stays NULL rather than being invented`);
    }
  }

  console.log(`run ${RUN_ID}: mode ${MODE}, interval ${api.interval}ms${stored?.ms ? ' (restored)' : ' (default)'}, ` +
    `budget ${await spend.remaining()}/${limit}, cursor after "${cursor.after}" / pending ${cursor.pendingAfter}${cursor.done ? ' (done)' : ''}, ` +
    `${genres.size} genre labels, ${trendRanks.size} trending ranks`);

  let exitReason = cursor.done ? 'cursor_end' : 'complete';
  const skipped = [];
  const unmapped = [];
  const unmappedGenres = new Map();
  try {
    while (!cursor.done && summary.items_processed < MAX_ITEMS) {
      if (stopRequested) { exitReason = 'signal'; break; }
      const now = Date.now();
      const want = Math.min(MAX_ITEMS - summary.items_processed, api.cfg.batchSize * 4);

      /* Prioritize pending queue items, then allocate the remaining budget to the catalogue slice
         so summary.items_processed strictly never exceeds MAX_ITEMS. */
      const pending = CREATES_ROWS ? await pendingSlice(cursor.pendingAfter, want) : EMPTY_PENDING;
      const catalogueWant = want - pending.count;
      const slice = catalogueWant > 0
        ? await catalogueSlice(cursor.after, catalogueWant)
        : { rows: [], known: new Map(), anilistIds: [], unmapped: [], after: cursor.after };
      if (!slice.rows.length && !pending.count) {
        const finalCursor = { ...cursor, after: '', pendingAfter: 0, done: true, doneAt: Date.now() };
        await setCursor(cursorKey, finalCursor);
        summary.cursor = finalCursor;
        cursor = finalCursor;
        exitReason = 'catalogue_end';
        break;
      }
      unmapped.push(...slice.unmapped);

      /* The queue's already-stored titles join the catalogue's provenance before planning, so a
         queued slug that turns out to exist is refreshed, never re-created. */
      const known = new Map(slice.known);
      for (const [id, p] of pending.known) if (!known.has(id)) known.set(id, p);

      const ids = [...new Set([...slice.anilistIds, ...pending.ids])];
      if (ids.length) {
        const media = await api.mediaByIds(ids);

        /* Resolve relevant existing records beyond current slice by canonical id and AniList source ID */
        const candidateSlugs = [];
        const candidateAnilistIds = [];
        for (const m of media) {
          candidateSlugs.push(mediaSlug(m));
          candidateAnilistIds.push(m.id);
        }
        for (const r of pending.rows || []) {
          if (r.slug) candidateSlugs.push(r.slug);
        }
        const extra = await resolveExistingRecords({ slugs: candidateSlugs, anilistIds: candidateAnilistIds });
        for (const [id, p] of extra) {
          if (!known.has(id)) known.set(id, p);
        }

        const knownByAnilist = new Map();
        for (const p of known.values()) {
          const a = p?.sourceIds?.anilist;
          if (Number.isInteger(a) && a > 0) knownByAnilist.set(a, p);
        }

        const plan = planRows(media, known, { mode: MODE, trendRanks, now, knownByAnilist });
        skipped.push(...plan.skipped);
        summary.planned_creates = (summary.planned_creates ?? 0) + plan.created.length;
        summary.created += plan.created.length;
        summary.updated = (summary.updated ?? 0) + plan.updated.length;

        if (plan.rows.length) {
          /* source_ids is merged in SQLite, not from this run's read: the catalogue tools can
             add kitsu/mal between our read and our write, and a whole-value write would drop a
             key we never saw (R2). */
          await insertRows({
            table: 'anime',
            columns: ANIME_COLUMNS,
            rows: plan.rows.map((r) => toTuple(r)),
            conflictTarget: ['id'],
            update,
            jsonMerge: ['source_ids'],
            keepExisting,
            fillIf,
          });
          await writeGenres(plan.rows, known, { ownsGenres, genres, unmappedGenres });
        }

        /* Consume the queue by id, and only the ids this run reached a decision about. A title
           held back for want of artwork stays queued so a later pass can pick it up; a dead id
           AniList will not answer for is consumed, or the queue would never drain. */
        const held = new Set(plan.skipped.filter((s) => s.retryable).map((s) => s.id));
        const consumed = pending.ids.filter((id) => !held.has(id));
        if (consumed.length) await deletePending(consumed);
      }

      /* Every row read counts against the cap, not just the ones written: a catalogue of
         unmapped titles must still let a run finish. */
      summary.items_processed += slice.rows.length + pending.count;
      summary.requests_made = api.stats.requests;

      /* The cursor moves only after the slice committed: replaying a slice is harmless,
         skipping one would lose titles. */
      cursor = {
        ...cursor,
        after: slice.rows.length ? slice.after : cursor.after,
        pendingAfter: pending.count ? pending.after : cursor.pendingAfter,
        done: false,
      };
      await setCursor(cursorKey, cursor);
      await touch();
      summary.cursor = cursor;
    }
    if (exitReason === 'complete') exitReason = summary.items_processed >= MAX_ITEMS ? 'item_cap' : 'cursor_end';
  } catch (err) {
    if (err instanceof BudgetExhausted) exitReason = 'budget_exhausted';
    else if (err instanceof RunAborted) exitReason = 'breaker_aborted';
    else if (/lease/.test(err.message)) exitReason = 'lease_lost';
    else { exitReason = 'fatal'; summary.error = err.message.slice(0, 400); }
  } finally {
    summary.exit_reason = exitReason;
    summary.skipped = skipped.length;
    summary.skipped_ids = skipped.slice(0, 20).map((s) => `${s.slug} (${s.why})`);
    summary.unmapped = unmapped.length;
    summary.unmapped_ids = unmapped.slice(0, 20);
    summary.genre_labels_unmapped = [...unmappedGenres.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
    summary.requests_made = api.stats.requests;
    summary.s403 = api.stats.s403;
    summary.s429 = api.stats.s429;
    summary.breaker_opens = api.stats.breaker_opens;
    summary.by403 = api.stats.by403;
    summary.backoffs = api.stats.backoffs;
    summary.bisects = api.stats.bisects;
    summary.relay_used = api.stats.relay_used;
    summary.effective_interval_ms = api.interval;
    summary.budget_remaining = await spend.remaining().catch(() => 0);
    summary.duration_ms = Date.now() - startedAt;
    await setThrottle(THROTTLE_KEY, { ms: api.interval, consecutive: api.successes, at: new Date().toISOString() }).catch(() => {});
    await releaseLease(LEASE, OWNER).catch((err) => console.warn(`WARN lease release failed: ${err.message}`));
    await recordRun({ runId: RUN_ID, endpoint: ENDPOINT, startedAt, durationMs: summary.duration_ms, exitReason, summary })
      .catch((err) => console.warn(`WARN run record failed: ${err.message}`));
    console.log(JSON.stringify(summary));
  }

  /* Non-zero exit is what CI and the cron wrapper alert on. An exhausted budget, a finished
     cursor or an aborted breaker are recorded outcomes, not crashes; a fatal error, a lost
     lease or a takeover that found the old writer alive means the run is not doing what it
     claims. */
  if (exitReason === 'fatal' || exitReason === 'lease_lost' || exitReason === 'legacy_still_running') process.exitCode = 1;
  return summary;
}

/**
 * Genre rows for the titles this run touched. R6 is the reason this exists at all: a
 * cloud-created row must be indistinguishable from a locally-created one, and the browse UI is
 * a JOIN on anime_genre — a title with no genre rows is invisible to every genre filter.
 *
 * Additive by default. An existing row's genre set belongs to whoever created it, so a row this
 * run did not create is rewritten only when all three of these hold: CLOUD_OWNS_GENRES=1, the
 * local catalogue tools never stamped it (catalogue_synced_at IS NULL), and it has no genres to
 * lose (genre_count = 0). That third test is not redundancy — rows seeded from seed.sql predate
 * both stamp columns and cannot be attributed to anyone, so an un-stamped row that already has a
 * genre set is left alone forever. What it does allow is the useful case: a title that arrived
 * with no genres at all gets one set.
 */
async function writeGenres(rows, known, { ownsGenres, genres, unmappedGenres }) {
  const pairs = [];
  const replace = [];
  for (const row of rows) {
    const prior = known.get(row.id);
    if (prior && (!ownsGenres || hasLocalOverride(prior) || prior.genreCount > 0)) continue;
    const mapped = mapGenres(row.anilist_genres, genres);
    for (const label of mapped.unmapped) unmappedGenres.set(label, (unmappedGenres.get(label) ?? 0) + 1);
    if (!mapped.ids.length) continue;
    if (prior) replace.push(row.id);
    for (const g of mapped.ids) pairs.push([row.id, g]);
  }
  /* Delete-then-insert only for the rows we are allowed to own: inserting on top of a stale set
     would leave genres AniList no longer reports. */
  for (const id of replace) await d1Query('DELETE FROM anime_genre WHERE anime_id = ?', [id]);
  if (!pairs.length) return 0;
  return insertRows({
    table: 'anime_genre',
    columns: ['anime_id', 'genre_id'],
    rows: pairs,
    conflictTarget: ['anime_id', 'genre_id'],
    update: [],
  });
}

/* Importable as the owner of the anime column contract (sync-kitsu.mjs reuses it), and
   importable by the tests, but only actually runs when invoked directly. */
const invokedDirectly = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (invokedDirectly) {
  /* Only the process that runs the sync owns its shutdown. A caller that imports run() has its
     own signal handling, and would otherwise collect one pair of listeners per import. */
  process.on('SIGTERM', requestStop);
  process.on('SIGINT', requestStop);
  main().catch((err) => {
    console.log(JSON.stringify({ ...summary, exit_reason: 'fatal', error: err.message.slice(0, 400), duration_ms: Date.now() - startedAt }));
    process.exitCode = 1;
  });
}

export { main as run, MODE, CREATES_ROWS, CLAIMS_SCHEDULE, FILL_SCHEDULE, LEGACY_QUIET_MS };
