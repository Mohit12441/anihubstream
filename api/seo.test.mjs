import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { onRequest } from '../functions/_middleware.js';
import { onRequestGet as sitemapHandler } from '../functions/sitemap.xml.js';

test('TASK 5 (P1) SEO: robots.txt conforms to crawler guidelines', () => {
  const robotsPath = path.resolve(process.cwd(), 'public/robots.txt');
  assert.ok(fs.existsSync(robotsPath), 'robots.txt must exist');
  const content = fs.readFileSync(robotsPath, 'utf8');

  assert.match(content, /Disallow:\s*\/api\//i, 'robots.txt must disallow /api/');
  assert.match(content, /Allow:\s*\/anime/i, 'robots.txt must allow /anime');
  assert.match(content, /Allow:\s*\/watch/i, 'robots.txt must allow /watch');
  assert.match(content, /Sitemap:\s*https:\/\/anihubstream\.com\/sitemap\.xml/i, 'robots.txt must specify sitemap');
});

test('TASK 5 (P1) SEO: sitemap.xml excludes retired duplicate slugs', async () => {
  const mockD1 = {
    prepare: (query) => ({
      bind: () => mockD1.prepare(query),
      all: async () => ({
        results: [
          { id: 'sousou-no-frieren', added_at: '2026-10-16T12:00:00Z' },
          { id: 'frieren-beyond-journey-s-end', added_at: '2026-10-15T12:00:00Z' }, // Duplicate/retired!
          { id: 'demon-slayer', added_at: '2026-10-16T12:00:00Z' },
          { id: 'demon-slayer-kimetsu-no-yaiba', added_at: '2026-10-15T12:00:00Z' }, // Duplicate/retired!
          { id: 'naruto', added_at: '2026-10-16T12:00:00Z' },
        ],
      }),
    }),
  };

  const response = await sitemapHandler({ env: { ANIHUB: mockD1 } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'application/xml; charset=utf-8');

  const xml = await response.text();
  assert.ok(xml.includes('https://anihubstream.com/anime/sousou-no-frieren'), 'Canonical /anime/ overview page must be present');
  assert.ok(xml.includes('https://anihubstream.com/watch/sousou-no-frieren'), 'Canonical sousou-no-frieren must be present');
  assert.ok(xml.includes('https://anihubstream.com/anime/demon-slayer'), 'Canonical /anime/ overview page must be present');
  assert.ok(xml.includes('https://anihubstream.com/watch/demon-slayer'), 'Canonical demon-slayer must be present');
  assert.ok(xml.includes('https://anihubstream.com/watch/naruto'));
  assert.ok(!xml.includes('https://anihubstream.com/watch/frieren-beyond-journey-s-end'), 'Retired duplicate frieren-beyond-journey-s-end must be excluded');
  assert.ok(!xml.includes('https://anihubstream.com/watch/demon-slayer-kimetsu-no-yaiba'), 'Retired duplicate demon-slayer-kimetsu-no-yaiba must be excluded');
});

test('TASK 5 (P1) SEO: _middleware edge 404 on missing anime slug', async () => {
  const mockD1 = {
    prepare: (query) => ({
      bind: (slug) => ({
        first: async () => null, // Not found
      }),
    }),
  };

  const context = {
    request: new Request('https://anihubstream.com/watch/non-existent-anime-slug'),
    next: async () => new Response('<html><head></head><body>SPA</body></html>', {
      headers: { 'content-type': 'text/html' },
    }),
    env: { ANIHUB: mockD1 },
  };

  const res = await onRequest(context);
  assert.equal(res.status, 404, 'Edge middleware must return 404 status for unknown anime');
  const body = await res.text();
  assert.ok(body.includes('Anime Not Found'), 'Body must indicate anime not found');
  assert.ok(body.includes('noindex'), 'Must include noindex robot meta');
});

test('TASK 5 (P1) SEO: _middleware injects series metadata and TVSeries JSON-LD', async () => {
  const animeRecord = {
    title: 'Frieren: Beyond Journey\'s End',
    native: '葬送のフリーレン',
    year: 2023,
    rating: 9.1,
    synopsis: 'During their decade-long quest, the party defeated the Demon King, bringing peace to the land. As an elf, Frieren lives for thousands of years and reflects on humanity and mortal life.',
    art: 'https://media.kitsu.app/frieren-poster.jpg',
    key_art: 'https://media.kitsu.app/frieren-banner.jpg',
    episode_total: 28,
    kind: 'tv',
  };

  const mockD1 = {
    prepare: (query) => ({
      bind: (slug) => ({
        first: async () => animeRecord,
      }),
    }),
  };

  let transformedHead = '';
  // Mock HTMLRewriter since Node runtime does not include Cloudflare HTMLRewriter
  globalThis.HTMLRewriter = class MockHTMLRewriter {
    constructor() {
      this.handlers = [];
    }
    on(selector, handler) {
      this.handlers.push({ selector, handler });
      return this;
    }
    async transform(res) {
      let html = await res.text();
      // Apply mock replacements
      for (const { selector, handler } of this.handlers) {
        if (selector === 'head' && handler.element) {
          handler.element({
            append(content) {
              html = html.replace('</head>', `${content}</head>`);
            },
          });
        }
      }
      return new Response(html, { headers: res.headers });
    }
  };

  const context = {
    request: new Request('https://anihubstream.com/watch/frieren-beyond-journey-s-end'),
    next: async () => new Response('<!doctype html><html><head><title>Default</title><meta name="description" content="Default"></head><body>SPA</body></html>', {
      headers: { 'content-type': 'text/html' },
    }),
    env: { ANIHUB: mockD1 },
  };

  const res = await onRequest(context);
  const html = await res.text();

  assert.ok(html.includes('"@type":"TVSeries"'), 'Must inject TVSeries JSON-LD');
  assert.ok(html.includes('"name":"Frieren: Beyond Journey\'s End"'));
  assert.ok(html.includes('"ratingValue":9.1'));
  assert.ok(html.includes('"numberOfEpisodes":28'));
});

test('TASK 5 (P1) SEO: _middleware injects episode metadata and TVEpisode JSON-LD', async () => {
  const animeRecord = {
    title: 'Frieren: Beyond Journey\'s End',
    native: '葬送のフリーレン',
    year: 2023,
    rating: 9.1,
    synopsis: 'Frieren meets Fern and continues her journey.',
    art: 'https://media.kitsu.app/frieren-poster.jpg',
    key_art: 'https://media.kitsu.app/frieren-banner.jpg',
    episode_total: 28,
    kind: 'tv',
  };

  const mockD1 = {
    prepare: (query) => ({
      bind: (slug) => ({
        first: async () => animeRecord,
      }),
    }),
  };

  const context = {
    request: new Request('https://anihubstream.com/watch/frieren-beyond-journey-s-end/4'),
    next: async () => new Response('<!doctype html><html><head><title>Default</title><meta name="description" content="Default"></head><body>SPA</body></html>', {
      headers: { 'content-type': 'text/html' },
    }),
    env: { ANIHUB: mockD1 },
  };

  const res = await onRequest(context);
  const html = await res.text();

  assert.ok(html.includes('"@type":"TVEpisode"'), 'Must inject TVEpisode JSON-LD');
  assert.ok(html.includes('"episodeNumber":4'));
  assert.ok(html.includes('"url":"https://anihubstream.com/watch/frieren-beyond-journey-s-end/4"'));
  assert.ok(html.includes('"@type":"BreadcrumbList"'), 'Must inject BreadcrumbList JSON-LD');
});

test('TASK 5 (P1) SEO: episode 1 receives dedicated Episode 1 title, canonical, and TVEpisode JSON-LD', async () => {
  const animeRecord = {
    title: '5 Centimeters per Second',
    year: 2007,
    rating: 8.5,
    synopsis: 'A tale of two people who were close friends.',
    art: 'https://media.kitsu.app/5cm-poster.jpg',
    key_art: 'https://media.kitsu.app/5cm-banner.jpg',
    episode_total: 3,
    kind: 'movie',
  };

  const mockD1 = {
    prepare: (query) => ({
      bind: (slug) => ({
        first: async () => animeRecord,
      }),
    }),
  };

  let titleSet = '';
  let canonicalSet = '';
  globalThis.HTMLRewriter = class MockHTMLRewriter {
    constructor() {
      this.handlers = [];
    }
    on(selector, handler) {
      this.handlers.push({ selector, handler });
      return this;
    }
    async transform(res) {
      let html = await res.text();
      for (const { selector, handler } of this.handlers) {
        if (selector === 'title' && handler.element) {
          handler.element({
            setInnerContent(t) {
              titleSet = t;
            },
          });
        }
        if (selector === 'link[rel="canonical"]' && handler.element) {
          handler.element({
            setAttribute(k, v) {
              if (k === 'href') canonicalSet = v;
            },
          });
        }
        if (selector === 'head' && handler.element) {
          handler.element({
            append(content) {
              html = html.replace('</head>', `${content}</head>`);
            },
          });
        }
      }
      return new Response(html, { headers: res.headers });
    }
  };

  const context = {
    request: new Request('https://anihubstream.com/watch/5-centimeters-per-second/1'),
    next: async () => new Response('<!doctype html><html><head><title>Default</title><link rel="canonical" href="default"></head><body>SPA</body></html>', {
      headers: { 'content-type': 'text/html' },
    }),
    env: { ANIHUB: mockD1 },
  };

  const res = await onRequest(context);
  assert.equal(titleSet, '5 Centimeters per Second Ep 1 — Watch Free | AniHubStream');
  assert.equal(canonicalSet, 'https://anihubstream.com/watch/5-centimeters-per-second/1');
  const html = await res.text();
  assert.ok(html.includes('"@type":"TVEpisode"'), 'Episode 1 must be TVEpisode');
  assert.ok(html.includes('"episodeNumber":1'));
});

test('TASK 5 (P1) SEO: security headers file includes HSTS and Permissions-Policy', () => {
  const headersPath = path.resolve(process.cwd(), 'public/_headers');
  assert.ok(fs.existsSync(headersPath), '_headers must exist');
  const content = fs.readFileSync(headersPath, 'utf8');

  assert.match(content, /Strict-Transport-Security:\s*max-age=31536000/i, 'Must configure HSTS max-age=31536000');
  assert.match(content, /Permissions-Policy:/i, 'Must configure Permissions-Policy');
});

test('TASK 5 (P1) SEO: robots.txt disallows /mylist to prevent crawling empty user history', () => {
  const robotsPath = path.resolve(process.cwd(), 'public/robots.txt');
  const content = fs.readFileSync(robotsPath, 'utf8');
  assert.match(content, /Disallow:\s*\/mylist/i, 'robots.txt must disallow /mylist');
});

