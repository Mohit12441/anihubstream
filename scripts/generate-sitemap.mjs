// @ts-check
import fs from 'node:fs';
import path from 'node:path';

const ORIGIN = 'https://anihubstream.com';
const TODAY = new Date().toISOString().slice(0, 10);

const RETIRED_SLUGS = new Set([
  'demon-slayer-kimetsu-no-yaiba',
  'frieren-beyond-journey-s-end',
  'tokyo-revengers-war-of-the-three-titans-arc',
  'blue-box-season-2',
  'the-apothecary-diaries-season-3',
  'cyberpunk-edgerunners-2',
  'the-laid-off-cheat-granting-mage-enjoys-a-second-lease-on',
]);

const staticPages = [
  { loc: `${ORIGIN}/` },
  { loc: `${ORIGIN}/anime` },
  { loc: `${ORIGIN}/genres` },
  { loc: `${ORIGIN}/schedule` },
  { loc: `${ORIGIN}/discover` },
  { loc: `${ORIGIN}/news` },
  { loc: `${ORIGIN}/about` },
  { loc: `${ORIGIN}/dmca` },
  { loc: `${ORIGIN}/privacy` },
  { loc: `${ORIGIN}/terms` },
  { loc: `${ORIGIN}/contact` },
];

export function generateSitemap() {
  const catalogDir = path.resolve('data/catalog');
  let animeIds = [];

  if (fs.existsSync(catalogDir)) {
    const files = fs.readdirSync(catalogDir);
    for (const f of files) {
      if (f.endsWith('.json')) {
        const id = f.slice(0, -5);
        if (!RETIRED_SLUGS.has(id)) {
          animeIds.push(id);
        }
      }
    }
  } else {
    // Fallback to manifest.json if catalog folder not present
    const manifestPath = path.resolve('data/manifest.json');
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      for (const k of Object.keys(manifest.files || {})) {
        if (k.startsWith('catalog/') && k.endsWith('.json')) {
          const id = k.slice('catalog/'.length, -5);
          if (!RETIRED_SLUGS.has(id)) {
            animeIds.push(id);
          }
        }
      }
    }
  }

  animeIds.sort((a, b) => a.localeCompare(b));

  // Load curated editorial guides
  const newsEntries = [];
  const editorialPath = path.resolve('data/news/editorial.json');
  if (fs.existsSync(editorialPath)) {
    try {
      const editorials = JSON.parse(fs.readFileSync(editorialPath, 'utf8'));
      if (Array.isArray(editorials)) {
        for (const item of editorials) {
          if (item.slug) {
            newsEntries.push({ slug: item.slug, date: item.date || TODAY });
          }
        }
      }
    } catch {}
  }
  if (newsEntries.length === 0) {
    newsEntries.push(
      { slug: 'weekly-anime-power-rankings-top-trending', date: TODAY },
      { slug: '6-anime-that-leave-you-thinking-long-after-they-end', date: TODAY },
      { slug: 'anime-season-broadcast-guide-airing-schedules', date: TODAY },
      { slug: 'top-10-dark-fantasy-anime-masterpieces', date: TODAY },
      { slug: 'solo-leveling-reawakening-complete-guide', date: TODAY },
      { slug: 'best-isekai-anime-ranked-by-worldbuilding', date: TODAY }
    );
  }

  const newsFeedPath = path.resolve('data/news/feed.json');
  if (fs.existsSync(newsFeedPath)) {
    try {
      const feed = JSON.parse(fs.readFileSync(newsFeedPath, 'utf8'));
      if (Array.isArray(feed)) {
        for (const item of feed) {
          if (item.slug && !newsEntries.some(e => e.slug === item.slug)) {
            const date = item.publishedAt ? String(item.publishedAt).slice(0, 10) : TODAY;
            newsEntries.push({ slug: item.slug, date });
          }
        }
      }
    } catch {}
  }

  const urls = [
    ...staticPages.map(p => `  <url>
    <loc>${p.loc}</loc>
    <lastmod>${TODAY}</lastmod>
  </url>`),
    ...newsEntries.map(n => `  <url>
    <loc>${ORIGIN}/news/${n.slug}</loc>
    <lastmod>${n.date}</lastmod>
  </url>`),
    ...animeIds.map(id => `  <url>
    <loc>${ORIGIN}/anime/${id}</loc>
    <lastmod>${TODAY}</lastmod>
  </url>`),
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>
`;

  const outPath = path.resolve('public/sitemap.xml');
  fs.writeFileSync(outPath, xml, 'utf8');
  console.log(`✅ Generated clean sitemap with ${urls.length} URLs (7 static + ${animeIds.length} canonical anime pages) at ${outPath}`);
  return urls.length;
}

if (process.argv[1] && process.argv[1].endsWith('generate-sitemap.mjs')) {
  generateSitemap();
}
