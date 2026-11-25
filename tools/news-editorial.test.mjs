// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('News Editorial Data Contract and SEO Integration', async (t) => {
  await t.test('newsData.ts exports valid articles with required backlink metadata', async () => {
    const newsDataPath = path.resolve('src/data/newsData.ts');
    assert.ok(fs.existsSync(newsDataPath), 'src/data/newsData.ts must exist');

    const content = fs.readFileSync(newsDataPath, 'utf8');
    assert.match(content, /export const NEWS_ARTICLES/);
    assert.match(content, /spring-2026-anime-season-guide/);
    assert.match(content, /top-10-dark-fantasy-anime-masterpieces/);
    assert.match(content, /solo-leveling-reawakening-complete-guide/);
    assert.match(content, /best-isekai-anime-ranked-by-worldbuilding/);
  });

  await t.test('TrustBadges component is rendered and exported correctly', async () => {
    const badgesPath = path.resolve('src/components/TrustBadges.tsx');
    assert.ok(fs.existsSync(badgesPath), 'src/components/TrustBadges.tsx must exist');

    const content = fs.readFileSync(badgesPath, 'utf8');
    assert.match(content, /Ad-Light Streaming/);
    assert.match(content, /1080p Ultra HD/);
    assert.match(content, /Daily Episode Releases/);
    assert.match(content, /No Signup Required/);
  });

  await t.test('Header navigation includes News & Guides link', async () => {
    const headerPath = path.resolve('src/components/Header.tsx');
    const content = fs.readFileSync(headerPath, 'utf8');
    assert.match(content, /to:\s*'\/news'/);
  });

  await t.test('Footer includes News & Guides link', async () => {
    const footerPath = path.resolve('src/components/Footer.tsx');
    const content = fs.readFileSync(footerPath, 'utf8');
    assert.match(content, /<Link to="\/news">/);
  });

  await t.test('Cloudflare Edge Middleware prerenders /news and /news/:slug for bots', async () => {
    const middlewarePath = path.resolve('functions/_middleware.js');
    const content = fs.readFileSync(middlewarePath, 'utf8');
    assert.match(content, /path === '\/news'/);
    assert.match(content, /path\.startsWith\('\/news\/'\)/);
    assert.match(content, /Allow: \/news/);
    assert.match(content, /NewsArticle/);
  });
});
