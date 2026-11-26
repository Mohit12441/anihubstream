// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Parser from 'rss-parser';
import {
  generateNewsId,
  slugifyTitle,
  matchesTitle,
  detectFormatContext,
  deduplicateNewsItems,
  generateEditorialEnrichment,
  sanitizeXml,
  AI_EDITORIAL_SYSTEM_PROMPT,
  SOURCES,
  generateSeoTitle,
  fetchOpenGraphImage,
  extractAnimeTitleForSearch,
} from './sync-news.mjs';

/**
 * Sample mockData array testing sanitization, entity matching, and CTA variations
 * across Anime and Manga/Light Novel sources.
 */
export const mockData = [
  {
    title: "Psyren Manga Gets TV Anime Adaptation & Official Teaser\x00",
    link: "https://myanimelist.net/news/78910",
    snippet: "Toshiaki Iwashiro's supernatural battle manga Psyren is officially receiving a television anime adaptation.",
    pubDate: "2026-11-25T01:30:00.000Z",
    source: "MyAnimeList",
    imageUrl: "https://myanimelist.net/images/news/psyren.jpg",
    matchedAnime: { title: "Psyren", slug: "psyren" }
  },
  {
    title: "Mahoutsukai no Yoru Visual Novel Receives Official Manga Serialization Sequel & Volume 1 Preview",
    link: "https://myanimelist.net/news/78912",
    snippet: "Type-Moon announced today that the legendary visual novel is expanding with a brand new spinoff volume.",
    pubDate: "2026-11-25T02:00:00.000Z",
    source: "MyAnimeList",
    imageUrl: "https://myanimelist.net/images/news/mahoutsukai.jpg",
    matchedAnime: null
  },
  {
    title: "Solo Leveling Season 2 Broadcast Schedule Set",
    link: "https://animecorner.me/solo-leveling-season-2-schedule/",
    snippet: "Aniplex announced the official international broadcast release dates for Solo Leveling Season 2.",
    pubDate: "2026-11-25T02:30:00.000Z",
    source: "Anime Corner",
    imageUrl: "https://animecorner.me/thumbnails/solo.jpg",
    matchedAnime: { title: "Solo Leveling", slug: "solo-leveling" }
  },
  {
    title: "Solo Leveling Gets Second Season TV Premiere Details",
    link: "https://www.crunchyroll.com/news/item/solo-leveling-second-season",
    snippet: "Crunchyroll announces simulcast streaming details for Solo Leveling's return.",
    pubDate: "2026-11-25T03:00:00.000Z",
    source: "Crunchyroll News",
    imageUrl: "https://crunchyroll.com/news/solo.jpg",
    matchedAnime: { title: "Solo Leveling", slug: "solo-leveling" }
  }
];

