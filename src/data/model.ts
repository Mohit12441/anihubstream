/* ============================================================
   AniHubStream — shared model: types, art URLs, API hydration.
   The catalogue itself comes from /api at runtime; this module is
   the vocabulary the frontend and the seed generator both speak.
   ============================================================ */

export type AnimeKind = 'TV' | 'Movie' | 'OVA' | 'ONA' | 'Special';
export type AnimeStatus = 'Ongoing' | 'Finished' | 'Upcoming';
/** Broadcast seasons arrive as '<Season> <Year>' from the catalogue database, so the
    type is whatever the database says — 'Fall 2026' is not a literal we can enumerate. */
export type SeasonKey = string;

const SEASON_START_MONTH = { Winter: 0, Spring: 3, Summer: 6, Fall: 9 } as const;

/** 'Fall 2024' vs 'Winter 2025' do not sort lexically, so order them by when the season
    starts. Anything the database labels differently sorts oldest. */
export const seasonSortKey = (season: SeasonKey): number => {
  const m = /^(Winter|Spring|Summer|Fall)\s+(\d{4})$/.exec(season);
  return m ? Number(m[2]) * 12 + SEASON_START_MONTH[m[1] as keyof typeof SEASON_START_MONTH] : Number.NEGATIVE_INFINITY;
};

/** The broadcast season a date falls in, in the same '<Season> <Year>' shape the catalogue uses.
    The schedule page opens on this quarter rather than the newest one, which can be a title
    that is on a break until a season still months away. */
export const currentSeasonKey = (d: Date = new Date()): SeasonKey => {
  const m = d.getUTCMonth();
  return `${m < 3 ? 'Winter' : m < 6 ? 'Spring' : m < 9 ? 'Summer' : 'Fall'} ${d.getUTCFullYear()}`;
};

export type MarkerKind = 'recap' | 'intro' | 'outro' | 'credits' | 'preview';

export interface Marker {
  kind: MarkerKind;
  label: string;
  /** seconds from episode start */
  start: number;
  /** seconds from episode start */
  end: number;
  /** the source has no data for this range */
  locked?: boolean;
}

export interface Episode {
  n: number;
  title: string;
  runtime: string;
  thumb: string;
  synopsis: string;
  markers: Marker[];
  /** the published air date, straight from the episode database; null when the source has none */
  airdate?: string | null;
}

export interface Schedule {
  day: number;
  dayLabel: string;
  date: string;
  time: string;
  season: SeasonKey;
  episode?: number | null;
}


export interface AnimeSeasonItem {
  id: string;
  title: string;
  season: string;
  year?: number | null;
  kind?: AnimeKind;
  isCurrent?: boolean;
}

export interface Anime {
  id: string;
  title: string;
  native: string;
  year: number;
  rating: number;
  season: string;
  kind: AnimeKind;
  status: AnimeStatus;
  genres: string[];
  poster: string;
  key: string;
  accent: string;
  synopsis: string;
  rank?: number;
  /** Position in AniList's global trending list at the last hourly refresh by
      sync-worker/; absent when the title is not trending (or the job has no data). */
  trendRank?: number;
  schedule?: Schedule;
  /** Other seasons of this title that exist in the franchise but are not loaded in the catalogue. */
  altSeasons?: string[];
  seasons?: AnimeSeasonItem[];
  /** Cards from the list endpoint carry a count only; the watch page loads the full episode list. */
  episodeCount: number;
  /** The source's own episode count, which can be larger than the list we store. */
  episodeTotal?: number;
  /** MyAnimeList ID used for AniSkip timestamp lookups; null/undefined when unmapped */
  malId?: number | null;
  /** Available streaming providers registered for this title */
  providers?: string[];
  providerMappings?: Record<string, string>;
  episodes: Episode[];
}

export interface Genre {
  id: string;
  label: string;
  tagline: string;
  art: string;
  accent: string;
}

/** One row of the weekly schedule: a title's card plus the slot it airs in. */
export interface ScheduleEntry {
  anime: Anime;
  day: number;
  dayLabel: string;
  date: string;
  time: string;
  season: SeasonKey;
  episode?: number | null;
}

export const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;

/* Served root-absolute so the same reference works from any page depth and
   does not inherit the build's base path. The files ship with the bundle. A blank
   path yields '' so a missing prototype key never becomes a broken /art/.jpg request. */
export const artUrl = (path: string) => (path.trim() ? `/${path.replace(/^\/+/, '')}` : '');

