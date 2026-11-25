// @ts-check

export interface ResolvedAnime {
  slug: string;
  title: string;
  nativeTitle?: string;
  art: string;
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
    art: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx176496-9BDMjAZGEbq4.png',
    banner: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/176496-e2mR7zOtxTjH.jpg',
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
    art: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx113415-bbBWj4pEFScM.jpg',
    banner: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/113415-jQGo78V04PZc.jpg',
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
    art: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx101922-PEn1CTyeRepq.png',
    banner: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/101922-eWJ107qL6tFw.jpg',
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
    art: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx127230-FloCoGoZOAOH.png',
    banner: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/127230-24B3ZkX2fV3C.jpg',
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
    art: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx154587-n2bF3NnELNsq.jpg',
    banner: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/154587-FwVvQd5v0Dk6.jpg',
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
    art: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx21-YCDoj1EkASI2.jpg',
    banner: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/21-eOqH0YwV97A1.jpg',
    rating: 8.8,
    format: 'TV Series',
    status: 'Ongoing Broadcast',
    genres: ['Action', 'Adventure', 'Fantasy'],
    streamUrl: '/anime/one-piece',
    synopsis: 'Monkey D. Luffy and the Straw Hat Pirates navigate the futuristic mysteries of Egghead Island alongside Dr. Vegapunk.',
  },
  'bleach': {
    slug: 'bleach',
    title: 'Bleach: Thousand-Year Blood War',
    nativeTitle: 'BLEACH 千年血戦篇',
    art: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/b269-vG04i169kCqM.png',
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
    art: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx171018-8mN479U3hF6C.jpg',
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
    art: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx170881-2wWj1P3V1Rrh.jpg',
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
    title: 'Attack on Titan (The Final Season)',
    nativeTitle: '進撃の巨人',
    art: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx16498-C6FPmWm59CyP.jpg',
    banner: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/16498-8jpFCOcDmneX.jpg',
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
    art: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx21459-oBMb98nHqjHG.jpg',
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
    art: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx140960-vN3RJZXxDdqu.jpg',
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
    art: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx150672-3yq9bT2rUq39.jpg',
    banner: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/150672-pW9G7A5bX8l2.jpg',
    rating: 8.6,
    format: 'TV Series',
    status: 'Season 3 In Production',
    genres: ['Drama', 'Mystery', 'Supernatural'],
    streamUrl: '/anime/oshi-no-ko',
    synopsis: 'Aqua and Ruby Hoshino navigate the dark underbelly of the Japanese entertainment industry to uncover the truth behind Ai Hoshino’s murder.',
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
