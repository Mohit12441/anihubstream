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
  assert.ok(xml.includes('https://anihubstream.com/watch/sousou-no-frieren'), 'Canonical sousou-no-frieren must be present');
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
});