export const normalizeArtUrl = (url: string | null | undefined): string => {
  const k = (url ?? '').trim();
  if (!k) return '';
  if (k.includes('backblazeb2.com')) {
    try {
      const u = new URL(k);
      return `https://media.kitsu.app${u.pathname}`;
    } catch {
      return k;
    }
  }
  return k;
};

/** Prototype rows store a key into /art; rows pulled from the catalogue databases store
    the source's own absolute CDN url. Both arrive here, so a resolved url passes through.
    An empty key (no artwork for the row) returns '' rather than a request that can only 404. */
export const artKeyUrl = (key: string | null | undefined) => {
  const k = normalizeArtUrl(key);
  if (!k) return '';
  return /^https?:\/\//i.test(k) ? k : artUrl(`/art/${k}.jpg`);
};

/** 'mm:ss' runtime label -> total seconds. */
export function toSeconds(runtime: string): number {
  const parts = runtime.split(':').map((p) => Number.parseInt(p, 10) || 0);
  if (parts.length >= 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0];
}

export const episodeIdOf = (animeId: string, n: number) => `${animeId}#${n}`;

export const resolveMalId = (
  sourceIdsRaw?: Record<string, unknown> | string | null,
  skipKeyId?: number | string | null,
  skipKeySpace?: string | null,
): number | null => {
  if (sourceIdsRaw) {
    try {
      const parsed = typeof sourceIdsRaw === 'string' ? JSON.parse(sourceIdsRaw) : sourceIdsRaw;
      const mal = Number((parsed as any)?.mal);
      if (Number.isInteger(mal) && mal > 0) return mal;
    } catch {}
  }
  if (skipKeySpace === 'mal') {
    const keyId = typeof skipKeyId === 'number' ? skipKeyId : Number.parseInt(String(skipKeyId), 10);
    if (Number.isInteger(keyId) && keyId > 0) return keyId;
  }
  return null;
};

/* ---------------- API payload ---------------- */

export interface ApiCard {
  id: string;
  title: string;
  native: string;
  year: number;
  rating: number;
  season: string;
  kind: AnimeKind;
  status: AnimeStatus;
  genres: string[];
  art: string;
  keyArt: string;
  accent: string;
  synopsis: string;
  rank: number | null;
  trendRank: number | null;
  altSeasons: string[];
  seasons?: AnimeSeasonItem[];
  schedule: Schedule | null;
  episodeCount: number;
  episodeTotal: number | null;
  malId?: number | null;
  sourceIds?: Record<string, unknown> | null;
  skipKeyId?: number | null;
  skipKeySpace?: string | null;
  providers?: string[];
  providerMappings?: Record<string, string>;
}

export interface ApiEpisode {
  id: string;
  n: number;
  title: string;
  runtime: string;
  runtimeSeconds: number;
  art: string;
  synopsis: string;
  markers: Marker[];
  airdate: string | null;
}

export interface ApiGenre {
  id: string;
  label: string;
  tagline: string;
  art: string;
  accent: string;
  animeCount: number;
}

export interface ApiPosition {
  episodeId: string;
  episodeNumber: number;
  episodeTitle: string;
  seconds: number;
  runtimeSeconds: number;
  updatedAt: string;
  episodeArt: string;
  anime: ApiCard;
}

export const formatSeason = (season?: string | null, scheduleSeason?: string | null, year?: number | null): string => {
  if (season && season !== '—' && season !== 'null' && season !== 'undefined' && season.trim() !== '') {
    return season.trim();
  }
  if (scheduleSeason && scheduleSeason.trim() !== '') {
    return scheduleSeason.trim();
  }
  if (year && Number.isFinite(year) && year > 1900) {
    return String(year);
  }
  return '';
};

export const formatRuntime = (runtime?: string | null): string => {
  if (!runtime || runtime === '0' || runtime === '0:00' || runtime === '0m' || runtime === '0 min' || runtime === 'null') {
    return '—';
  }
  return runtime;
};

const RESERVED_TITLE_WORDS = /^(season|part|cour|act|episode|vol|volume|movie|ova|ona|special|final|first|second|third|fourth|order|zero|live|climax|deluxe|edition)$/i;
const COMMON_6_LETTER = /^(action|attack|heroes|dragon|naruto|hunter|clover|haikyu|magica|kamui|sailor|online|future|school|prince|summer|winter|spring|autumn|master|legend|island|family|sister|puzzle|spiral|knight|border|heaven|secret|shadow|spirit|silver|golden|yellow|orange|purple|violet|cinema|circus|studio|reborn|border|planet|galaxy|origin|battle|castle|flight|zombie|vampire)$/i;

