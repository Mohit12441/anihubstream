// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  generateNewsId,
  slugifyTitle,
  matchesTitle,
  detectFormatContext,
  deduplicateNewsItems,
  generateEditorialEnrichment,
} from './sync-news.mjs';

test('Automated Anime News Ingestion & Editorial Enrichment Pipeline', async (t) => {
  await t.test('generateNewsId produces deterministic 12-char hex id', () => {
    const id1 = generateNewsId('https://animenewsnetwork.com/test-article');
    const id2 = generateNewsId('https://animenewsnetwork.com/test-article');
    const id3 = generateNewsId('https://animenewsnetwork.com/different-article');

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

  await t.test('Enrichment handles MAL anime-related news with "Watch the anime adaptation" CTA', () => {
    const mockMalAnimeItem = {
      title: "Psyren Manga Creator's New Project Receives TV Anime Greenlit",
      contentSnippet: "Toshiaki Iwashiro's supernatural psychic series is officially receiving an animated adaptation.",
    };
    const mockMatchedAnime = {
      title: "Psyren",
      slug: "psyren",
    };

    const enriched = generateEditorialEnrichment(mockMalAnimeItem, mockMatchedAnime, 'MyAnimeList');
    assert.ok(enriched.includes('Watch the anime adaptation on AniHubStream'));
    assert.ok(enriched.includes('Psyren'));
    assert.ok(enriched.includes('MyAnimeList'));
  });

  await t.test('Enrichment handles MAL manga/LN news without anime with "Check out our anime catalog" CTA', () => {
    const mockMalLnMangaItem = {
      title: "Mahoutsukai no Yoru Visual Novel Receives Official Manga Serialization Sequel",
      contentSnippet: "Type-Moon announced today that the legendary visual novel is expanding with a brand new spinoff volume.",
    };

    const enriched = generateEditorialEnrichment(mockMalLnMangaItem, null, 'MyAnimeList');
    assert.ok(enriched.includes('Check out our anime catalog for similar titles'));
    assert.ok(enriched.includes('visual novel'));
    assert.ok(enriched.includes('MyAnimeList'));
  });

  await t.test('deduplicateNewsItems merges duplicate ANN and MAL stories prioritizing image and earlier time', () => {
    const mockFeed = [
      {
        title: "Psyren TV Anime Adaptation Officially Announced",
        link: "https://www.animenewsnetwork.com/news/2026-11-25/psyren-anime/.123",
        snippet: "Toshiaki Iwashiro's supernatural battle manga Psyren is getting a television anime.",
        pubDate: "2026-11-25T01:00:00.000Z",
        source: "Anime News Network",
        imageUrl: null,
        matchedAnime: { title: "Psyren", slug: "psyren" }
      },
      {
        title: "Psyren Manga Gets TV Anime Adaptation",
        link: "https://myanimelist.net/news/78910",
        snippet: "Shueisha announced that Psyren manga is receiving a TV anime adaptation.",
        pubDate: "2026-11-25T01:30:00.000Z",
        source: "MyAnimeList",
        imageUrl: "https://myanimelist.net/images/news/psyren.jpg",
        matchedAnime: { title: "Psyren", slug: "psyren" }
      },
      {
        title: "Unrelated One Piece Special Episode Announced",
        link: "https://myanimelist.net/news/78911",
        snippet: "Toei Animation announced a new episode special.",
        pubDate: "2026-11-25T02:00:00.000Z",
        source: "MyAnimeList",
        imageUrl: null,
        matchedAnime: { title: "One Piece", slug: "one-piece" }
      }
    ];

    const result = deduplicateNewsItems(mockFeed);

    // 3 raw items should deduplicate down to 2 unique stories
    assert.equal(result.length, 2);

    // The Psyren story should pick the MyAnimeList item because it has a valid imageUrl
    const psyrenStory = result.find(r => r.title.includes('Psyren'));
    assert.ok(psyrenStory);
    assert.equal(psyrenStory.source, 'MyAnimeList');
    assert.equal(psyrenStory.imageUrl, 'https://myanimelist.net/images/news/psyren.jpg');
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
});
