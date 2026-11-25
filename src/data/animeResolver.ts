// @ts-check

export interface ResolvedAnime {
  slug: string;
  title: string;
  nativeTitle?: string;
  art: string;
  fallbackArt: string;
  banner?: string;
  rating: number;
  format: string;
  status: string;
  genres: string[];
  streamUrl: string;
  synopsis?: string;
}

export const ANIME_REGISTRY: Record<string, ResolvedAnime> = {
  'solo-leveling': {
    slug: 'solo-leveling',
    title: 'Solo Leveling Season 2: Arise from the Shadow',
    nativeTitle: '나 혼자만 레벨업',
    art: '/images/posters/poster-solo-leveling.jpg',
    fallbackArt: '/images/posters/poster-solo-leveling.jpg',
    banner: '/images/banners/banner-solo-leveling.jpg',
    rating: 8.4,
    format: 'TV Series',
    status: 'Simulcast',
    genres: ['Action', 'Fantasy', 'Supernatural'],
    streamUrl: '/anime/solo-leveling',
    synopsis: "Continuing Sung Jinwoo's ascent from the weakest E-Rank to the Monarch of Shadows, battling through high-rank Red Gates and dungeon outbreaks.",
  },
  'jujutsu-kaisen': {
    slug: 'jujutsu-kaisen',
    title: 'Jujutsu Kaisen',
    nativeTitle: '呪術廻戦',
    art: '/images/posters/poster-jujutsu-kaisen.jpg',
    fallbackArt: '/images/posters/poster-jujutsu-kaisen.jpg',
    banner: '/images/banners/banner-jujutsu-kaisen.jpg',
    rating: 8.6,
    format: 'TV Series',
    status: 'Completed',
    genres: ['Action', 'Supernatural', 'Dark Fantasy'],
    streamUrl: '/anime/jujutsu-kaisen',
    synopsis: 'Yuji Itadori enters the high-stakes Tokyo Jujutsu High after swallowing Sukuna’s cursed finger, waging war against deadly curses.',
  },
  'demon-slayer': {
    slug: 'demon-slayer',
    title: 'Demon Slayer: Kimetsu no Yaiba',
    nativeTitle: '鬼滅の刃',
    art: '/images/posters/poster-demon-slayer.jpg',
    fallbackArt: '/images/posters/poster-demon-slayer.jpg',
    banner: '/images/banners/banner-demon-slayer.jpg',
    rating: 8.5,
    format: 'TV Series',
    status: 'Movie Trilogy Upcoming',
    genres: ['Action', 'Fantasy', 'Historical'],
    streamUrl: '/anime/demon-slayer',
    synopsis: 'Tanjiro Kamado embarks on a dangerous quest with the Demon Slayer Corps to avenge his slaughtered family and restore Nezuko to human form.',
  },
  'chainsaw-man': {
    slug: 'chainsaw-man',
    title: 'Chainsaw Man',
    nativeTitle: 'チェンソーマン',
    art: '/images/posters/poster-chainsaw-man.jpg',
    fallbackArt: '/images/posters/poster-chainsaw-man.jpg',
    banner: '/images/banners/banner-chainsaw-man.jpg',
    rating: 8.3,
    format: 'TV Series',
    status: 'Reze Arc Film Upcoming',
    genres: ['Action', 'Comedy', 'Dark Fantasy'],
    streamUrl: '/anime/chainsaw-man',
    synopsis: 'Denji merges with his pet devil Pochita to become Chainsaw Man, joining the Public Safety Devil Hunters under the enigmatic Makima.',
  },
  'sousou-no-frieren': {
    slug: 'sousou-no-frieren',
    title: "Frieren: Beyond Journey's End",
    nativeTitle: '葬送のフリーレン',
    art: '/images/posters/poster-frieren.jpg',
    fallbackArt: '/images/posters/poster-frieren.jpg',
    banner: '/images/banners/banner-frieren.jpg',
    rating: 9.1,
    format: 'TV Series',
    status: 'Season 2 Confirmed',
    genres: ['Adventure', 'Drama', 'Fantasy'],
    streamUrl: '/anime/sousou-no-frieren',
    synopsis: 'Elven mage Frieren reflects on mortality and human connections as she journeys to heaven following the death of the hero Himmel.',
  },
  'one-piece': {
    slug: 'one-piece',
    title: 'One Piece (Egghead Island)',
    nativeTitle: 'ワンピース',
    art: '/images/posters/poster-one-piece.jpg',
    fallbackArt: '/images/posters/poster-one-piece.jpg',
    banner: '/images/banners/banner-one-piece.jpg',
    rating: 8.8,
    format: 'TV Series',
    status: 'Ongoing Broadcast',
    genres: ['Action', 'Adventure', 'Fantasy'],
    streamUrl: '/anime/one-piece',
    synopsis: 'Monkey D. Luffy and the Straw Hat Pirates navigate the futuristic mysteries of Egghead Island alongside Dr. Vegapunk.',
  },
  'berserk': {
    slug: 'berserk',
    title: 'Berserk',
    nativeTitle: 'ベルセルク',
    art: '/images/posters/poster-berserk.jpg',
    fallbackArt: '/images/posters/poster-berserk.jpg',
    banner: '/images/banners/banner-berserk.jpg',
    rating: 9.3,
    format: 'TV Series',
    status: 'Classic Masterpiece',
    genres: ['Dark Fantasy', 'Action', 'Psychological'],
    streamUrl: '/anime/berserk',
    synopsis: 'Guts, the Black Swordsman, wanders a brutal medieval world battling monstrous Apostles while bearing the cursed Brand of Sacrifice.',
  },
  'made-in-abyss': {
    slug: 'made-in-abyss',
    title: 'Made in Abyss',
    nativeTitle: 'メイドインアビス',
    art: '/images/posters/poster-made-in-abyss.jpg',
    fallbackArt: '/images/posters/poster-made-in-abyss.jpg',
    banner: '/images/banners/banner-made-in-abyss.jpg',
    rating: 8.8,
    format: 'TV Series',
    status: 'Completed',
    genres: ['Adventure', 'Mystery', 'Dark Fantasy'],
    streamUrl: '/anime/made-in-abyss',
    synopsis: 'An orphaned cave raider girl and a humanoid robot boy descend into an unfathomable vertical chasm known as the Abyss.',
  },
  'bleach': {
    slug: 'bleach',
    title: 'Bleach: Thousand-Year Blood War',
    nativeTitle: 'BLEACH 千年血戦篇',
    art: '/art/poster-cursed-sorcerer.jpg',
    fallbackArt: '/art/poster-cursed-sorcerer.jpg',
    banner: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/144490-v82K97n63gP3.jpg',
    rating: 8.7,
    format: 'TV Series',
    status: 'Simulcast',
    genres: ['Action', 'Supernatural', 'Shonen'],
    streamUrl: '/anime/bleach',
    synopsis: 'Ichigo Kurosaki and the Soul Reapers defend the Soul Society against the devastating invasion of Yhwach and the Quincy Wandenreich.',
  },
  'dandadan': {
    slug: 'dandadan',
    title: 'DanDaDan',
    nativeTitle: 'ダンダダン',
    art: '/art/poster-shadow-hunter.jpg',
    fallbackArt: '/art/poster-shadow-hunter.jpg',
    banner: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/171018-E0bQ92M6A9Y7.jpg',
    rating: 8.5,
    format: 'TV Series',
    status: 'Broadcast Complete',
    genres: ['Action', 'Comedy', 'Supernatural'],
    streamUrl: '/anime/dandadan',
    synopsis: 'Momo Ayase and Ken Takakura find themselves embroiled in supernatural clashes between turbo grannies, yokai spirits, and alien abductors.',
  },
  'blue-box': {
    slug: 'blue-box',
    title: 'Blue Box',
    nativeTitle: 'アオのハコ',
    art: '/art/genre-romance.jpg',
    fallbackArt: '/art/genre-romance.jpg',
    banner: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/170881-C2Q3hG5M8L8P.jpg',
    rating: 8.1,
    format: 'TV Series',
    status: 'Ongoing Broadcast',
    genres: ['Romance', 'Sports', 'Slice of Life'],
    streamUrl: '/anime/blue-box',
    synopsis: 'Taiki Inomata balances competitive badminton aspirations with his blossoming feelings for star basketball player Chinatsu Kano.',
  },
  'attack-on-titan': {
    slug: 'attack-on-titan',
    title: 'Attack on Titan',
    nativeTitle: '進撃の巨人',
    art: '/images/posters/poster-attack-on-titan.jpg',
    fallbackArt: '/images/posters/poster-attack-on-titan.jpg',
    banner: '/images/banners/banner-attack-on-titan.jpg',
    rating: 8.9,
    format: 'TV Series',
    status: 'Completed Masterpiece',
    genres: ['Action', 'Drama', 'Mystery'],
    streamUrl: '/anime/attack-on-titan',
    synopsis: 'Eren Yeager triggers the apocalyptic Rumbling as the Paradis Survey Corps and Marleyan remnants unite to prevent worldwide extinction.',
  },
  'my-hero-academia': {
    slug: 'my-hero-academia',
    title: 'My Hero Academia',
    nativeTitle: '僕のヒーローアカデミア',
    art: '/art/poster-iron-hero.jpg',
    fallbackArt: '/art/poster-iron-hero.jpg',
    banner: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/21459-DU1o4wV4A1eK.jpg',
    rating: 7.9,
    format: 'TV Series',
    status: 'Final Season 8 Coming',
    genres: ['Action', 'Super Power', 'Shonen'],
    streamUrl: '/anime/my-hero-academia',
    synopsis: 'Izuku Midoriya and Class 1-A engage in the ultimate climactic war against Tomura Shigaraki and All For One to save superhuman society.',
  },
  'spy-x-family': {
    slug: 'spy-x-family',
    title: 'Spy x Family',
    nativeTitle: 'SPY×FAMILY',
    art: '/art/poster-amber-ninja.jpg',
    fallbackArt: '/art/poster-amber-ninja.jpg',
    banner: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/140960-e6V2n9wG3l5R.jpg',
    rating: 8.4,
    format: 'TV Series',
    status: 'Season 3 Announced',
    genres: ['Action', 'Comedy', 'Slice of Life'],
    streamUrl: '/anime/spy-x-family',
    synopsis: 'Master spy Twilight adopts telepathic Anya and assassin Yor to form the eclectic Forger family while executing Operation Strix.',
  },
  'oshi-no-ko': {
    slug: 'oshi-no-ko',
    title: 'Oshi no Ko',
    nativeTitle: '【推しの子】',
    art: '/art/genres-purple.jpg',
    fallbackArt: '/art/genres-purple.jpg',
    banner: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/150672-pW9G7A5bX8l2.jpg',
    rating: 8.6,
    format: 'TV Series',
    status: 'Season 3 In Production',
    genres: ['Drama', 'Mystery', 'Supernatural'],
    streamUrl: '/anime/oshi-no-ko',
    synopsis: 'Aqua and Ruby Hoshino navigate the dark underbelly of the Japanese entertainment industry to uncover the truth behind Ai Hoshino’s murder.',
  },
  'black-clover': {
    slug: 'black-clover',
    title: 'Black Clover',
    nativeTitle: 'ブラッククローバー',
    art: '/art/poster-clover-knight.jpg',
    fallbackArt: '/art/poster-clover-knight.jpg',
    rating: 8.2,
    format: 'TV Series',
    status: 'Sequel In Production',
    genres: ['Action', 'Comedy', 'Fantasy'],
    streamUrl: '/anime/black-clover',
    synopsis: 'Asta, born without magic in a magic-driven world, receives a five-leaf grimoire imbued with Anti-Magic to become the Wizard King.',
  },
};

