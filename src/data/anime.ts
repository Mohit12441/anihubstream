/* ============================================================
   AniHubStream — catalogue seed source.
   tools/gen-seed.mjs reads this module to build seed.sql. The running
   app never imports it: it loads the same rows from /api at runtime.
   ============================================================ */

import { artUrl, toSeconds } from './model.ts';
import type { Anime, AnimeKind, AnimeStatus, Episode, Marker } from './model.ts';

export type {
  Anime,
  AnimeKind,
  AnimeStatus,
  Episode,
  Genre,
  Marker,
  MarkerKind,
  SeasonKey,
  Schedule,
} from './model.ts';

const art = (name: string) => artUrl(`/art/${name}.jpg`);

/* Episode titles are demo copy, not real episode lists. */
const EP_TITLES = [
  'The Hashira Unite',
  'A New Mission',
  'Clash of Demons',
  'Broken Resolve',
  'Path to Light',
  'Whispers in the Ash',
  'Blade Against the Moon',
  'What the River Kept',
  'Embers of the Oath',
  'The Longest Night',
  'Where the Sky Ends',
  'A Promise Unbroken',
];

/* Intro/outro windows are per-episode demo metadata, not scene detection. */
function makeMarkers(total: number, n: number): Marker[] {
  const shift = (n % 3) * 5;
  const intro = { start: 75 + shift, end: 165 + shift };
  const outro = { start: total - 165 + shift, end: total - 75 + shift };
  return [
    { kind: 'recap', label: 'Recap', start: 0, end: 22 },
    { kind: 'intro', label: 'Opening', start: intro.start, end: intro.end },
    { kind: 'outro', label: 'Ending', start: outro.start, end: outro.end },
    { kind: 'credits', label: 'Credits', start: outro.end, end: Math.max(outro.end + 1, total - 24) },
    { kind: 'preview', label: 'Next preview', start: total - 24, end: total, locked: n % 4 === 0 },
  ];
}

function makeEpisodes(id: string, key: string, count: number, runtime: string): Episode[] {
  const total = toSeconds(runtime);
  return Array.from({ length: count }, (_, i) => ({
    n: i + 1,
    title: EP_TITLES[i % EP_TITLES.length],
    runtime,
    thumb: art(`key-${key.replace('key-', '')}`),
    markers: makeMarkers(total, i + 1),
    synopsis:
      'A demonstration synopsis for the AniHubStream prototype. Episode ' +
      (i + 1) +
      ' of ' +
      id +
      ' — no real video source is wired up in this frontend build.',
  }));
}

interface Seed {
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
  accent: string;
  synopsis: string;
  rank?: number;
  epCount?: number;
  runtime?: string;
  schedule?: Anime['schedule'];
  altSeasons?: string[];
}

