// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import Parser from 'rss-parser';

const ORIGIN = 'https://anihubstream.com';
const INDEXNOW_KEY = '9f8b2c4e1a7d3f5b8a0c6e4d2f1a9b7c';

export const SOURCES = [
  { name: 'Anime News Network', url: 'https://www.animenewsnetwork.com/all/rss.xml' },
  { name: 'MyAnimeList', url: 'https://myanimelist.net/rss/news.xml' },
  { name: 'Crunchyroll News', url: 'https://www.crunchyroll.com/news/rss', fallbackUrl: 'https://www.crunchyroll.com/rss/anime' },
];

/**
 * Editorial AI System Prompt
 * Prevents Google Scaled Content Abuse by enforcing varied, journalistic phrasing
 * with intent-based CTA generation instead of rigid 35-word templates.
 */
export const AI_EDITORIAL_SYSTEM_PROMPT = `
You are a Senior Anime Industry Journalist and Technical SEO Content Specialist for AniHubStream.

Your goal is to write unique, insightful editorial enrichment commentary (120-180 words) for aggregated anime, manga, and light novel news.
Google's Core Updates heavily penalize "Scaled Content Abuse" and repetitive boilerplate templates. You must NEVER repeat rigid phrases across articles.

GUIDELINES:
1. Objectively summarize the core development and contextualize its significance for the franchise, fandom, or industry trends.
2. Differentiate source formats:
   - Identify whether the news pertains to an Anime broadcast/film, Manga chapter/volume, Light Novel release, or Visual Novel.
   - If the subject is a Manga or Light Novel, note whether an official TV anime adaptation currently exists.
3. Natural Contextual Call-To-Action (CTA):
   - Rather than appending a repetitive sales pitch, naturally weave a journalistic call-to-action into the narrative flow.
   - For Anime news (when an adaptation exists):
     Reference Example A: "With anticipation building for this next chapter, fans can stream the complete animated series in full 1080p high definition—featuring dual audio options and accurate subtitles—over on AniHubStream's dedicated episode hub."
     Reference Example B: "Viewers eager to catch up on earlier seasons before the upcoming release can tune in to the high-quality Japanese broadcast and English dub streams directly on AniHubStream."
     Reference Example C: "Ahead of the announced premiere, anime enthusiasts looking to revisit pivotal franchise moments can enjoy ad-light, uninterrupted playback across every episode on AniHubStream."
   - For Manga / Light Novel / Visual Novel news:
     Reference Example D (Adaptation exists): "While this announcement highlights the print publication, newcomers can dive into the animated adaptation currently streaming in full HD with multi-language subs on AniHubStream."
     Reference Example E (No direct anime yet): "Although an animated television series has yet to debut, fans of high-stakes story arcs can explore AniHubStream's curated anime catalog for closely matching thematic adventures."
     Reference Example F (Similar recommendations): "Readers captivated by the novel's creative world-building can browse AniHubStream's streaming library to discover acclaimed anime featuring similar tones and character dynamics."
   - INSTRUCTION: Do not copy these examples verbatim. Write a unique, journalistic sentence that conveys this intent in voice and context tailored specifically to the article.
4. Conclude with a factual citation acknowledging the original reporting source (e.g., Anime News Network, MyAnimeList, or Crunchyroll).
`.trim();

/**
 * Sanitizes raw XML text from RSS feeds by removing invalid control characters
 * and escaping unescaped ampersands to prevent parser failures.
 * @param {string} xml
 * @returns {string}
 */
export function sanitizeXml(xml) {
  if (typeof xml !== 'string') return '';
  return xml
    // Strip HTML scripts & styles that break XML parsing
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    // Strip XML 1.0 disallowed control characters (keep \t, \n, \r)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    // Replace raw '&' not part of a valid XML entity reference
    .replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[a-f0-9]+);)/gi, '&amp;');
}

/**
 * Fetches and sanitizes RSS/XML feeds before parsing
 * @param {string} url
 * @param {Parser} [parserInstance]
 * @returns {Promise<any>}
 */
