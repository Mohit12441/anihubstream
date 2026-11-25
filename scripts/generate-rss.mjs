// @ts-check
import fs from 'node:fs';
import path from 'node:path';

const ORIGIN = 'https://anihubstream.com';
const RETIRED_SLUGS = new Set([
  'demon-slayer-kimetsu-no-yaiba',
  'frieren-beyond-journey-s-end',
  'tokyo-revengers-war-of-the-three-titans-arc',
  'blue-box-season-2',
  'the-apothecary-diaries-season-3',
  'cyberpunk-edgerunners-2',
  'the-laid-off-cheat-granting-mage-enjoys-a-second-lease-on',
]);

/**
 * Escapes characters for XML safely
 * @param {unknown} val
 * @returns {string}
 */
export function escapeXml(val) {
  return String(val || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Generates valid RSS 2.0 and Atom feeds for anime series and episode updates
 * @param {object} [options]
 * @param {string} [options.catalogDir]
 * @param {string} [options.outDir]
 * @param {number} [options.limit]
 * @returns {number} Count of items written to feed
 */
export function generateRss(options = {}) {
  const catalogDir = options.catalogDir || path.resolve('data/catalog');
  const outDir = options.outDir || path.resolve('public');
  const limit = options.limit || 60;

  const items = [];

  if (fs.existsSync(catalogDir)) {
    const files = fs.readdirSync(catalogDir);
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const slug = file.slice(0, -5);
      if (RETIRED_SLUGS.has(slug)) continue;

      try {
        const fullPath = path.join(catalogDir, file);
        const data = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
        items.push({
          id: data.id || slug,
          title: data.title || slug,
          native: data.native || '',
          year: data.year || 0,
          status: data.status || 'Finished',
          kind: data.kind || 'TV',
          rating: typeof data.rating === 'number' ? data.rating : 0,
          trendRank: typeof data.trend_rank === 'number' ? data.trend_rank : 9999,
          synopsis: data.synopsis || '',
          art: data.key_art || data.art || '',
          genres: Array.isArray(data.genres) ? data.genres : [],
          episodesCount: Array.isArray(data.episodes) ? data.episodes.length : (data.episode_total || 0),
        });
      } catch {}
    }
  }

  // Sort strategy:
  // 1. Ongoing / Currently Airing first
  // 2. Trend rank ascending (1 = top)
  // 3. Year descending, then rating descending
  items.sort((a, b) => {
    const aAiring = a.status.toLowerCase().includes('airing') ? 1 : 0;
    const bAiring = b.status.toLowerCase().includes('airing') ? 1 : 0;
    if (aAiring !== bAiring) return bAiring - aAiring;

    if (a.trendRank !== b.trendRank) return a.trendRank - b.trendRank;
    if (a.year !== b.year) return b.year - a.year;
    return b.rating - a.rating;
  });

  const selected = items.slice(0, limit);
  const nowRfc822 = new Date().toUTCString();

  const xmlItems = selected.map((item) => {
    const itemUrl = `${ORIGIN}/anime/${item.id}`;
    const cleanDesc = escapeXml(item.synopsis ? item.synopsis.slice(0, 300) + '...' : `Watch ${item.title} free in HD on AniHubStream.`);
    const cleanTitle = escapeXml(`${item.title} (${item.kind}) - Watch Online Free`);
    const genresXml = item.genres.map(g => `      <category>${escapeXml(g)}</category>`).join('\n');
    const imageTag = item.art ? `\n      <enclosure url="${escapeXml(item.art)}" type="image/jpeg" length="0" />` : '';

    return `    <item>
      <title>${cleanTitle}</title>
      <link>${itemUrl}</link>
      <guid isPermaLink="true">${itemUrl}</guid>
      <pubDate>${nowRfc822}</pubDate>
      <description>${cleanDesc}</description>${genresXml ? '\n' + genresXml : ''}${imageTag}
    </item>`;
  });

  const rssXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>AniHubStream — Watch Anime Online Free in HD</title>
    <link>${ORIGIN}</link>
    <description>Latest anime releases, episodes, and complete series streaming in high definition with fast playback and zero intrusive popups.</description>
    <language>en-us</language>
    <lastBuildDate>${nowRfc822}</lastBuildDate>
    <atom:link href="${ORIGIN}/rss.xml" rel="self" type="application/rss+xml" />
    <atom:link href="${ORIGIN}/feed.xml" rel="alternate" type="application/rss+xml" />
${xmlItems.join('\n')}
  </channel>
</rss>
`;

  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const rssPath = path.join(outDir, 'rss.xml');
  const feedPath = path.join(outDir, 'feed.xml');

  fs.writeFileSync(rssPath, rssXml, 'utf8');
  fs.writeFileSync(feedPath, rssXml, 'utf8');

  console.log(`✅ Generated RSS feed with ${selected.length} items at ${rssPath} and ${feedPath}`);
  return selected.length;
}

// Auto-run if executed directly
const isDirectRun = Boolean(
  process.argv[1] &&
  (process.argv[1].endsWith('generate-rss.mjs') || process.argv[1].endsWith('generate-rss'))
);

if (isDirectRun) {
  generateRss();
}