/**
 * Resolves full anime metadata & poster picture by slug or title string
 * @param {string} slugOrTitle
 * @returns {ResolvedAnime | null}
 */
export function resolveAnime(slugOrTitle: string): ResolvedAnime | null {
  if (!slugOrTitle) return null;
  const normalized = slugOrTitle.toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');

  // Direct slug match
  if (ANIME_REGISTRY[normalized]) {
    return ANIME_REGISTRY[normalized];
  }

  // Partial slug or title key search
  for (const [key, item] of Object.entries(ANIME_REGISTRY)) {
    if (
      normalized.includes(key) ||
      key.includes(normalized) ||
      item.title.toLowerCase().includes(slugOrTitle.toLowerCase()) ||
      slugOrTitle.toLowerCase().includes(key)
    ) {
      return item;
    }
  }

  return null;
}

/**
 * Scans article markdown/text and extracts all referenced anime entities
 * @param {string} text
 * @returns {ResolvedAnime[]}
 */
export function findAnimeInText(text: string): ResolvedAnime[] {
  if (!text) return [];
  const matches: ResolvedAnime[] = [];
  const seen = new Set<string>();

  for (const [key, anime] of Object.entries(ANIME_REGISTRY)) {
    // Check key, title, or aliases with word boundaries
    const escaped = anime.title.split(':')[0].trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(^|\\s|[.,!?'":;()\\/\\-])${escaped}($|\\s|[.,!?'":;()\\/\\-])`, 'i');
    const keyRegex = new RegExp(`(^|\\s|[.,!?'":;()\\/\\-])${key.replace(/-/g, ' ')}($|\\s|[.,!?'":;()\\/\\-])`, 'i');

    if ((regex.test(text) || keyRegex.test(text)) && !seen.has(anime.slug)) {
      seen.add(anime.slug);
      matches.push(anime);
    }
  }

  return matches;
}