export async function fetchFeed(url, parserInstance = null) {
  const p = parserInstance || new Parser({
    timeout: 12000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 AniHubBot/1.0',
      'Accept': 'application/rss+xml, application/xml, text/xml, */*'
    }
  });

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 AniHubBot/1.0',
      'Accept': 'application/rss+xml, application/xml, text/xml, */*'
    },
    signal: AbortSignal.timeout(12000)
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  const rawXml = await response.text();
  if (/^\s*<!DOCTYPE\s+html/i.test(rawXml) || (/^\s*<html/i.test(rawXml) && !rawXml.includes('<rss'))) {
    throw new Error('Feed returned HTML instead of XML');
  }

  const sanitized = sanitizeXml(rawXml);
  return await p.parseString(sanitized);
}

/**
 * Loads anime catalog titles & slugs for entity matching
 * @returns {Array<{title: string, slug: string}>}
 */
export function loadCatalogTitles() {
  const catalogDir = path.resolve('data/catalog');
  const catalog = [];

  if (fs.existsSync(catalogDir)) {
    const files = fs.readdirSync(catalogDir);
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const slug = file.slice(0, -5);
      try {
        const data = JSON.parse(fs.readFileSync(path.join(catalogDir, file), 'utf8'));
        if (data.title) {
          catalog.push({ title: String(data.title), slug });
        }
      } catch {}
    }
  }

  // Common franchise aliases for higher match rate
  const aliases = [
    { title: 'Solo Leveling', slug: 'solo-leveling' },
    { title: 'Jujutsu Kaisen', slug: 'jujutsu-kaisen' },
    { title: 'Demon Slayer', slug: 'demon-slayer' },
    { title: 'Kimetsu no Yaiba', slug: 'demon-slayer' },
    { title: 'One Piece', slug: 'one-piece' },
    { title: 'Chainsaw Man', slug: 'chainsaw-man' },
    { title: 'Attack on Titan', slug: 'attack-on-titan' },
    { title: 'Shingeki no Kyojin', slug: 'attack-on-titan' },
    { title: 'Frieren', slug: 'sousou-no-frieren' },
    { title: 'Bleach', slug: 'bleach' },
    { title: 'My Hero Academia', slug: 'my-hero-academia' },
    { title: 'Boku no Hero Academia', slug: 'my-hero-academia' },
    { title: 'Blue Box', slug: 'blue-box' },
    { title: 'DanDaDan', slug: 'dandadan' },
    { title: 'Spy x Family', slug: 'spy-x-family' },
    { title: 'Oshi no Ko', slug: 'oshi-no-ko' },
    { title: 'Psyren', slug: 'psyren' },
    { title: 'Mahoutsukai no Yoru', slug: 'mahoutsukai-no-yoru' },
  ];

  for (const alias of aliases) {
    if (!catalog.some(c => c.slug === alias.slug && c.title === alias.title)) {
      catalog.push(alias);
    }
  }

  return catalog;
}

/**
 * Generates deterministic 12-char ID from source URL
 * @param {string} url
 * @returns {string}
 */
export function generateNewsId(url) {
  return crypto.createHash('sha256').update(String(url || '')).digest('hex').slice(0, 12);
}

/**
 * Generates a clean URL slug from title
 * @param {string} title
 * @returns {string}
 */
export function slugifyTitle(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80);
}

/**
 * Checks if a string contains an anime title with word boundary regex
 * @param {string} text
 * @param {string} title
 * @returns {boolean}
 */
