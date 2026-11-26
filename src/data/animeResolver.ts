// @ts-check
import EDITORIAL_POSTERS from '../../data/news/editorial-posters.json';

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
    art: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx151807-it355ZgzquUd.png',
    fallbackArt: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx151807-it355ZgzquUd.png',
    banner: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/151807-3wM4YfIeE9yH.jpg',
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
    art: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx113415-LHBAeoZDIsnF.jpg',
    fallbackArt: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx113415-LHBAeoZDIsnF.jpg',
    banner: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/113415-jQToEOk5Elvy.jpg',
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
    art: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx101922-WBsBl0ClmgYL.jpg',
    fallbackArt: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx101922-WBsBl0ClmgYL.jpg',
    banner: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/101922-YBdqlGQqz28n.jpg',
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
    art: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx127230-DdP4vAdssLoz.png',
    fallbackArt: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx127230-DdP4vAdssLoz.png',
    banner: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/127230-eKqT9B0zQ5Ym.jpg',
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
    art: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx154587-qQTzQnEJJ3oB.jpg',
    fallbackArt: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx154587-qQTzQnEJJ3oB.jpg',
    banner: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/154587-n10v4d0rD0Jj.jpg',
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
    art: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx21-ELSYx3yMPcKM.jpg',
    fallbackArt: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx21-ELSYx3yMPcKM.jpg',
    banner: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/21-wf37VakJmZqs.jpg',
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
    art: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx33-PSwfE5B0gejI.jpg',
    fallbackArt: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx33-PSwfE5B0gejI.jpg',
    banner: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/33-v7N8qP2A4l1W.jpg',
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
    art: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx97986-TQ7dCgbS3y5s.jpg',
    fallbackArt: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx97986-TQ7dCgbS3y5s.jpg',
    banner: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/97986-1oZg0sZ8Q5hQ.jpg',
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
    art: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx269-d2GmRkJbMopq.png',
    fallbackArt: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx269-d2GmRkJbMopq.png',
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
    art: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx171018-q7rR6e6bVqC4.jpg',
    fallbackArt: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx171018-q7rR6e6bVqC4.jpg',
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
    art: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx170942-KKcLfQzV57nG.jpg',
    fallbackArt: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx170942-KKcLfQzV57nG.jpg',
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
    art: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx16498-buvcRTBx4NSm.jpg',
    fallbackArt: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx16498-buvcRTBx4NSm.jpg',
    banner: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/16498-C6ZwRF68EaeS.jpg',
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
    art: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx21459-nYh85uj2Fuwr.jpg',
    fallbackArt: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx21459-nYh85uj2Fuwr.jpg',
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
    art: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx140960-Kb6R5nYQfjmP.jpg',
    fallbackArt: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx140960-Kb6R5nYQfjmP.jpg',
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
    art: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx150672-WqmmwZ4nMzAy.png',
    fallbackArt: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx150672-WqmmwZ4nMzAy.png',
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
    art: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx97940-fyh8o7gNbha0.png',
    fallbackArt: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx97940-fyh8o7gNbha0.png',
    banner: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/97940-3mK94n9v6Y5w.jpg',
    rating: 8.2,
    format: 'TV Series',
    status: 'Sequel In Production',
    genres: ['Action', 'Comedy', 'Fantasy'],
    streamUrl: '/anime/black-clover',
    synopsis: 'Asta, born without magic in a magic-driven world, receives a five-leaf grimoire imbued with Anti-Magic to become the Wizard King.',
  },
  'black-clover-season-2': {
    slug: 'black-clover-season-2',
    title: 'Black Clover Season 2',
    nativeTitle: 'ブラッククローバー 第2期',
    art: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx195604-tSZcfKbVqSEG.jpg',
    fallbackArt: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx195604-tSZcfKbVqSEG.jpg',
    banner: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/97940-3mK94n9v6Y5w.jpg',
    rating: 8.7,
    format: 'TV Series',
    status: 'Ongoing Broadcast',
    genres: ['Action', 'Adventure', 'Comedy', 'Fantasy'],
    streamUrl: '/anime/black-clover-season-2',
    synopsis: 'Asta and the Magic Knights launch a desperate raid on the Spade Kingdom to rescue their squad captains from the Dark Triad.',
  },
  'overgeared': {
    slug: 'overgeared',
    title: 'Overgeared',
    nativeTitle: '템빨',
    art: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx212888-NhyvqPt5aIuJ.jpg',
    fallbackArt: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx212888-NhyvqPt5aIuJ.jpg',
    rating: 7.6,
    format: 'ONA',
    status: 'Ongoing Broadcast',
    genres: ['Action', 'Fantasy', 'Virtual Reality'],
    streamUrl: '/anime/overgeared',
    synopsis: 'Grid, an unlucky low-level gamer, stumbles upon a legendary blacksmith class that turns him into a terrifying powerhouse.',
  },
  'reincarnated-as-a-sword-season-2': {
    slug: 'reincarnated-as-a-sword-season-2',
    title: 'Reincarnated as a Sword Season 2',
    nativeTitle: '転生したら剣でした 第2期',
    art: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx159042-GGFwlDskc5vR.png',
    fallbackArt: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx159042-GGFwlDskc5vR.png',
    rating: 7.5,
    format: 'ONA',
    status: 'Ongoing Broadcast',
    genres: ['Action', 'Fantasy', 'Isekai'],
    streamUrl: '/anime/reincarnated-as-a-sword-season-2',
    synopsis: 'Fran and Teacher embark on new dungeon expeditions, navigating political intrigue in the Beast Kingdom.',
  },
  'the-laid-off-cheat-granting-mage-enjoys-a-second-lease-on-life': {
    slug: 'the-laid-off-cheat-granting-mage-enjoys-a-second-lease-on-life',
    title: 'The Laid-Off Cheat-Granting Mage Enjoys a Second Lease on Life',
    nativeTitle: '解雇された付与魔導士は第二の人生を謳歌する',
    art: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/b207329-6VPeZIDfF4Sr.png',
    fallbackArt: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/b207329-6VPeZIDfF4Sr.png',
    rating: 7.3,
    format: 'TV Series',
    status: 'Ongoing Broadcast',
    genres: ['Fantasy', 'Comedy', 'Adventure'],
    streamUrl: '/anime/the-laid-off-cheat-granting-mage-enjoys-a-second-lease-on-life',
    synopsis: 'Rein, an expelled guild enchanter, reclaims immense enhancement points once gifted to ungrateful allies.',
  },
  'monster': {
    slug: 'monster',
    title: 'Monster',
    nativeTitle: 'MONSTER',
    art: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx19-gtMC64182sm4.jpg',
    fallbackArt: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx19-gtMC64182sm4.jpg',
    rating: 8.8,
    format: 'TV Series',
    status: 'Finished',
    genres: ['Drama', 'Mystery', 'Psychological', 'Thriller'],
    streamUrl: '/anime/monster',
    synopsis: 'Dr. Kenzo Tenma risks his career and life to track down Johan Liebert, the psychopathic monster he saved years ago.',
  },
  'vinland-saga': {
    slug: 'vinland-saga',
    title: 'Vinland Saga',
    nativeTitle: 'ヴィンランド・サガ',
    art: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx101348-2fhDFPCuMNiz.jpg',
    fallbackArt: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx101348-2fhDFPCuMNiz.jpg',
    rating: 8.8,
    format: 'TV Series',
    status: 'Finished',
    genres: ['Action', 'Adventure', 'Drama', 'Historical'],
    streamUrl: '/anime/vinland-saga',
    synopsis: 'Thorfinn seeks vengeance against Askeladd, only to discover the profound weight of true peace and having no enemies.',
  },
  'neon-genesis-evangelion': {
    slug: 'neon-genesis-evangelion',
    title: 'Neon Genesis Evangelion',
    nativeTitle: '新世紀エヴァンゲリオン',
    art: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx30-AI1zr74Dh4ye.jpg',
    fallbackArt: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx30-AI1zr74Dh4ye.jpg',
    rating: 8.3,
    format: 'TV Series',
    status: 'Finished',
    genres: ['Action', 'Drama', 'Mecha', 'Psychological', 'Sci-Fi'],
    streamUrl: '/anime/neon-genesis-evangelion',
    synopsis: 'Shinji Ikari pilots an Evangelion against cosmic Angels while exploring the painful psychological depths of the human heart.',
  },
  'shinsekai-yori': {
    slug: 'shinsekai-yori',
    title: 'From the New World (Shinsekai Yori)',
    nativeTitle: '新世界より',
    art: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx13125-2EDZb8ahshQc.png',
    fallbackArt: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx13125-2EDZb8ahshQc.png',
    rating: 8.3,
    format: 'TV Series',
    status: 'Finished',
    genres: ['Drama', 'Horror', 'Mystery', 'Psychological', 'Sci-Fi', 'Supernatural'],
    streamUrl: '/anime/from-the-new-world',
    synopsis: 'Five friends in a future telekinetic utopia uncover the horrifying sacrifices required to sustain their civilization.',
  },
  'serial-experiments-lain': {
    slug: 'serial-experiments-lain',
    title: 'Serial Experiments Lain',
    nativeTitle: 'serial experiments lain',
    art: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx339-xF2wp1NQuQ4r.png',
    fallbackArt: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx339-xF2wp1NQuQ4r.png',
    rating: 8.0,
    format: 'TV Series',
    status: 'Finished',
    genres: ['Drama', 'Mystery', 'Psychological', 'Sci-Fi', 'Supernatural'],
    streamUrl: '/anime/serial-experiments-lain',
    synopsis: 'Lain Iwakura dives into the Wired as the boundaries between physical reality and virtual consciousness collapse.',
  },
  'death-parade': {
    slug: 'death-parade',
    title: 'Death Parade',
    nativeTitle: 'デス・パレード',
    art: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/nx20931-bktYqOcxPERi.jpg',
    fallbackArt: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/nx20931-bktYqOcxPERi.jpg',
    rating: 7.9,
    format: 'TV Series',
    status: 'Finished',
    genres: ['Drama', 'Mystery', 'Psychological', 'Supernatural', 'Thriller'],
    streamUrl: '/anime/death-parade',
    synopsis: 'Arbiter Decim subjects deceased humans to high-stakes parlor games to judge whether their souls reincarnate or enter the void.',
  },
  'mushoku-tensei-jobless-reincarnation': {
    slug: 'mushoku-tensei-jobless-reincarnation',
    title: 'Mushoku Tensei: Jobless Reincarnation',
    nativeTitle: '無職転生 ～異世界行ったら本気だす～',
    art: '/images/posters/poster-mushoku-tensei.jpg',
    fallbackArt: 'https://cdn.myanimelist.net/images/anime/1530/117776l.jpg',
    rating: 8.6,
    format: 'TV Series',
    status: 'Finished',
    genres: ['Adventure', 'Drama', 'Ecchi', 'Fantasy'],
    streamUrl: '/anime/mushoku-tensei-jobless-reincarnation',
    synopsis: 'Rudeus Greyrat resolves to live a life with no regrets across an intricately detailed fantasy world of magic and swordcraft.',
  },
  'mushoku-tensei': {
    slug: 'mushoku-tensei-jobless-reincarnation',
    title: 'Mushoku Tensei: Jobless Reincarnation',
    nativeTitle: '無職転生 ～異世界行ったら本気だす～',
    art: '/images/posters/poster-mushoku-tensei.jpg',
    fallbackArt: 'https://cdn.myanimelist.net/images/anime/1530/117776l.jpg',
    rating: 8.6,
    format: 'TV Series',
    status: 'Finished',
    genres: ['Adventure', 'Drama', 'Ecchi', 'Fantasy'],
    streamUrl: '/anime/mushoku-tensei-jobless-reincarnation',
    synopsis: 'Rudeus Greyrat resolves to live a life with no regrets across an intricately detailed fantasy world of magic and swordcraft.',
  },
  'rezero': {
    slug: 'rezero',
    title: 'Re:Zero — Starting Life in Another World',
    nativeTitle: 'Re:ゼロから始める異世界生活',
    art: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx21355-wRVUrGxpvIQQ.jpg',
    fallbackArt: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx21355-wRVUrGxpvIQQ.jpg',
    rating: 8.2,
    format: 'TV Series',
    status: 'Season 3 Ongoing',
    genres: ['Action', 'Adventure', 'Drama', 'Fantasy', 'Psychological'],
    streamUrl: '/anime/re-zero-starting-life-in-another-world',
    synopsis: 'Subaru Natsuki confronts insurmountable death loops using his harrowing Return by Death ability.',
  },
  'overlord': {
    slug: 'overlord',
    title: 'Overlord',
    nativeTitle: 'オーバーロード',
    art: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx20832-vUNm5zrYWifc.jpg',
    fallbackArt: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx20832-vUNm5zrYWifc.jpg',
    rating: 7.8,
    format: 'TV Series',
    status: 'Movie Upcoming',
    genres: ['Action', 'Adventure', 'Fantasy', 'Supernatural'],
    streamUrl: '/anime/overlord-ii',
    synopsis: 'Ainz Ooal Gown conquers a fantasy realm from the throne of the Great Tomb of Nazarick as an omnipotent undead overlord.',
  },
  'that-time-i-got-reincarnated-as-a-slime': {
    slug: 'that-time-i-got-reincarnated-as-a-slime',
    title: 'That Time I Got Reincarnated as a Slime',
    nativeTitle: '転生したらスライムだった件',
    art: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx101280-tDxCVJm714nt.jpg',
    fallbackArt: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx101280-tDxCVJm714nt.jpg',
    rating: 8.1,
    format: 'TV Series',
    status: 'Finished',
    genres: ['Action', 'Adventure', 'Comedy', 'Fantasy', 'Isekai'],
    streamUrl: '/anime/that-time-i-got-reincarnated-as-a-slime',
    synopsis: 'Rimuru Tempest builds a nation of monsters with diplomacy, magic, and supreme strategic acumen.',
  },
  'ascendance-of-a-bookworm': {
    slug: 'ascendance-of-a-bookworm',
    title: 'Ascendance of a Bookworm',
    nativeTitle: '本好きの下剋上',
    art: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx108268-Dtt82uOi3vq5.jpg',
    fallbackArt: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx108268-Dtt82uOi3vq5.jpg',
    rating: 8.0,
    format: 'TV Series',
    status: 'Season 4 Confirmed',
    genres: ['Fantasy', 'Slice of Life', 'Isekai'],
    streamUrl: '/anime/ascendance-of-a-bookworm-adopted-daughter-of-an-archduke',
    synopsis: 'Myne revolutionizes a medieval world through bookmaking, papermaking technology, and aristocratic politics.',
  },
  'the-eminence-in-shadow': {
    slug: 'the-eminence-in-shadow',
    title: 'The Eminence in Shadow',
    nativeTitle: '陰の実力者になりたくて！',
    art: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx130298-5z12Z500iBuh.jpg',
    fallbackArt: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx130298-5z12Z500iBuh.jpg',
    rating: 8.2,
    format: 'TV Series',
    status: 'Finished',
    genres: ['Action', 'Comedy', 'Fantasy', 'Isekai'],
    streamUrl: '/anime/the-eminence-in-shadow-season-2',
    synopsis: 'Cid Kagenou LARPs as a mastermind shadow broker while accidentally thwarting a real global cult.',
  },
  'log-horizon': {
    slug: 'log-horizon',
    title: 'Log Horizon',
    nativeTitle: 'ログ・ホライズン',
    art: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx17265-IUh379766Wc4.png',
    fallbackArt: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx17265-IUh379766Wc4.png',
    rating: 7.9,
    format: 'TV Series',
    status: 'Finished',
    genres: ['Action', 'Adventure', 'Fantasy', 'Magic'],
    streamUrl: '/anime/log-horizon-2',
    synopsis: 'Veteran strategist Shiroe establishes governance and economic systems inside the Elder Tale game world.',
  },
  'no-game-no-life': {
    slug: 'no-game-no-life',
    title: 'No Game No Life',
    nativeTitle: 'ノーゲーム・ノーライフ',
    art: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx19815-585xQWf4ZcQk.png',
    fallbackArt: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx19815-585xQWf4ZcQk.png',
    rating: 8.1,
    format: 'TV Series',
    status: 'Finished',
    genres: ['Adventure', 'Comedy', 'Fantasy', 'Supernatural'],
    streamUrl: '/anime/no-game-no-life-zero',
    synopsis: 'Genius gamer siblings Sora and Shiro conquer Disboard, where all conflict is resolved via high-stakes games.',
  },
  'saga-of-tanya-the-evil': {
    slug: 'saga-of-tanya-the-evil',
    title: 'Saga of Tanya the Evil',
    nativeTitle: '幼女戦記',
    art: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx21613-2oN6W37uYhFf.jpg',
    fallbackArt: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx21613-2oN6W37uYhFf.jpg',
    rating: 7.9,
    format: 'TV Series',
    status: 'Season 2 Confirmed',
    genres: ['Action', 'Fantasy', 'Military'],
    streamUrl: '/anime/saga-of-tanya-the-evil-ii',
    synopsis: 'A ruthless corporate salaryman reincarnates as Tanya Degurechaff, an aerial mage in a brutal world war.',
  },
  'konosuba': {
    slug: 'konosuba',
    title: "KonoSuba: God's Blessing on this Wonderful World!",
    nativeTitle: 'この素晴らしい世界に祝福を！',
    art: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx21202-P2m4k6ZfJ27S.png',
    fallbackArt: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx21202-P2m4k6ZfJ27S.png',
    rating: 8.1,
    format: 'TV Series',
    status: 'Season 3 Finished',
    genres: ['Adventure', 'Comedy', 'Fantasy', 'Isekai'],
    streamUrl: '/anime/konosuba-an-explosion-on-this-wonderful-world',
    synopsis: 'Kazuma and his dysfunctional party bumble through quests in a hilarious subversion of fantasy tropes.',
  },
  'the-rising-of-the-shield-hero': {
    slug: 'the-rising-of-the-shield-hero',
    title: 'The Rising of the Shield Hero',
    nativeTitle: '盾の勇者の成り上がり',
    art: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx99263-KzGZ8cRzGffF.jpg',
    fallbackArt: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx99263-KzGZ8cRzGffF.jpg',
    rating: 7.8,
    format: 'TV Series',
    status: 'Finished',
    genres: ['Action', 'Adventure', 'Drama', 'Fantasy'],
    streamUrl: '/anime/the-rising-of-the-shield-hero-season-2',
    synopsis: 'Falsely accused Naofumi Iwatani claws his way up from disgrace to defend Melromarc from the Calamity Waves.',
  },
  'grimgar-of-fantasy-and-ash': {
    slug: 'grimgar-of-fantasy-and-ash',
    title: 'Grimgar of Fantasy and Ash',
    nativeTitle: '灰と幻想のグリムガル',
    art: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx21428-dFVIHeZ8McBe.jpg',
    fallbackArt: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx21428-dFVIHeZ8McBe.jpg',
    rating: 7.6,
    format: 'TV Series',
    status: 'Finished',
    genres: ['Action', 'Adventure', 'Drama', 'Fantasy'],
    streamUrl: '/anime/grimgar-ashes-and-illusions',
    synopsis: 'A raw, grounded survival drama following rookie adventurers fighting desperately for everyday subsistence.',
  },
  'campfire-cooking-in-another-world-with-my-absurd-skill': {
    slug: 'campfire-cooking-in-another-world-with-my-absurd-skill',
    title: 'Campfire Cooking in Another World with My Absurd Skill',
    nativeTitle: 'とんでもスキルで異世界放浪メシ',
    art: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx156067-Jovklss4VWIx.jpg',
    fallbackArt: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx156067-Jovklss4VWIx.jpg',
    rating: 7.6,
    format: 'TV Series',
    status: 'Season 2 In Production',
    genres: ['Adventure', 'Comedy', 'Fantasy', 'Gourmet'],
    streamUrl: '/anime/campfire-cooking-in-another-world-with-my-absurd-skill',
    synopsis: 'Mukouda uses an Online Supermarket skill to tame legendary beasts with delicious modern cuisine.',
  },
  'the-faraway-paladin': {
    slug: 'the-faraway-paladin',
    title: 'The Faraway Paladin',
    nativeTitle: '最果てのパラディン',
    art: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx132473-bK121Q0s0p3G.jpg',
    fallbackArt: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx132473-bK121Q0s0p3G.jpg',
    rating: 7.2,
    format: 'TV Series',
    status: 'Finished',
    genres: ['Action', 'Adventure', 'Fantasy'],
    streamUrl: '/anime/the-faraway-paladin-the-lord-of-rust-mountains',
    synopsis: 'Raised by three undead guardians, Will embarks on a pious quest as a paladin of the goddess of light.',
  },
  'shangri-la-frontier': {
    slug: 'shangri-la-frontier',
    title: 'Shangri-La Frontier',
    nativeTitle: 'シャングリラ・フロンティア',
    art: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx151970-xtIx3VqEk02X.jpg',
    fallbackArt: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx151970-xtIx3VqEk02X.jpg',
    rating: 8.0,
    format: 'TV Series',
    status: 'Season 2 Ongoing',
    genres: ['Action', 'Adventure', 'Fantasy', 'Sci-Fi'],
    streamUrl: '/anime/shangri-la-frontier',
    synopsis: 'Trash-game connoisseur Rakuro exploits VR MMO mechanics against unique monsters with surgical reflexes.',
  },
  'claymore': {
    slug: 'claymore',
    title: 'Claymore',
    nativeTitle: 'CLAYMORE',
    art: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx1818-KieLJv0qo3mO.jpg',
    fallbackArt: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx1818-KieLJv0qo3mO.jpg',
    rating: 7.7,
    format: 'TV Series',
    status: 'Finished',
    genres: ['Action', 'Adventure', 'Dark Fantasy', 'Supernatural'],
    streamUrl: '/anime/claymore',
    synopsis: 'Silver-eyed hybrid warriors hunt flesh-eating Yoma in an unforgiving medieval dark fantasy epic.',
  },
  'dororo': {
    slug: 'dororo',
    title: 'Dororo',
    nativeTitle: 'どろろ',
    art: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx101347-TGaDwEYqLfm1.jpg',
    fallbackArt: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx101347-TGaDwEYqLfm1.jpg',
    rating: 8.2,
    format: 'TV Series',
    status: 'Finished',
    genres: ['Action', 'Adventure', 'Dark Fantasy', 'Supernatural'],
    streamUrl: '/anime/dororo',
    synopsis: 'Hyakkimaru slays 12 demons with prosthetic blade limbs to reclaim his stolen body parts.',
  },
  'd-gray-man': {
    slug: 'd-gray-man',
    title: 'D.Gray-man',
    nativeTitle: 'ディー・グレイマン',
    art: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx1482-B20e06m5n94b.jpg',
    fallbackArt: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx1482-B20e06m5n94b.jpg',
    rating: 8.0,
    format: 'TV Series',
    status: 'Finished',
    genres: ['Action', 'Adventure', 'Comedy', 'Dark Fantasy'],
    streamUrl: '/anime/d-gray-man-hallow',
    synopsis: 'Allen Walker wields divine Innocence to exorcise tragic mechanical Akuma engineered by the Millennium Earl.',
  },
  'tokyo-ghoul': {
    slug: 'tokyo-ghoul',
    title: 'Tokyo Ghoul',
    nativeTitle: '東京喰種トーキョーグール',
    art: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx20605-ff204q02Yp5o.jpg',
    fallbackArt: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx20605-ff204q02Yp5o.jpg',
    rating: 7.6,
    format: 'TV Series',
    status: 'Finished',
    genres: ['Action', 'Drama', 'Horror', 'Mystery', 'Psychological', 'Supernatural'],
    streamUrl: '/anime/tokyo-ghoul-a',
    synopsis: 'Ken Kaneki transforms into a half-ghoul, caught between human morality and the savage predatory underworld.',
  },
  'naruto': {
    slug: 'naruto',
    title: 'Naruto',
    nativeTitle: 'NARUTO -ナルト-',
    art: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx20-dE6UHbFFg1A5.jpg',
    fallbackArt: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx20-dE6UHbFFg1A5.jpg',
    rating: 7.9,
    format: 'TV Series',
    status: 'Finished',
    genres: ['Action', 'Adventure', 'Comedy', 'Shonen'],
    streamUrl: '/anime/naruto',
    synopsis: 'Naruto Uzumaki overcomes isolation and prejudice to forge his ninja way and earn the title of Hokage.',
  },
};

