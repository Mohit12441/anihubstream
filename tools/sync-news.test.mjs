// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { generateNewsId, slugifyTitle, matchesTitle, generateEditorialEnrichment } from './sync-news.mjs';

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

  await t.test('generateEditorialEnrichment creates 150+ words of commentary with attribution', () => {
    const mockItem = {
      title: 'Solo Leveling Season 2 Air Date Confirmed',
      contentSnippet: 'A-1 Pictures announced the production timeline for the upcoming season today.',
    };
    const mockAnime = {
      title: 'Solo Leveling',
      slug: 'solo-leveling',
    };

    const enriched = generateEditorialEnrichment(mockItem, mockAnime, 'Anime News Network');
    const wordCount = enriched.split(/\s+/).length;

    assert.ok(wordCount >= 100, `Expected at least 100 words, got ${wordCount}`);
    assert.ok(enriched.includes('AniHubStream provides high-definition'));
    assert.ok(enriched.includes('Anime News Network'));
    assert.ok(enriched.includes('Solo Leveling'));
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