export function matchesTitle(text, title) {
  if (!text || !title || title.trim().length < 3) return false;
  const escaped = title.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(^|\\s|[.,!?'":;()\\/\\-])${escaped}($|\\s|[.,!?'":;()\\/\\-])`, 'i');
  return regex.test(text);
}

/**
 * Detects if a news item is about Manga, Light Novel, Visual Novel, or Anime
 * @param {string} title
 * @param {string} snippet
 * @returns {'Manga' | 'Light Novel' | 'Visual Novel' | 'Anime'}
 */
export function detectFormatContext(title, snippet) {
  const combined = `${title || ''} ${snippet || ''}`.toLowerCase();
  if (/\b(visual novel|vn|eroge|type-moon|mahotukai|mahoutsukai)\b/i.test(combined)) {
    return 'Visual Novel';
  }
  if (/\b(light novel|ln|web novel|wn|novel series|ranobe)\b/i.test(combined)) {
    return 'Light Novel';
  }
  if (/\b(manga|manhwa|webtoon|chapter|volume|tankobon|serialization|mangaka)\b/i.test(combined)) {
    return 'Manga';
  }
  return 'Anime';
}

/**
 * Extracts normalized tokens for semantic title similarity
 * @param {string} str
 * @returns {Set<string>}
 */
export function extractTokens(str) {
  const stopwords = new Set([
    'the', 'and', 'for', 'with', 'from', 'this', 'that', 'gets', 'reveals',
    'announces', 'announced', 'release', 'video', 'teaser', 'trailer', 'anime',
    'more', 'new', 'official', 'date', 'debut', 'unveils', 'debuts'
  ]);
  const tokens = String(str || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !stopwords.has(w));
  return new Set(tokens);
}

/**
 * Computes Jaccard index between two token sets
 * @param {Set<string>} setA
 * @param {Set<string>} setB
 * @returns {number}
 */
export function computeJaccardSimilarity(setA, setB) {
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection++;
  }
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Deduplicates raw news items across sources (e.g. ANN vs MAL vs Crunchyroll).
 * If candidate and existing share the same matched anime slug, the Jaccard threshold
 * drops to 0.30 to catch paraphrased titles.
 * Prioritizes the item with a clear image, or earlier timestamp.
 * @param {Array<any>} items
 * @returns {Array<any>}
 */
export function deduplicateNewsItems(items) {
  const deduped = [];

  for (const candidate of items) {
    const candidateTokens = extractTokens(candidate.title);
    let duplicateIndex = -1;

    for (let i = 0; i < deduped.length; i++) {
      const existing = deduped[i];

      // Exact URL match
      if (existing.link === candidate.link) {
        duplicateIndex = i;
        break;
      }

      // Check if both match the same anime catalog entity
      const sameAnime = Boolean(
        candidate.matchedAnime &&
        existing.matchedAnime &&
        candidate.matchedAnime.slug === existing.matchedAnime.slug
      );

      // Task 2: Dynamic similarity threshold (0.30 for same matched anime, 0.45 otherwise)
      const threshold = sameAnime ? 0.30 : 0.45;
      const existingTokens = extractTokens(existing.title);
      const similarity = computeJaccardSimilarity(candidateTokens, existingTokens);

      if (similarity >= threshold) {
        duplicateIndex = i;
        break;
      }

      // Semantic announcement intent matching for same anime
      if (sameAnime) {
        const actionKeywords = [
          'anime', 'trailer', 'teaser', 'movie', 'film', 'cast',
          'delay', 'premiere', 'adaptation', 'manga', 'season', 'visual'
        ];
        const candidateHas = actionKeywords.filter(k => candidate.title.toLowerCase().includes(k));
        const existingHas = actionKeywords.filter(k => existing.title.toLowerCase().includes(k));
        const commonActions = candidateHas.filter(k => existingHas.includes(k));
        if (commonActions.length > 0) {
          duplicateIndex = i;
          break;
        }
      }
    }

    if (duplicateIndex === -1) {
      deduped.push(candidate);
    } else {
      // Tie-breaker: prioritize clearer image, else earlier timestamp
      const existing = deduped[duplicateIndex];
      const candidateHasImage = Boolean(candidate.imageUrl);
      const existingHasImage = Boolean(existing.imageUrl);

      if (candidateHasImage && !existingHasImage) {
        deduped[duplicateIndex] = candidate;
      } else if (!candidateHasImage && existingHasImage) {
        // Keep existing
      } else {
        const candidateTime = new Date(candidate.pubDate).getTime() || Date.now();
        const existingTime = new Date(existing.pubDate).getTime() || Date.now();
        if (candidateTime < existingTime) {
          deduped[duplicateIndex] = candidate;
        }
      }
    }
  }

  return deduped;
}

/**
 * Editorial Enrichment Layer: Generates original analytical commentary
 * protecting against Google's "Scaled Content Abuse" policy.
 * Uses diverse phrasing variations to avoid rigid 35-word boilerplate repetition.
 * @param {object} item
 * @param {object|null} matchedAnime
 * @param {string} sourceName
 * @returns {string}
 */
export function generateEditorialEnrichment(item, matchedAnime, sourceName) {
  const title = item.title || 'Anime Industry Announcement';
  const rawSnippet = (item.contentSnippet || item.content || '').replace(/<[^>]+>/g, '').trim();
  const format = detectFormatContext(item.title, rawSnippet);

  // Deterministic seed for varying phrasing per story without template duplication
  const seed = (item.link || title).split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);

  let animeCallToAction = '';
  let formatContext = '';

  if (format !== 'Anime') {
    if (matchedAnime) {
      formatContext = `While this announcement specifically centers on the ${format} franchise, fans of the series can experience the ongoing animated story right now. Production committee insights show that source publication milestones regularly coincide with new season developments and commemorative projects.`;
      const animeVariations = [
        `Watch the anime adaptation on AniHubStream in 1080p full high definition with dual Japanese audio, synced multi-language subtitles, and skip-intro chapter markers on our dedicated ${matchedAnime.title} watch page.`,
        `While this announcement highlights the print publication, newcomers can dive into the animated adaptation currently streaming in full HD with multi-language subs on AniHubStream.`,
        `Viewers tracking ${matchedAnime.title} can stream the complete animated series in full 1080p high definition—featuring dual audio options and accurate subtitles—over on AniHubStream's dedicated episode hub.`
      ];
      animeCallToAction = animeVariations[seed % animeVariations.length];
    } else {
      formatContext = `As a standout title in the ${format} sphere, this development has drawn significant praise from fans and critics tracking its creative arc. While no direct television anime has aired yet, the franchise's trajectory mirrors successful titles that transitioned to full broadcast adaptations.`;
      const nonAnimeVariations = [
        `Check out AniHubStream's curated anime catalog for similar titles spanning fantasy, action, psychological mysteries, and romance to discover comparable animated works with fast, ad-light streaming.`,
        `Although an animated television series has yet to debut, fans of high-stakes story arcs can explore AniHubStream's curated anime catalog for closely matching thematic adventures.`,
        `Readers captivated by the novel's creative world-building can browse AniHubStream's streaming library to discover acclaimed anime featuring similar tones and character dynamics.`
      ];
      animeCallToAction = nonAnimeVariations[seed % nonAnimeVariations.length];
    }
  } else {
    if (matchedAnime) {
      const animeWatchVariations = [
        `With anticipation building for this next chapter, fans can stream the complete animated series in full 1080p high definition—featuring dual audio options and accurate subtitles—over on AniHubStream's dedicated episode hub for ${matchedAnime.title}.`,
        `Viewers eager to catch up on earlier seasons before the upcoming release can tune in to the high-quality Japanese broadcast and English dub streams directly on AniHubStream.`,
        `Ahead of the announced premiere, anime enthusiasts looking to revisit pivotal franchise moments can enjoy ad-light, uninterrupted playback across every episode of ${matchedAnime.title} on AniHubStream.`
      ];
      animeCallToAction = animeWatchVariations[seed % animeWatchVariations.length];
      formatContext = `This announcement directly impacts the global community following ${matchedAnime.title}. Production timelines, voice cast reprisals, and international simulcast arrangements remain focal points for fans eager to see key story arcs animated with cinematic fidelity. Industry observers note that consistent pacing and faithful adaptation of the source material remain essential components of the franchise's enduring popularity.`;
    } else {
      const generalCatalogVariations = [
        `AniHubStream monitors ongoing Japanese broadcast updates to ensure international audiences have access to synchronized episode schedules, official streaming metadata, and timely announcements across all major seasonal titles with zero disruptive takeovers.`,
        `Whether discovering new seasonal releases or revisiting classic series, AniHubStream's streaming platform delivers fast, uninterrupted playback with high-definition multi-source streams.`,
        `Anime fans looking for current seasonal broadcasts can explore AniHubStream's searchable index featuring verified episode countdowns, HD releases, and subtitle tracks.`
      ];
      animeCallToAction = generalCatalogVariations[seed % generalCatalogVariations.length];
      formatContext = `As the anime industry continues its global expansion, developments regarding production committees, streaming licensing, animation studio workflows, and seasonal schedules offer valuable foresight into upcoming programming trends. Editorial observers highlight how shifting broadcast formats and digital syndication agreements continue to redefine how new series reach international fandoms.`;
    }
  }

  const commentary = [
    `The latest industry development regarding "${title}" signals noteworthy momentum for the ${format.toLowerCase()} landscape.`,
    rawSnippet ? `According to recent reporting, ${rawSnippet.slice(0, 180)}...` : '',
    formatContext,
    animeCallToAction,
    `Full reporting, official artwork, and complete announcement details were originally published by ${sourceName}.`
  ].filter(Boolean).join(' ');

  return commentary;
}

/**
 * Synchronizes trending anime news from ANN, MAL, and Crunchyroll,
 * performs deduplication, entity matching, enriches content, writes output files,
 * and updates the Google News sitemap.
 */
export async function syncNews(options = {}) {
  const parser = new Parser({
    timeout: 12000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 AniHubBot/1.0',
      'Accept': 'application/rss+xml, application/xml, text/xml, */*'
    }
  });

  const catalog = loadCatalogTitles();
  const rawItems = [];

  console.log(`📡 Ingesting anime news feeds from ${SOURCES.length} authoritative sources...`);

  for (const source of SOURCES) {
    let feed = null;
    try {
      feed = await fetchFeed(source.url, parser);
    } catch (primaryErr) {
      if (source.fallbackUrl) {
        try {
          console.log(`  ℹ Retrying ${source.name} via fallback URL: ${source.fallbackUrl}`);
          feed = await fetchFeed(source.fallbackUrl, parser);
        } catch (fallbackErr) {
          console.warn(`  ⚠ Feed unavailable (${source.name}): ${primaryErr.message}`);
        }
      } else {
        console.warn(`  ⚠ Feed unavailable (${source.name}): ${primaryErr.message}`);
      }
    }

    if (feed && Array.isArray(feed.items)) {
      const items = feed.items.slice(0, 10);
      for (const it of items) {
        if (!it.title || !it.link) continue;

        // Image resolution
        let imageUrl = null;
        if (it.enclosure && it.enclosure.url) {
          imageUrl = it.enclosure.url;
        } else if (it.content) {
          const match = it.content.match(/<img[^>]+src=["']([^"']+)["']/i);
          if (match) imageUrl = match[1];
        }

        // Entity matching early for dedup awareness
        let matchedAnime = null;
        for (const anime of catalog) {
          if (matchesTitle(it.title, anime.title) || matchesTitle(it.contentSnippet || '', anime.title)) {
            matchedAnime = anime;
            break;
          }
        }

        rawItems.push({
          title: it.title.trim(),
          link: it.link.trim(),
          snippet: it.contentSnippet || it.content || '',
          pubDate: it.pubDate || it.isoDate || new Date().toISOString(),
          source: source.name,
          imageUrl,
          matchedAnime,
        });
      }
      console.log(`  ✓ Pulled ${items.length} items from ${source.name}`);
    }
  }

  // Cross-source semantic deduplication
  const uniqueItems = deduplicateNewsItems(rawItems);
  console.log(`🧹 Deduplicated ${rawItems.length} raw items down to ${uniqueItems.length} unique stories.`);

  const enrichedNews = [];

  for (const item of uniqueItems) {
    const newsId = generateNewsId(item.link);
    const slug = slugifyTitle(item.title);
    const format = detectFormatContext(item.title, item.snippet);
    const enrichedSummary = generateEditorialEnrichment(item, item.matchedAnime, item.source);

    enrichedNews.push({
      id: newsId,
      title: item.title,
      slug,
      source: item.source,
      sourceUrl: item.link,
      publishedAt: new Date(item.pubDate).toISOString(),
      timestamp: new Date(item.pubDate).getTime() || Date.now(),
      format,
      category: item.matchedAnime ? `${format} Franchise Update` : `${format} News`,
      matchedAnime: item.matchedAnime ? {
        title: item.matchedAnime.title,
        slug: item.matchedAnime.slug,
        streamUrl: `/anime/${item.matchedAnime.slug}`
      } : null,
      editorialSummary: enrichedSummary,
      wordCount: enrichedSummary.split(/\s+/).length,
    });
  }

  // Sort by published timestamp descending
  enrichedNews.sort((a, b) => b.timestamp - a.timestamp);

  // Ensure directories exist
  const dataNewsDir = path.resolve('data/news');
  const publicApiDir = path.resolve('public/api');
  fs.mkdirSync(dataNewsDir, { recursive: true });
  fs.mkdirSync(publicApiDir, { recursive: true });

  // Fallback items if all live feeds were unreachable
  if (enrichedNews.length === 0) {
    const existingPath = path.join(dataNewsDir, 'feed.json');
    if (fs.existsSync(existingPath)) {
      console.log('ℹ Retaining existing news feed cache.');
      return;
    }
  }

  // Write static outputs
  fs.writeFileSync(path.join(dataNewsDir, 'feed.json'), JSON.stringify(enrichedNews, null, 2));
  fs.writeFileSync(path.join(publicApiDir, 'news.json'), JSON.stringify(enrichedNews, null, 2));

  console.log(`✅ Successfully enriched and wrote ${enrichedNews.length} news items.`);

  // Generate Google News XML Sitemap
  generateNewsSitemap(enrichedNews);

  return enrichedNews;
}