const isHashToken = (token: string): boolean => {
  const clean = token.trim();
  if (RESERVED_TITLE_WORDS.test(clean)) return false;
  if (clean.length < 4 || clean.length > 8) return false;
  if (/\d/.test(clean)) return true;
  if (/^[b-df-hj-np-tv-z]{4,8}$/i.test(clean)) return true;
  if (/^[a-z]{6}$/i.test(clean) && !COMMON_6_LETTER.test(clean)) return true;
  return false;
};

export const cleanAnimeTitle = (title?: string | null): string => {
  if (!title) return '';
  return title
    .replace(/\s+([a-z0-9]{4,8})\s*([-–—]\s*(?:episode|ep|part|season|vol|volume)\b.*)$/i, (match, code, rest) => {
      if (isHashToken(code)) return ' ' + rest;
      return match;
    })
    .replace(/\s*[-–—]?\s*([a-z0-9]{4,8})$/i, (match, code) => {
      if (isHashToken(code)) return '';
      return match;
    })
    .trim();
};

export const hydrateCard = (c: ApiCard): Anime => ({
  id: c.id,
  title: cleanAnimeTitle(c.title),
  native: c.native,
  year: c.year,
  rating: c.rating,
  season: formatSeason(c.season, c.schedule?.season, c.year),
  kind: c.kind,
  status: c.status,
  genres: c.genres ?? [],
  /* A title whose database row carries only one of the two art fields still has that one image,
     so each falls back to the other rather than to an empty string. Same title either way —
     never another title's artwork. */
  poster: artKeyUrl(c.art) || artKeyUrl(c.keyArt),
  key: artKeyUrl(c.keyArt) || artKeyUrl(c.art),
  accent: c.accent,
  synopsis: c.synopsis,
  rank: c.rank ?? undefined,
  trendRank: c.trendRank ?? undefined,
  schedule: c.schedule ?? undefined,
  altSeasons: c.altSeasons ?? [],
  seasons: c.seasons ?? [],
  episodeCount: c.episodeCount,
  episodeTotal: c.episodeTotal ?? undefined,
  malId: c.malId ?? resolveMalId(c.sourceIds, c.skipKeyId, c.skipKeySpace) ?? undefined,
  providers: c.providers ?? undefined,
  providerMappings: c.providerMappings ?? undefined,
  episodes: [],
});

/* Kitsu publishes no still for many recent or very long-running episodes; that arrives
   as '' or the no-data sentinel and must not become a broken /art/.jpg request. */
const stillOf = (art: string | null | undefined) => (art && art !== '—' ? artKeyUrl(art) : '');

export const hydrateEpisode = (e: ApiEpisode): Episode => ({
  n: e.n,
  title: e.title,
  runtime: formatRuntime(e.runtime),
  thumb: stillOf(e.art),
  synopsis: e.synopsis,
  markers: e.markers ?? [],
  airdate: e.airdate ?? null,
});

export const hydrateGenre = (g: ApiGenre): Genre => ({
  id: g.id,
  label: g.label,
  tagline: g.tagline,
  art: artKeyUrl(g.art),
  accent: g.accent,
});

/* ---------------- homepage hero ---------------- */

/** An unrated title is one the databases have no score for yet — usually not released.
    Showing 0.0 would read as a verdict, so callers use this instead. */
export const ratingLabel = (rating: number | null | undefined) => {
  if (!rating) return 'Not yet rated';
  const val = rating > 10 ? rating / 10 : rating;
  return `${val.toFixed(1)} / 10`;
};

/** How many episodes the title runs for: the source's own count where it publishes one,
    otherwise how many rows this site actually holds. */
export const episodeTotalOf = (a: Pick<Anime, 'episodeCount' | 'episodeTotal'>) =>
  a.episodeTotal && a.episodeTotal > a.episodeCount ? a.episodeTotal : a.episodeCount;

/** Format episode count label: e.g. "12 EP" or "TBA" if unknown or 0 */
export const formatEpisodeCount = (a: Pick<Anime, 'episodeCount' | 'episodeTotal'>): string => {
  const count = episodeTotalOf(a);
  return count && count > 0 ? `${count} EP` : 'TBA';
};

export const HERO = {
  jp: '限界はない',
  en: 'NO LIMITS',
  kicker: 'Watch anime free anytime, anywhere',
  title: ['AniHub', 'Stream'],
  sub: 'Explore a world beyond limits',
  copy:
    'Stream thousands of popular and trending anime titles with English subbed and dubbed audio, ultra-fast servers, and crisp high-definition video playback.',
  art: artKeyUrl('hero-demon'),
};