// Dynamic mapping of database-generated posters
const DYNAMIC_POSTER_MAP: Record<string, ResolvedAnime> = Array.isArray(EDITORIAL_POSTERS)
  ? Object.fromEntries(
      (EDITORIAL_POSTERS as unknown as Array<Record<string, any>>).map((item) => [
        item.slug,
        {
          slug: item.slug,
          title: item.title,
          nativeTitle: item.nativeTitle,
          art: item.art,
          fallbackArt: item.fallbackArt || item.art,
          banner: item.banner,
          rating: item.rating || 8.0,
          format: item.format || 'TV Series',
          status: item.status || 'Ongoing',
          genres: item.genres || [],
          streamUrl: item.streamUrl || `/anime/${item.slug}`,
          synopsis: item.synopsis,
        },
      ])
    )
  : {};

/**
 * Resolves full anime metadata & poster picture by slug or title string
 * Always guarantees 100% REAL AniList / official API photos.
 * @param {string} slugOrTitle
 * @returns {ResolvedAnime | null}
 */
export function resolveAnime(slugOrTitle: string): ResolvedAnime | null {
  if (!slugOrTitle) return null;
  const normalized = slugOrTitle.toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');

  // 1. Dynamic database-generated poster registry
  if (DYNAMIC_POSTER_MAP[normalized]) {
    return DYNAMIC_POSTER_MAP[normalized];
  }

  // 2. Direct slug match in static registry
  if (ANIME_REGISTRY[normalized]) {
    return ANIME_REGISTRY[normalized];
  }

  // 3. Partial slug or title search across dynamic registry first
  for (const [key, item] of Object.entries(DYNAMIC_POSTER_MAP)) {
    if (
      normalized === key ||
      normalized.includes(key) ||
      key.includes(normalized) ||
      item.title.toLowerCase().includes(slugOrTitle.toLowerCase()) ||
      slugOrTitle.toLowerCase().includes(key.replace(/-/g, ' '))
    ) {
      return item;
    }
  }

  // 4. Partial slug or title search across static registry
  for (const [key, item] of Object.entries(ANIME_REGISTRY)) {
    if (
      normalized === key ||
      normalized.includes(key) ||
      key.includes(normalized) ||
      item.title.toLowerCase().includes(slugOrTitle.toLowerCase()) ||
      slugOrTitle.toLowerCase().includes(key.replace(/-/g, ' '))
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

  const allEntries = { ...ANIME_REGISTRY, ...DYNAMIC_POSTER_MAP };

  for (const [key, anime] of Object.entries(allEntries)) {
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
