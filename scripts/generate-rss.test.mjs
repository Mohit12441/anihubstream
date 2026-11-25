// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { generateRss, escapeXml } from './generate-rss.mjs';

test('rss: escapeXml handles special XML characters properly', () => {
  assert.equal(escapeXml('Attack on Titan & Demon Slayer <Movie>'), 'Attack on Titan &amp; Demon Slayer &lt;Movie&gt;');
  assert.equal(escapeXml('"Quotes" and \'Apostrophes\''), '&quot;Quotes&quot; and &apos;Apostrophes&apos;');
  assert.equal(escapeXml(null), '');
  assert.equal(escapeXml(undefined), '');
});

test('rss: generates valid RSS XML with channel and items', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anihub-rss-test-'));
  const catalogDir = path.join(tmpDir, 'catalog');
  const outDir = path.join(tmpDir, 'public');

  fs.mkdirSync(catalogDir, { recursive: true });

  // Create 2 mock catalog records
  fs.writeFileSync(
    path.join(catalogDir, 'solo-leveling.json'),
    JSON.stringify({
      id: 'solo-leveling',
      title: 'Solo Leveling',
      year: 2024,
      status: 'Currently Airing',
      kind: 'TV',
      rating: 8.9,
      trend_rank: 1,
      synopsis: 'Sung Jinwoo ascends from E-rank hunter to shadow monarch.',
      genres: ['Action', 'Fantasy'],
    })
  );

  fs.writeFileSync(
    path.join(catalogDir, 'demon-slayer-kimetsu-no-yaiba.json'),
    JSON.stringify({
      id: 'demon-slayer-kimetsu-no-yaiba',
      title: 'Retired Demon Slayer',
    })
  );

  try {
    const count = generateRss({ catalogDir, outDir, limit: 10 });
    assert.equal(count, 1, 'Retired slug should be filtered out');

    const rssContent = fs.readFileSync(path.join(outDir, 'rss.xml'), 'utf8');
    const feedContent = fs.readFileSync(path.join(outDir, 'feed.xml'), 'utf8');

    assert.equal(rssContent, feedContent, 'rss.xml and feed.xml should be identical mirrors');
    assert.ok(rssContent.includes('<title>AniHubStream — Watch Anime Online Free in HD</title>'));
    assert.ok(rssContent.includes('<link>https://anihubstream.com/anime/solo-leveling</link>'));
    assert.ok(rssContent.includes('<guid isPermaLink="true">https://anihubstream.com/anime/solo-leveling</guid>'));
    assert.ok(rssContent.includes('<category>Action</category>'));
    assert.ok(rssContent.includes('<category>Fantasy</category>'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
