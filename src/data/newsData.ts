import FEED_ITEMS from '../../data/news/feed.json';
import EDITORIAL_GUIDES from '../../data/news/editorial.json';

export interface NewsArticleItem {
  slug: string;
  title: string;
  altTitles?: string[];
  badge?: string;
  excerpt: string;
  category: 'Seasonal Guide' | 'Rankings' | 'Analysis' | 'News' | 'Anime News' | 'Anime Franchise Update';
  author: string;
  authorRole: string;
  date: string;
  readTime: string;
  coverImage: string;
  tags: string[];
  targetKeywords?: string[];
  relatedAnimeSlugs: string[];
  content: string; // Structured Markdown / HTML
  social?: {
    reddit?: { title: string; markdown: string };
    twitter?: { hook: string; tags: string[] };
  };
}

const FALLBACK_EDITORIAL_ARTICLES: NewsArticleItem[] = [
  {
    slug: 'spring-2026-anime-season-guide',
    title: 'Spring 2026 Anime Season Guide: Most Anticipated Releases & Air Dates',
    excerpt: 'The definitive broadcast preview for Spring 2026 — analyzing returning franchise powerhouses, studio production teams, premiere dates, and streaming platforms.',
    category: 'Seasonal Guide',
    author: 'AniHub Editorial Team',
    authorRole: 'Senior Anime Curator',
    date: '2026-03-20',
    readTime: '10 min read',
    coverImage: '/images/banners/banner-spring-2026.jpg',
    tags: ['Spring 2026', 'Anime Schedule', 'Solo Leveling', 'Jujutsu Kaisen', 'Demon Slayer', 'One Piece'],
    relatedAnimeSlugs: ['solo-leveling', 'jujutsu-kaisen', 'demon-slayer', 'one-piece'],
    content: `
The Spring 2026 anime broadcast lineup is shaping up to be one of the most competitive seasonal runs in modern broadcast history. Anchored by the return of global flagship battle shonen, acclaimed psychological adaptations, and high-budget movie trilogy theatrical premieres, anime fans have an extraordinary roster of weekly releases.

Industry production trends this season showcase an aggressive pivot back to fluid 2D key animation, synchronous worldwide simulcasts, and multi-language dub launches within days of Japanese television airtimes.

### Most Anticipated Spring 2026 Premieres

1. **Solo Leveling Season 2: Arise from the Shadow**: Produced by A-1 Pictures under director Shunsuke Nakashige with music by Hiroyuki Sawano, Jinwoo's meteoric journey enters the high-stakes Red Gate and Jeju Island raid territory. Taito Ban reprises his role as Sung Jinwoo, delivering raw vocal intensity as Jinwoo commands his expanding Shadow Army.

2. **Demon Slayer: Kimetsu no Yaiba (Infinity Castle Trilogy)**: Ufotable and director Haruo Sotozaki transition the climactic final arc of Koyoharu Gotouge's manga to the theatrical screen. Featuring groundbreaking 3D dynamic architectural camera movements through the shifting Infinity Castle, Tanjiro and the Hashira confront the Upper Rank demons in life-or-death duels.

3. **Jujutsu Kaisen (Culling Game Arc Preview)**: Studio MAPPA gears up for the deadly battle royale engineered by Kenjaku. Following the devastating Shibuya Incident, Yuji Itadori and Megumi Fushiguro navigate colony barrier rules, introducing lethal modern sorcerers and resurrected ancient sorcerers.

4. **One Piece (Egghead Future Island Climax)**: Toei Animation continues its cinema-grade weekly television broadcast of Eiichiro Oda's sci-fi epic. Dr. Vegapunk's global truth broadcast, the awakening of the Five Elders, and the Straw Hat Pirates' escape route reach a fever pitch of animation brilliance.

### Production Studio Breakdown & Industry Shifts

Studio A-1 Pictures (*Solo Leveling*) and Ufotable (*Demon Slayer*) continue to push the boundaries of compositing and sound synchronization. The Spring 2026 window demonstrates how Japanese animation studios are prioritizing tighter episode batch counts to ensure animators deliver peak visual fidelity during climactic boss battles.

### Simulcast Timing & Watchlist Setup

All flagship series air in synchronized broadcast windows. AniHubStream updates daily episode links with dual Japanese audio (featuring multi-language synchronized subtitles) and regional dub alternatives within hours of Japanese airtimes.

### Frequently Asked Questions (Spring 2026 Anime)

- **When do Spring 2026 anime series begin broadcasting?**
  Most television series kick off during the first week of April 2026, with select preview specials and hour-long premieres debuting in late March.

- **Where can I track daily airing countdowns?**
  Use AniHubStream's dedicated **Episode Schedule** tab to track live countdown clocks, airing days, and episode release notifications.

- **Will English dubs air at the same time as the subbed episodes?**
  Major flagship series such as *Solo Leveling* and *Demon Slayer* feature same-day or two-week simuldub turnarounds, available directly in 1080p on AniHubStream.
    `.trim(),
  },
  {
    slug: 'top-10-dark-fantasy-anime-masterpieces',
    title: 'Top 10 Dark Fantasy Anime Masterpieces You Must Watch (Ranked)',
    excerpt: 'An authoritative, production-level ranking of the grittiest dark fantasy anime ever animated — analyzing animation pedigree, psychological weight, and unforgiving worldbuilding.',
    category: 'Rankings',
    author: 'Kenji Sato',
    authorRole: 'Anime Historian & Critic',
    date: '2026-03-15',
    readTime: '12 min read',
    coverImage: '/images/banners/banner-dark-fantasy.jpg',
    tags: ['Dark Fantasy', 'Rankings', 'Berserk', 'Jujutsu Kaisen', 'Chainsaw Man', 'Made in Abyss', 'Attack on Titan'],
    relatedAnimeSlugs: ['berserk', 'jujutsu-kaisen', 'chainsaw-man', 'made-in-abyss', 'attack-on-titan', 'demon-slayer'],
    content: `
Dark fantasy occupies a revered tier in anime storytelling. Unlike traditional high fantasy where righteousness reliably triumphs and protagonist plot armor remains impenetrable, dark fantasy challenges moral purity, plunges characters into existential grief, and illustrates the severe cost of ambition.

In dark fantasy, the environment itself operates as an unrelenting antagonist. Whether through demonic curses lingering across generations, grotesque physiological metamorphoses, or corrupt empires devouring their citizens, the stakes are tangible and uncompromising.

Below is our definitive, studio-analyzed ranking of the ten greatest dark fantasy anime ever produced, evaluated by narrative coherence, directorial vision, worldbuilding, and visceral thematic impact.

### The Definitive Top 10 Dark Fantasy Ranking

1. **Berserk (1997)**: Directed by Naohito Takahashi at Studio OLM with an indelible, ambient electronic soundtrack by Susumu Hirasawa, the 1997 adaptation of Kentaro Miura's magnum opus remains the undisputed gold standard of medieval grimdark tragedy. Centered on Guts, Griffith, and the Band of the Hawk, the narrative explores camaraderie, Machiavellian destiny, and catastrophic betrayal culminating in the nightmarish Eclipse.

2. **Jujutsu Kaisen**: Produced with bleeding-edge animation choreography by Studio MAPPA under directors Sunghoo Park and Shota Goshozono, Gege Akutami's modern juggernaut subverts traditional shonen tropes. The Shibuya Incident arc in particular transforms the series into an unrelenting psychological pressure cooker where characters face lethal domain clashes, permanent disfigurement, and insurmountable curses.

3. **Chainsaw Man**: Directed by Ryu Nakayama at Studio MAPPA, Tatsuki Fujimoto's visceral masterpiece strips away romanticized heroism. Denji's journey as a Public Safety Devil Hunter is grounded in poverty, urban alienation, and manipulative authority figures, captured through cinematic 35mm-style framing and bone-crunching demon battles.

4. **Made in Abyss**: Animated by Kinema Citrus under director Masayuki Kojima with Kevin Penkin's transcendent orchestral score, this series disguises body horror and eldritch despair beneath whimsical storybook character designs. As Riko and Reg descend through the Curse of the 6th Layer, the biological consequences of the Abyss test the absolute limits of human endurance.

5. **Attack on Titan**: Spanning groundbreaking production runs by both Wit Studio and Studio MAPPA based on Hajime Isayama's manga, this dark fantasy epic shifts from claustrophobic survival horror against flesh-eating giants into a sprawling geopolitical tragedy examining fascism, generational cycle of hatred, and the apocalyptic devastation of the Rumbling.

6. **Demon Slayer: Kimetsu no Yaiba**: Produced by Ufotable with direction by Haruo Sotozaki and Yuki Kajiura's musical compositions, Koyoharu Gotouge's Taisho-era dark fantasy delivers unprecedented 3D digital camera integration and fluid ukiyo-e swordplay. The tragedy of family slaughter and demon cannibalism drives Tanjiro's desperate quest to cure Nezuko.

7. **Claymore**: Produced by Studio Madhouse based on Norihiro Yagi's manga, Claymore follows silver-eyed, half-human hybrid warriors engineered to butcher shapeshifting Yoma. Clare's descent into demonic awakening and her relentless quest to avenge Teresa of the Faint Smile makes it a beloved staple of medieval dark fantasy.

8. **Dororo**: A joint production by MAPPA and Tezuka Productions directed by Kazuhiro Furuhashi, this modern revival of Osamu Tezuka's feudal folklore follows Hyakkimaru, a prosthetic-laden warrior hunting 12 pact demons to reclaim the sensory organs and limbs stolen by his father for provincial prosperity.

9. **D.Gray-man**: Produced by TMS Entertainment adapting Katsura Hoshino's gothic manga, the series follows Allen Walker and the Black Order's exorcists wielding Innocence against the Millennium Earl and his tragic Akuma — biomechanical monsters powered by trapped human souls.

10. **Tokyo Ghoul**: Animated by Studio Pierrot from Sui Ishida's psychological horror manga, Ken Kaneki's forced transplantation of ghoul organs plunges him into the cannibalistic underworld of Tokyo, dissecting the agony of belonging to neither human society nor monstrous predator species.

### Production Highlights & Animation Pedigree

What elevates these ten series above generic fantasy is the refusal to compromise on consequence. In Studio MAPPA's *Jujutsu Kaisen* and Kinema Citrus's *Made in Abyss*, major characters suffer irrevocable losses, permanent injuries, and psychological fractures that permanently alter the narrative trajectory.

### Streaming Guide: How to Watch in 1080p Ultra HD

All ten highlighted dark fantasy anime series are catalogued on AniHubStream with full multi-source 1080p high definition streams, synchronized Japanese audio with official multi-language subtitles, and dual English dub tracks.

### Frequently Asked Questions (Dark Fantasy Anime)

- **Which dark fantasy anime should beginners start with?**
  *Jujutsu Kaisen* and *Demon Slayer* offer modern pacing, phenomenal production values by MAPPA and Ufotable, and accessible entry points before diving into heavier, psychologically demanding classics like *Berserk (1997)* or *Made in Abyss*.

- **Is the 1997 Berserk anime better than the 2016 version?**
  The 1997 anime by Studio OLM is widely considered vastly superior due to its hand-drawn cel animation, iconic soundtrack by Susumu Hirasawa, and faithful adaptation of the Golden Age arc, whereas the 2016 television release was heavily criticized for awkward 3D CGI and jarring sound design.

- **Are all episodes available on AniHubStream without ads?**
  Yes. AniHubStream provides high-speed streaming links with dual audio choices, automated skip-intro markers, and community episode ratings.
    `.trim(),
  },
  {
    slug: 'solo-leveling-reawakening-complete-guide',
    title: 'Solo Leveling ReAwakening: Story Arcs, Power Scaling & Watch Guide',
    excerpt: 'Everything you need to know about Sung Jinwoo’s journey from the World’s Weakest E-Rank hunter to the Monarch of Shadows.',
    category: 'Analysis',
    author: 'AniHub Editorial Team',
    authorRole: 'Action Specialist',
    date: '2026-03-08',
    readTime: '7 min read',
    coverImage: '/images/banners/banner-solo-leveling.jpg',
    tags: ['Solo Leveling', 'Manhwa', 'Sung Jinwoo', 'Power Scaling', 'A-1 Pictures'],
    relatedAnimeSlugs: ['solo-leveling'],
    content: `
The phenomenon of *Solo Leveling* redefined modern fantasy action. Originally authored by Chugong with legendary illustration work by the late DUBU (REDICE Studio), its anime translation has set new benchmarks for cinematic pacing.

### Understanding the System Mechanic
Unlike conventional protagonists who rely on external party synergies, Sung Jinwoo is chosen by a mysterious game-like System. By executing daily quest regimens, exploring penalty zones, and entering instant dungeons, he breaks the natural hard cap that confines ordinary hunters to their awakening tier.

### Key Story Arcs Covered
- **The D-Rank Double Dungeon**: The horrific crucible that establishes the narrative tone and awakens the Shadow Monarch lineage.
- **The Red Gate Incident**: A survival trial inside an isolated dimensional rift against White Walkers and Ice Elves.
- **Jeju Island Raid**: The pivotal international operation that tests S-Rank hunters against mutated apex chimera ants.

### Complete Episode Order & Streaming Tips
To experience *Solo Leveling* without filler interruption, watch the mainline TV series consecutively. All episodes are catalogued with exact skip-intro markers and multi-server redundancy on AniHubStream.
    `.trim(),
  },
  {
    slug: 'best-isekai-anime-ranked-by-worldbuilding',
    title: 'The 15 Best Isekai Anime Ranked by Story, Worldbuilding, and Action',
    excerpt: 'Move beyond generic reincarnation tropes. These 15 standout isekai series elevate the genre with intricate magic systems, economic realism, and profound character growth.',
    category: 'Rankings',
    author: 'Elena Rostova',
    authorRole: 'Narrative Architect',
    date: '2026-02-28',
    readTime: '9 min read',
    coverImage: '/images/banners/banner-isekai-worldbuilding.jpg',
    tags: ['Isekai', 'Fantasy', 'Worldbuilding', 'Magic Systems', 'Recommendations'],
    relatedAnimeSlugs: ['rezero', 'overlord', 'mushoku-tensei'],
    content: `
The isekai (transported to another world) genre is frequently dismissed as shallow escapism powered by formulaic cheat skills and overpowered protagonists. However, when executed by visionary authors and world-class animation studios, isekai represents some of the richest worldbuilding, most complex socioeconomic systems, and deepest psychological journeys in contemporary media.

Below is our definitive, ranked countdown of the 15 greatest isekai anime ever produced, evaluated by narrative depth, worldbuilding coherence, and action choreography.

### 1. Mushoku Tensei: Jobless Reincarnation
The undisputed pioneer of modern isekai storytelling. Rather than granting instant godhood, author Rifujin na Magonote and Studio Bind treat Rudeus Greyrat’s reincarnation as a genuine second chance at human redemption. Unrivaled cultural geography, distinct regional languages, and authentic character redemption.

### 2. Re:Zero — Starting Life in Another World
A masterclass in psychological deconstruction and emotional resilience. Tappei Nagatsuki strips away every power fantasy trope by giving Subaru Natsuki only one ability: 'Return by Death'. Breaking down entitlement into true leadership.

### 3. Overlord
Told from the perspective of an omnipotent undead sovereign, Overlord turns the traditional hero's journey on its head. Meticulous geopolitical espionage, tier-magic thermodynamics, and guild bureaucracy.

### 4. That Time I Got Reincarnated as a Slime
The pinnacle of civilization-building and political diplomacy. Satoru Mikami’s reincarnation as a lowly slime evolves into the founding of the Jura Tempest Federation, an egalitarian haven uniting monsters and humanity.

### 5. Ascendance of a Bookworm
An intellectual triumph that treats knowledge, literacy, and industrial chemistry as the ultimate superpowers. Realistic portrayal of pre-industrial economics and papermaking.

### 6. The Eminence in Shadow
A brilliant, hyper-stylish parody of the genre that doubles as a genuine high-octane action masterpiece. Cid Kagenou's accidental mastermind antics delivered with blockbuster cinema choreography.

### 7. Log Horizon
Author Mamare Touno’s tactical masterpiece shifts focus from individual power fantasy to massive social engineering, banking systems, and MMO raid mechanics.

### 8. No Game No Life
Genius NEET siblings Sora and Shiro conquer Disboard, where all conflict—from border disputes to royal elections—must be settled through high-stakes games governed by the Ten Pledges.

### 9. Saga of Tanya the Evil
A dark military thriller blending alternate 20th-century history with ruthless theological debate. Tanya Degurechaff wages an intellectual and aerial war against divine intervention.

### 10. KonoSuba: God's Blessing on this Wonderful World!
The undisputed king of isekai satire. Kazuma Satou and his dysfunctional party subvert every fantasy trope through legendary comedic timing and explosive animation.

### 11. The Rising of the Shield Hero
Naofumi Iwatani claws his way up from false accusation to defend Melromarc from the Calamity Waves with defensive strategy, crafting, and tactical synergy.

### 12. Grimgar of Fantasy and Ash
A tender, watercolor-painted survival drama following rookie adventurers fighting desperately for everyday subsistence with realistic weight and emotional permanence.

### 13. Campfire Cooking in Another World with My Absurd Skill
A soothing, mouthwatering culinary fantasy following Mukouda's Online Supermarket skill and the legendary divine wolf Fel across high-budget gourmet adventures.

### 14. The Faraway Paladin
A solemn, poetic coming-of-age story in the ruined city of the dead, where Will takes a sacred vow as a chivalric champion of the Goddess of Light.

### 15. Shangri-La Frontier
A masterclass in blisteringly fluid gaming action, following trash-game connoisseur Rakuro against formidable unique apex monsters.

Stream all 15 of these celebrated isekai masterpieces on AniHubStream!
    `.trim(),
  },
];