test('Automated Anime News Ingestion, Sanitization & Editorial Pipeline', async (t) => {
  await t.test('sanitizeXml cleans unescaped ampersands and control characters for rss-parser', async () => {
    const rawXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Crunchyroll News & Updates &amp; Highlights</title>
    <link>https://www.crunchyroll.com/news</link>
    <description>Latest Anime News & Releases</description>
    <item>
      <title>Solo Leveling & More Anime News\x00\x08</title>
      <link>https://www.crunchyroll.com/news/item-1</link>
      <description>Check out Season 2 & new trailers &lt;b&gt;exclusive&lt;/b&gt;!</description>
      <pubDate>Wed, 25 Nov 2026 05:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

    const cleaned = sanitizeXml(rawXml);
    assert.ok(!cleaned.includes('\x00'));
    assert.ok(!cleaned.includes('\x08'));
    assert.ok(cleaned.includes('&amp; More'));
    assert.ok(cleaned.includes('&amp; Highlights')); // existing &amp; remains valid, not &amp;amp;
    assert.ok(cleaned.includes('&lt;b&gt;'));

    const parser = new Parser();
    const feed = await parser.parseString(cleaned);
    assert.equal(feed.title, 'Crunchyroll News & Updates & Highlights');
    assert.equal(feed.items.length, 1);
    assert.equal(feed.items[0].title, 'Solo Leveling & More Anime News');
  });

  await t.test('generateNewsId produces deterministic 12-char hex id', () => {
    const id1 = generateNewsId('https://animecorner.me/test-article');
    const id2 = generateNewsId('https://animecorner.me/test-article');
    const id3 = generateNewsId('https://animecorner.me/different-article');

    assert.equal(id1.length, 12);
    assert.equal(id1, id2);
    assert.notEqual(id1, id3);
  });

  await t.test('slugifyTitle cleans and normalizes title strings', () => {
    const slug = slugifyTitle("Solo Leveling Season 2: Arise From the Shadow Revealed!");
    assert.match(slug, /^solo-leveling-season-2-arise-from-the-shadow-revealed/);
    assert.ok(!slug.includes('!'));
    assert.ok(!slug.includes(':'));
  });

  await t.test('matchesTitle accurately detects anime titles with word boundaries', () => {
    assert.ok(matchesTitle('Solo Leveling Season 2 Announced For 2026', 'Solo Leveling'));
    assert.ok(matchesTitle('Frieren: Beyond Journey’s End gets spinoff', 'Frieren'));
    assert.ok(!matchesTitle('Random string containing word K inside look', 'K'));
    assert.ok(!matchesTitle('', 'One Piece'));
  });

  await t.test('detectFormatContext accurately identifies Manga, Light Novel, Visual Novel, or Anime', () => {
    assert.equal(detectFormatContext('Psyren Manga Gets Spinoff Series', 'Weekly Shonen Jump serialization'), 'Manga');
    assert.equal(detectFormatContext('Mahoutsukai no Yoru Visual Novel Sequel Announced', 'Type-Moon visual novel'), 'Visual Novel');
    assert.equal(detectFormatContext('Sword Art Online Light Novel Volume 28 Details', 'Dengeki Bunko novel'), 'Light Novel');
    assert.equal(detectFormatContext('Demon Slayer Infinity Castle Movie Trilogy Premieres', 'Ufotable theatrical anime'), 'Anime');
  });

  await t.test('Upgraded Deduplication Logic uses 0.30 threshold for matching anime to catch paraphrased titles', () => {
    // Two articles with paraphrased titles about Solo Leveling
    const items = [
      {
        title: "Solo Leveling Season 2 Broadcast Schedule Set",
        link: "https://animecorner.me/solo-leveling-season-2-schedule/",
        pubDate: "2026-11-25T02:30:00.000Z",
        source: "Anime Corner",
        imageUrl: "https://animecorner.me/thumbnails/solo.jpg",
        matchedAnime: { title: "Solo Leveling", slug: "solo-leveling" }
      },
      {
        title: "Solo Leveling Gets Second Season TV Premiere Details",
        link: "https://www.crunchyroll.com/news/item/solo-leveling-second-season",
        pubDate: "2026-11-25T03:00:00.000Z",
        source: "Crunchyroll News",
        imageUrl: null,
        matchedAnime: { title: "Solo Leveling", slug: "solo-leveling" }
      }
    ];

    const deduped = deduplicateNewsItems(items);
    // Should deduplicate into 1 story because matchedAnime.slug is equal and similarity >= 0.30
    assert.equal(deduped.length, 1);
    // Prioritizes item with image
    assert.equal(deduped[0].source, 'Anime Corner');
    assert.equal(deduped[0].imageUrl, 'https://animecorner.me/thumbnails/solo.jpg');
  });

  await t.test('AI_EDITORIAL_SYSTEM_PROMPT is exported and defines varied CTA reference examples', () => {
    assert.ok(AI_EDITORIAL_SYSTEM_PROMPT.includes('Scaled Content Abuse'));
    assert.ok(AI_EDITORIAL_SYSTEM_PROMPT.includes('Do not copy these examples verbatim'));
    assert.ok(AI_EDITORIAL_SYSTEM_PROMPT.includes('Reference Example A'));
    assert.ok(AI_EDITORIAL_SYSTEM_PROMPT.includes('Reference Example D'));
    assert.ok(AI_EDITORIAL_SYSTEM_PROMPT.includes('AniHubStream'));
  });

  await t.test('generateEditorialEnrichment dynamically produces varied journalistic CTAs', () => {
    const itemA = {
      title: "Solo Leveling Season 2 Trailer Released",
      link: "https://example.com/article-a",
      contentSnippet: "A new trailer showcases Jinwoo's upcoming battles in season 2.",
    };
    const itemB = {
      title: "Solo Leveling Episode Air Date Confirmed",
      link: "https://example.com/article-b",
      contentSnippet: "Broadcasters confirm the air date for the upcoming season.",
    };
    const anime = { title: "Solo Leveling", slug: "solo-leveling" };

    const enrichedA = generateEditorialEnrichment(itemA, anime, 'Anime Corner');
    const enrichedB = generateEditorialEnrichment(itemB, anime, 'MyAnimeList');

    assert.ok(enrichedA.includes('AniHubStream'));
    assert.ok(enrichedB.includes('AniHubStream'));
    // Both are enriched and have different text
    assert.notEqual(enrichedA, enrichedB);
  });

  await t.test('mockData array items process cleanly through enrichment pipeline', () => {
    const deduped = deduplicateNewsItems(mockData);
    // 4 items: Psyren (1), Mahoutsukai (1), Solo Leveling (2 paraphrased deduped to 1) -> Total 3
    assert.equal(deduped.length, 3);

    for (const item of deduped) {
      const enriched = generateEditorialEnrichment(item, item.matchedAnime, item.source);
      assert.ok(enriched.length > 100);
      assert.ok(enriched.includes('AniHubStream'));
      assert.ok(enriched.includes(item.source));
    }
  });

  await t.test('Generated public news files and sitemap exist and contain valid items', () => {
    const feedPath = path.resolve('public/api/news.json');
    const sitemapPath = path.resolve('public/sitemap-news.xml');

    assert.ok(fs.existsSync(feedPath), 'public/api/news.json must exist');
    assert.ok(fs.existsSync(sitemapPath), 'public/sitemap-news.xml must exist');

    const feed = JSON.parse(fs.readFileSync(feedPath, 'utf8'));
    assert.ok(Array.isArray(feed));
    assert.ok(feed.length > 0);

    const sitemap = fs.readFileSync(sitemapPath, 'utf8');
    assert.ok(sitemap.includes('http://www.google.com/schemas/sitemap-news/0.9'));
    assert.ok(sitemap.includes('AniHubStream News'));
  });

  await t.test('generateEditorialEnrichment weaves AniList studio & staff metadata when provided', () => {
    const item = {
      title: "Solo Leveling Season 2 Trailer Released",
      link: "https://example.com/sl-trailer",
      contentSnippet: "A-1 Pictures unveils key art.",
    };
    const anime = { title: "Solo Leveling", slug: "solo-leveling" };
    const mockAniList = {
      studio: "A-1 Pictures",
      staff: [{ role: "Director", name: "Shunsuke Nakashige" }],
      source: "Web Manhwa",
      score: "8.4"
    };

    const enriched = generateEditorialEnrichment(item, anime, 'Anime Corner', mockAniList);
    assert.ok(enriched.includes('A-1 Pictures'));
    assert.ok(enriched.includes('Shunsuke Nakashige'));
    assert.ok(enriched.includes('Web Manhwa'));
    assert.ok(enriched.includes('8.4/10'));
    assert.ok(enriched.includes('AniHubStream'));
  });

  await t.test('SOURCES includes Anime Corner with valid feed URL', () => {
    const ac = SOURCES.find(s => s.name === 'Anime Corner');
    assert.ok(ac, 'Anime Corner must be in SOURCES');
    assert.equal(ac.url, 'https://animecorner.me/feed/');
  });

  await t.test('SOURCES does not include Anime News Network', () => {
    const ann = SOURCES.find(s => s.name === 'Anime News Network');
    assert.strictEqual(ann, undefined);
  });

  await t.test('generateSeoTitle creates clean, high-CTR titles within optimal length', () => {
    const title1 = generateSeoTitle("Solo Leveling Season 2 Release Window Confirmed", { title: "Solo Leveling" });
    assert.ok(title1.length <= 70);
    assert.ok(title1.includes('Solo Leveling'));

    const titleWithTag = generateSeoTitle("[Exclusive] Jujutsu Kaisen Culling Game Anime Adaptation - Anime Corner", { title: "Jujutsu Kaisen" });
    assert.ok(!titleWithTag.includes('[Exclusive]'));
    assert.ok(!titleWithTag.includes('- Anime Corner'));
    assert.ok(titleWithTag.includes('Jujutsu Kaisen'));
  });

  await t.test('extractAnimeTitleForSearch strips headline boilerplate to isolate anime series title', () => {
    assert.equal(
      extractAnimeTitleForSearch("The Kept Man of the Princess Knight Anime's New Video Reveals More Cast"),
      "The Kept Man of the Princess Knight"
    );
    assert.equal(
      extractAnimeTitleForSearch("Solo Leveling Season 2: Arise from the Shadow Premieres in April"),
      "Solo Leveling Season 2"
    );
    assert.equal(
      extractAnimeTitleForSearch("News: Frieren TV Anime Announces Spinoff Episode"),
      "Frieren"
    );
  });

  await t.test('slugifyTitle cleans trailing hyphens, en-dashes, and truncates at word boundaries', () => {
    const slug1 = slugifyTitle("Detective Conan 1214 Current ‒ Episode 1215 ‒ The Crimson");
    assert.ok(!slug1.includes('--'));
    assert.ok(!slug1.endsWith('-'));

    const slug2 = slugifyTitle("Naruto Shippuden The Assembly of the Five Kage Telugu Dub ");
    assert.ok(!slug2.endsWith('-'));

    const longTitle = "A Extremely Long Anime Title That Exceeds Seventy Characters And Should Truncate Naturally Without Broken Words";
    const slug3 = slugifyTitle(longTitle);
    assert.ok(slug3.length <= 75);
    assert.ok(!slug3.endsWith('-'));
  });

  await t.test('matchesTitle enforces strict franchise matching on stop titles to avoid false positives', () => {
    assert.equal(matchesTitle("Takes Place in 30 Days Around Tokyo", "DAYS"), false);
    assert.equal(matchesTitle("DAYS TV Anime Announces New Season", "DAYS"), true);
    assert.equal(matchesTitle("New laundry detergent will bleach fabric", "Bleach"), false);
    assert.equal(matchesTitle("Bleach: Thousand-Year Blood War Returns", "Bleach"), true);
  });
});