export const SEEDS: Seed[] = [
  {
    id: 'demon-slayer',
    title: 'Demon Slayer',
    native: 'Kimetsu no Yaiba',
    year: 2024,
    rating: 9.1,
    season: 'Season 4',
    kind: 'TV',
    status: 'Ongoing',
    genres: ['action', 'supernatural', 'drama'],
    art: 'demon-slayer',
    accent: '#ff1f4a',
    synopsis:
      'Tanjiro and his companions face a powerful demon in a fierce battle. As the fight intensifies, new secrets about the Demon Slayer Corps are revealed.',
    rank: 1,
    epCount: 12,
    runtime: '23:40',
    altSeasons: ['Season 1', 'Season 2', 'Season 3'],
    schedule: { day: 1, dayLabel: 'MON', date: 'Oct 14', time: '23:40', season: 'Fall 2024' },
  },
  {
    id: 'jujutsu-kaisen',
    title: 'Jujutsu Kaisen',
    native: 'Jujutsu Kaisen',
    year: 2024,
    rating: 8.9,
    season: 'Season 2',
    kind: 'TV',
    status: 'Ongoing',
    genres: ['action', 'supernatural', 'horror'],
    art: 'cursed-sorcerer',
    accent: '#a24bff',
    synopsis:
      'A cursed relic drags a high schooler into a hidden war of sorcerers, where every technique has a price and no one walks away clean.',
    rank: 2,
    epCount: 22,
    runtime: '23:40',
    altSeasons: ['Season 1'],
    schedule: { day: 2, dayLabel: 'TUE', date: 'Oct 15', time: '22:30', season: 'Fall 2024' },
  },
  {
    id: 'solo-leveling',
    title: 'Solo Leveling',
    native: 'Ore dake Level Up na Ken',
    year: 2024,
    rating: 8.7,
    season: 'Season 1',
    kind: 'TV',
    status: 'Ongoing',
    genres: ['action', 'fantasy', 'isekai'],
    art: 'shadow-hunter',
    accent: '#3b82ff',
    synopsis:
      'The weakest hunter alive is offered a system no one else can see. Every gate he clears rewrites the rules of the world.',
    rank: 3,
    epCount: 12,
    runtime: '23:40',
    schedule: { day: 3, dayLabel: 'WED', date: 'Oct 16', time: '21:00', season: 'Fall 2024' },
  },
  {
    id: 'one-piece',
    title: 'One Piece',
    native: 'Wan Piisu',
    year: 2024,
    rating: 9.0,
    season: 'Season 21',
    kind: 'TV',
    status: 'Ongoing',
    genres: ['adventure', 'comedy', 'action'],
    art: 'golden-pirate',
    accent: '#ff9420',
    synopsis:
      'A rubber-bodied captain and his crew chase a legendary treasure across islands that keep raising the stakes.',
    rank: 4,
    epCount: 10,
    runtime: '23:40',
    schedule: { day: 4, dayLabel: 'THU', date: 'Oct 17', time: '23:00', season: 'Fall 2024' },
  },
  {
    id: 'naruto-shippuden',
    title: 'Naruto Shippuden',
    native: 'Naruto Shippuden',
    year: 2017,
    rating: 8.6,
    season: 'Season 18',
    kind: 'TV',
    status: 'Finished',
    genres: ['action', 'adventure', 'drama'],
    art: 'amber-ninja',
    accent: '#ffc247',
    synopsis:
      'A returned exile refuses to give up on the friend he lost, and the village that once shunned him starts to watch what he becomes.',
    rank: 5,
    epCount: 8,
    runtime: '23:40',
    schedule: { day: 5, dayLabel: 'FRI', date: 'Oct 18', time: '22:00', season: 'Summer 2024' },
  },
  {
    id: 'black-clover',
    title: 'Black Clover',
    native: 'Burakkku Kuroba',
    year: 2021,
    rating: 8.2,
    season: 'Season 2',
    kind: 'TV',
    status: 'Finished',
    genres: ['action', 'fantasy', 'comedy'],
    art: 'clover-knight',
    accent: '#2ee6a8',
    synopsis:
      'Born without magic in a kingdom that measures worth by it, a loud orphan decides that will is its own spell.',
    epCount: 10,
    runtime: '23:40',
    schedule: { day: 6, dayLabel: 'SAT', date: 'Oct 19', time: '22:00', season: 'Summer 2024' },
  },
  {
    id: 'my-hero-academia',
    title: 'My Hero Academia',
    native: 'Boku no Hero Academia',
    year: 2024,
    rating: 8.4,
    season: 'Season 7',
    kind: 'TV',
    status: 'Ongoing',
    genres: ['action', 'sci-fi', 'drama'],
    art: 'iron-hero',
    accent: '#24d3ee',
    synopsis:
      'A quirkless boy inherits the strongest power in the world, and every victory makes the cost of holding it clearer.',
    epCount: 9,
    runtime: '23:40',
    schedule: { day: 7, dayLabel: 'SUN', date: 'Oct 20', time: '21:30', season: 'Fall 2024' },
  },
  {
    id: 'aria-of-the-lost-realm',
    title: 'Aria of the Lost Realm',
    native: 'Shūen no Aria',
    year: 2023,
    rating: 8.8,
    season: 'Season 1',
    kind: 'TV',
    status: 'Finished',
    genres: ['fantasy', 'adventure', 'drama'],
    art: 'elf-mage',
    accent: '#8b5cf6',
    synopsis:
      'An elf archivist walks a thousand years of ruins to find the song that ended her world, one memory at a time.',
    epCount: 11,
    runtime: '23:40',
  },
  {
    id: 'crimson-vow',
    title: 'Crimson Vow',
    native: 'Beni no Sei',
    year: 2024,
    rating: 8.5,
    season: 'Film',
    kind: 'Movie',
    status: 'Upcoming',
    genres: ['horror', 'supernatural', 'action'],
    art: 'demon-slayer',
    accent: '#c2002a',
    synopsis:
      'A blood oath binds a swordsman to the demon he swore to kill. The moon decides which of them keeps it.',
    epCount: 1,
    runtime: '1:52:10',
  },
  {
    id: 'azure-hollow',
    title: 'Azure Hollow',
    native: 'Sora no Utsuwa',
    year: 2023,
    rating: 8.1,
    season: 'OVA',
    kind: 'OVA',
    status: 'Finished',
    genres: ['supernatural', 'drama', 'mystery'],
    art: 'shadow-hunter',
    accent: '#2f7bff',
    synopsis:
      'Three students inherit a club room that remembers everyone who ever sat in it — including people who never existed.',
    epCount: 4,
    runtime: '23:40',
  },
  {
    id: 'sunset-sail',
    title: 'Sunset Sail',
    native: 'Yūgure no Shuppatsu',
    year: 2022,
    rating: 8.3,
    season: 'Film',
    kind: 'Movie',
    status: 'Finished',
    genres: ['adventure', 'slice-of-life', 'comedy'],
    art: 'golden-pirate',
    accent: '#ff7a1a',
    synopsis:
      'A borrowed boat, a wrong map, and four friends who agree on nothing except that they are not turning back.',
    epCount: 1,
    runtime: '1:44:00',
  },
  {
    id: 'neon-paradox',
    title: 'Neon Paradox',
    native: 'Neon Paradox',
    year: 2024,
    rating: 8.0,
    season: 'ONA',
    kind: 'ONA',
    status: 'Ongoing',
    genres: ['sci-fi', 'isekai', 'mystery'],
    art: 'cursed-sorcerer',
    accent: '#e93bff',
    synopsis:
      'A delivery courier keeps waking in the same city on the same night, and the city is starting to recognise her.',
    epCount: 6,
    runtime: '23:40',
    schedule: { day: 3, dayLabel: 'WED', date: 'Oct 16', time: '19:30', season: 'Spring 2024' },
  },
  {
    id: 'paper-lantern-days',
    title: 'Paper Lantern Days',
    native: 'Chōchin no Aru Hi',
    year: 2023,
    rating: 8.6,
    season: 'Season 2',
    kind: 'TV',
    status: 'Finished',
    genres: ['romance', 'slice-of-life', 'drama'],
    art: 'elf-mage',
    accent: '#ff3d8b',
    synopsis:
      'Two neighbours keep meeting at the same festival, and every year the walk home gets a little longer.',
    epCount: 12,
    runtime: '23:40',
  },
  {
    id: 'hollow-arena',
    title: 'Hollow Arena',
    native: 'Uro no Shitō',
    year: 2024,
    rating: 7.9,
    season: 'Special',
    kind: 'Special',
    status: 'Upcoming',
    genres: ['action', 'sci-fi', 'comedy'],
    art: 'iron-hero',
    accent: '#24d3ee',
    synopsis:
      'An exhibition match between rival schools turns into the only thing standing between a city and total blackout.',
    epCount: 2,
    runtime: '23:40',
    schedule: { day: 5, dayLabel: 'FRI', date: 'Oct 18', time: '20:00', season: 'Winter 2024' },
  },
];

export const ANIME: Anime[] = SEEDS.map((s) => ({
  id: s.id,
  title: s.title,
  native: s.native,
  year: s.year,
  rating: s.rating,
  season: s.season,
  kind: s.kind,
  status: s.status,
  genres: s.genres,
  poster: art(`poster-${s.art}`),
  key: art(`key-${s.art}`),
  accent: s.accent,
  synopsis: s.synopsis,
  rank: s.rank,
  schedule: s.schedule,
  altSeasons: s.altSeasons,
  episodes: makeEpisodes(s.id, `key-${s.art}`, s.epCount ?? 10, s.runtime ?? '23:40'),
  episodeCount: s.epCount ?? 10,
}));

/* Lives in its own module because the running app imports it too (hero chips). */
export { GENRES } from './genres.ts';
