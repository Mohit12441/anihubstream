/* The genre shelf is a fixed part of the design, not a function of the catalogue:
   the same twelve tiles seed the genre rows in D1 (tools/sync-catalogue.mjs and
   tools/gen-seed.mjs) and render the hero chips. The chips read this module so
   they exist at first paint instead of popping in when /api/genres answers —
   that pop-in grew the hero by one chip row and shifted the whole page.
   Import specifiers keep the .ts extension so Node's type stripping can follow
   the chain from the sync tools through src/data/anime.ts into this file. */

import { artUrl } from './model.ts';
import type { Genre } from './model.ts';

const art = (name: string) => artUrl(`/art/${name}.jpg`);

export const GENRES: Genre[] = [
  { id: 'action', label: 'Action', tagline: 'Explosive Battles', art: art('key-demon-slayer'), accent: '#ff1f4a' },
  { id: 'adventure', label: 'Adventure', tagline: 'Epic Journeys', art: art('key-golden-pirate'), accent: '#ff9420' },
  { id: 'fantasy', label: 'Fantasy', tagline: 'Magical Worlds', art: art('key-elf-mage'), accent: '#a24bff' },
  { id: 'isekai', label: 'Isekai', tagline: 'Another Realms', art: art('genres-purple'), accent: '#3b82ff' },
  { id: 'romance', label: 'Romance', tagline: 'Heartfelt Stories', art: art('genre-romance'), accent: '#ff3d8b' },
  { id: 'slice-of-life', label: 'Slice of Life', tagline: 'Everyday Moments', art: art('discover-sunset'), accent: '#ffc247' },
  { id: 'horror', label: 'Horror', tagline: 'Dark Thrills', art: art('hero-demon'), accent: '#c2002a' },
  { id: 'comedy', label: 'Comedy', tagline: 'Endless Laughs', art: art('key-amber-ninja'), accent: '#ffd54a' },
  { id: 'supernatural', label: 'Supernatural', tagline: 'Beyond Reason', art: art('key-cursed-sorcerer'), accent: '#8b5cf6' },
  { id: 'sci-fi', label: 'Sci-Fi', tagline: 'Future Tensions', art: art('key-iron-hero'), accent: '#24d3ee' },
  { id: 'drama', label: 'Drama', tagline: 'Heavy Hearts', art: art('watch-scene'), accent: '#2f7bff' },
  { id: 'mystery', label: 'Mystery', tagline: 'Unfinished Cases', art: art('key-shadow-hunter'), accent: '#2ee6a8' },
];
