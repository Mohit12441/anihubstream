// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet as feedHandler } from '../functions/feed.xml.js';

test('RSS 2.0 Feed Generator: produces valid XML with items and proper MIME headers', async () => {
  const mockReq = new Request('https://anihubstream.com/feed.xml');
  const mockEnv = {
    ANIHUB: {
      prepare: () => ({
        all: async () => ({
          results: [
            {
              id: 'frieren-beyond-journeys-end',
              title: 'Frieren: Beyond Journey\'s End',
              title_english: 'Frieren: Beyond Journey\'s End',
              description: 'An elf mage on a journey to the northern reaches.',
              poster: 'https://media.kitsu.app/frieren.jpg',
              banner: 'https://media.kitsu.app/frieren-banner.jpg',
              episode_total: 28,
              year: 2023,
              season: 'fall',
              genres: 'Adventure,Fantasy',
              added_at: 1700000000000,
            },
            {
              id: 'solo-leveling-season-2',
              title: 'Solo Leveling Season 2',
              title_english: 'Solo Leveling: Arise from the Shadow',
              description: 'Sung Jinwoo ascends as the Shadow Monarch.',
              poster: 'https://media.kitsu.app/solo.jpg',
              added_at: 1710000000000,
            },
          ],
        }),
      }),
    },
  };

  const res = await feedHandler({ request: mockReq, env: mockEnv });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /application\/rss\+xml/);
  assert.match(res.headers.get('cache-control') || '', /public/);

  const xml = await res.text();
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'), 'Must start with XML declaration');
  assert.ok(xml.includes('<rss version="2.0"'), 'Must have RSS 2.0 root tag');
  assert.ok(xml.includes('<channel>'), 'Must have channel tag');
  assert.ok(xml.includes('<title>AniHubStream'), 'Channel title must match AniHubStream');
  assert.ok(xml.includes('<link>https://anihubstream.com</link>'), 'Channel link must match domain');
  assert.ok(xml.includes('<item>'), 'Must contain items');
  assert.ok(xml.includes('https://anihubstream.com/watch/frieren-beyond-journeys-end/1'), 'Item link must point to watch episode');
  assert.ok(xml.includes('https://anihubstream.com/anime/frieren-beyond-journeys-end'), 'Item guid must point to canonical anime page');
  assert.ok(xml.includes('Solo Leveling: Arise from the Shadow'), 'English title preferred if present');
  assert.ok(xml.includes('</channel>'));
  assert.ok(xml.endsWith('</rss>'));
});

test('RSS 2.0 Feed Generator: recovers cleanly with fallback items when D1 is offline', async () => {
  const mockReq = new Request('https://anihubstream.com/feed.xml?test_mode=fallback');
  const mockEnv = {}; // No database binding

  const res = await feedHandler({ request: mockReq, env: mockEnv });
  assert.equal(res.status, 200);
  const xml = await res.text();
  assert.ok(xml.includes('<item>'));
  assert.ok(xml.includes('Frieren'));
});
