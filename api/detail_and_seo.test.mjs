import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();

test('SEO & Crawler Fallback: index.html has rich semantic crawler shell (>150 words)', () => {
  const htmlPath = path.join(rootDir, 'index.html');
  const content = fs.readFileSync(htmlPath, 'utf8');

  // Extract root fallback content
  const rootMatch = content.match(/<div id="root">([\s\S]*?)<\/div>/);
  assert.ok(rootMatch, 'index.html must contain #root container');

  const innerText = rootMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const words = innerText.split(' ').filter(Boolean);
  
  assert.ok(words.length >= 150, `Crawler fallback should have at least 150 words to avoid thin-content flags, found ${words.length}`);
  assert.match(innerText, /AniHubStream/i);
  assert.match(innerText, /Action/i);
  assert.match(innerText, /Watchlist/i);
});

test('SEO: useSEO.ts uses dynamic origin rather than hardcoded domain', () => {
  const seoPath = path.join(rootDir, 'src', 'lib', 'useSEO.ts');
  const content = fs.readFileSync(seoPath, 'utf8');

  assert.ok(
    content.includes('window.location.origin'),
    'useSEO.ts must resolve window.location.origin dynamically to avoid canonical mismatch on *.pages.dev'
  );
});

test('Routes: App.tsx defines /anime/:id detail route and /watchlist route', () => {
  const appPath = path.join(rootDir, 'src', 'App.tsx');
  const content = fs.readFileSync(appPath, 'utf8');

  assert.ok(
    content.includes('path="/anime/:id"'),
    'App.tsx must register /anime/:id detail page route'
  );
  assert.ok(
    content.includes('path="/watchlist"'),
    'App.tsx must register /watchlist route'
  );
});

test('Component: AnimeDetail page exists and imports useAnimeDetail', () => {
  const detailPath = path.join(rootDir, 'src', 'pages', 'AnimeDetail.tsx');
  assert.ok(fs.existsSync(detailPath), 'AnimeDetail.tsx must exist');

  const content = fs.readFileSync(detailPath, 'utf8');
  assert.ok(content.includes('useAnimeDetail'), 'AnimeDetail must use useAnimeDetail hook');
  assert.ok(content.includes('/api/play?id='), 'AnimeDetail must preview available servers');
});

test('Edge Middleware: functions/_middleware.js uses url.origin and handles /anime/:id and /watchlist', () => {
  const mwPath = path.join(rootDir, 'functions', '_middleware.js');
  const content = fs.readFileSync(mwPath, 'utf8');

  assert.ok(content.includes('url.origin'), '_middleware.js must use url.origin dynamically');
  assert.ok(content.includes('/anime/'), '_middleware.js must handle /anime/:id');
  assert.ok(content.includes('/watchlist'), '_middleware.js must handle /watchlist');
  assert.ok(content.includes('/search'), '_middleware.js must handle /search');
});