export const NEWS_ARTICLES: NewsArticleItem[] = Array.isArray(EDITORIAL_GUIDES) && EDITORIAL_GUIDES.length > 0
  ? (EDITORIAL_GUIDES as unknown as NewsArticleItem[])
  : FALLBACK_EDITORIAL_ARTICLES;

export function cleanExcerpt(text: string, maxChars = 155): string {
  if (!text) return '';
  const clean = text
    .replace(/<[^>]+>/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (clean.length <= maxChars) return clean;
  const cut = clean.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(' ');
  const trimmed = lastSpace > 50 ? cut.slice(0, lastSpace) : cut;
  return trimmed.replace(/[,;:. -]+$/, '') + '...';
}

export function convertLiveNewsToArticle(item: any): NewsArticleItem {
  const title = item.originalTitle || item.title;
  const isAnime = (item.format || 'Anime').toLowerCase() === 'anime';
  const seed = (item.slug || title).split('').reduce((acc: number, c: string) => acc + c.charCodeAt(0), 0);

  const headlineH2s = [
    '## Announcement & Key Industry Details',
    '## Production Overview & Story Developments',
    '## Official Release Details & Franchise Context',
    '## Project Background & Creative Milestones',
  ];
  const leadH2 = headlineH2s[seed % headlineH2s.length];

  const studioH2s = [
    '## Animation Studio & Production Pedigree',
    '## Creative Studio & Direction Team',
    '## Production Leadership & Studio Credits',
  ];
  const studioH2 = studioH2s[seed % studioH2s.length];

  const staffList = (item.staff || [])
    .map((s: any) => `- **${s.role}**: ${s.name}`)
    .join('\n');
  const castList = (item.voiceCast || [])
    .filter((c: any) => Boolean(c.actor || c.voiceActor || c.name))
    .map((c: any) => `- **${c.character || 'Character'}**: ${c.actor || c.voiceActor || c.name}`)
    .join('\n');

  const broadcastOrReadingSection = isAnime
    ? `## Broadcast Schedule & Where to Watch
Episodes are scheduled for synchronized international simulcast with original Japanese audio and official multi-language subtitles. AniHubStream tracks live countdown clocks, release days, and 1080p high-definition streams across all major broadcast series.`
    : `## Source Reading & Catalog Exploration
Official anime broadcast adaptations have not been scheduled for this release. Fans of the franchise can track print serialization developments or explore related anime adaptations with similar themes in AniHubStream's curated streaming library.`;

  const keyFactsBlock = `
### Key Production Facts
- **Format**: ${item.format || 'Anime'}
${item.studio ? `- **Animation Studio**: ${item.studio}\n` : ''}${item.sourceMaterial ? `- **Original Source**: ${item.sourceMaterial}\n` : ''}- **Reporting Source**: [${item.source}](${item.sourceUrl})
${item.matchedAnime ? `- **Streaming Availability**: [Watch ${item.matchedAnime.title} on AniHubStream](${item.matchedAnime.streamUrl})` : ''}
`.trim();

  const content = `
${leadH2}

${item.editorialSummary}

${keyFactsBlock}

${item.studio || staffList ? `${studioH2}
${item.studio ? `- **Lead Studio**: ${item.studio}\n` : ''}${staffList ? `\n**Production Leadership**:\n${staffList}\n` : ''}` : ''}

${castList ? `## Featured Cast & Characters
${castList}
` : ''}

${item.sourceMaterial ? `## Source Material & Adaptation Context
This release is adapted from the original **${item.sourceMaterial}**, expanding its reach across global broadcast and streaming syndication.
` : ''}

${broadcastOrReadingSection}

## Primary Verification & Citation
Full announcement details, official key visuals, and promotional trailers were originally published and verified by [${item.source}](${item.sourceUrl}).
  `.trim();

  const authorMap: Record<string, { name: string; role: string; url: string }> = {
    'Anime Corner': { name: 'Elena Rostova', role: 'Anime Industry Correspondent', url: 'https://anihubstream.com/about#editorial' },
    'Crunchyroll News': { name: 'Marcus Vance', role: 'Broadcast Syndication Analyst', url: 'https://anihubstream.com/about#editorial' },
    'MyAnimeList': { name: 'Daiki Tanaka', role: 'Franchise Data Specialist', url: 'https://anihubstream.com/about#editorial' },
    'Anime Trending': { name: 'Kento Takahashi', role: 'Global Anime Trends Analyst', url: 'https://anihubstream.com/about#editorial' },
    'Otaku USA Magazine': { name: 'Joseph Luster', role: 'Senior Feature Journalist', url: 'https://anihubstream.com/about#editorial' },
    'Dexerto Anime': { name: 'Liam Croft', role: 'Entertainment & Gaming Editor', url: 'https://anihubstream.com/about#editorial' },
    'CBR Anime': { name: 'David Caballero', role: 'Comics & Manga Specialist', url: 'https://anihubstream.com/about#editorial' },
  };

  const authorInfo = authorMap[item.source] || { name: 'AniHub Editorial Desk', role: 'Anime News Curator', url: 'https://anihubstream.com/about#editorial' };

  return {
    slug: item.slug,
    title,
    excerpt: cleanExcerpt(item.editorialSummary, 155),
    category: (item.category || 'Anime News') as any,
    author: authorInfo.name,
    authorRole: authorInfo.role,
    date: item.publishedAt ? item.publishedAt.split('T')[0] : '2026-11-25',
    readTime: `${Math.max(2, Math.ceil((item.wordCount || 150) / 100))} min read`,
    coverImage: item.imageUrl || '/images/banners/banner-spring-2026.jpg',
    tags: [item.format || 'Anime', item.source, item.studio, item.matchedAnime?.title].filter(Boolean) as string[],
    relatedAnimeSlugs: item.matchedAnime ? [item.matchedAnime.slug] : [],
    content,
  };
}

export function getNewsArticleBySlug(slug: string): NewsArticleItem | undefined {
  const normalizedSlug = slug.replace(/--+/g, '-').replace(/-+$/, '');
  const staticArticle = NEWS_ARTICLES.find((a) => a.slug === slug || a.slug === normalizedSlug);
  if (staticArticle) return staticArticle;

  if (Array.isArray(FEED_ITEMS)) {
    const liveItem = FEED_ITEMS.find((item: any) => item.slug === slug || item.slug === normalizedSlug);
    if (liveItem) {
      return convertLiveNewsToArticle(liveItem);
    }
  }

  return undefined;
}

export function getAllNewsArticles(): NewsArticleItem[] {
  const liveArticles = Array.isArray(FEED_ITEMS) ? FEED_ITEMS.map(convertLiveNewsToArticle) : [];
  return [...NEWS_ARTICLES, ...liveArticles];
}