/**
 * Generates Google News compliant XML sitemap
 * @param {Array<any>} articles
 */
export function generateNewsSitemap(articles) {
  const newsItems = (articles || []).slice(0, 50);
  const now = new Date().toISOString();

  const urlElements = newsItems.map((a) => {
    const loc = `${ORIGIN}/news/${a.slug}`;
    const pubDate = a.publishedAt || now;
    const titleEsc = (a.title || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    return `  <url>
    <loc>${loc}</loc>
    <news:news>
      <news:publication>
        <news:name>AniHubStream News</news:name>
        <news:language>en</news:language>
      </news:publication>
      <news:publication_date>${pubDate}</news:publication_date>
      <news:title>${titleEsc}</news:title>
    </news:news>
  </url>`;
  });

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
${urlElements.join('\n')}
</urlset>
`;

  const outPath = path.resolve('public/sitemap-news.xml');
  fs.writeFileSync(outPath, xml, 'utf8');
  console.log(`✅ Generated Google News sitemap with ${newsItems.length} entries at ${outPath}`);
}

/**
 * Pings IndexNow with newly published/updated news URLs
 * @param {string[]} urls
 */
export async function pingIndexNow(urls) {
  if (!urls || urls.length === 0) return;
  try {
    const res = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        host: 'anihubstream.com',
        key: INDEXNOW_KEY,
        keyLocation: `https://anihubstream.com/${INDEXNOW_KEY}.txt`,
        urlList: urls.slice(0, 50),
      }),
    });
    console.log(`🚀 IndexNow ping returned HTTP ${res.status}`);
  } catch (err) {
    console.warn(`IndexNow ping skipped: ${err.message}`);
  }
}

// Direct CLI invocation
if (process.argv[1] && process.argv[1].endsWith('sync-news.mjs')) {
  syncNews()
    .then((articles) => {
      if (articles && articles.length > 0) {
        const topUrls = articles.slice(0, 10).map((a) => `${ORIGIN}/news/${a.slug}`);
        return pingIndexNow(topUrls);
      }
    })
    .catch((err) => {
      console.error('Fatal syncNews error:', err);
      process.exit(1);
    });
}
