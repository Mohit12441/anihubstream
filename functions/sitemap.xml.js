// functions/sitemap.xml.js
// Generates a live XML sitemap dynamically from the Cloudflare D1 database.
// Caches at the edge for 24 hours.

export async function onRequestGet({ env }) {
  const origin = 'https://anihubstream.com';
  const now = new Date().toISOString().slice(0, 10);

  const staticUrls = [
    { loc: `${origin}/`, priority: '1.0', changefreq: 'daily' },
    { loc: `${origin}/anime`, priority: '0.9', changefreq: 'daily' },
    { loc: `${origin}/genres`, priority: '0.8', changefreq: 'weekly' },
    { loc: `${origin}/schedule`, priority: '0.8', changefreq: 'daily' },
    { loc: `${origin}/discover`, priority: '0.7', changefreq: 'daily' },
    { loc: `${origin}/about`, priority: '0.5', changefreq: 'monthly' },
    { loc: `${origin}/dmca`, priority: '0.3', changefreq: 'monthly' },
    { loc: `${origin}/privacy`, priority: '0.3', changefreq: 'monthly' },
    { loc: `${origin}/terms`, priority: '0.3', changefreq: 'monthly' },
    { loc: `${origin}/contact`, priority: '0.4', changefreq: 'monthly' },
  ];

  let animeUrls = [];

  if (env.ANIHUB) {
    try {
      const { results } = await env.ANIHUB.prepare(
        `SELECT id, added_at, episode_total FROM anime ORDER BY id ASC`
      ).all();

      const RETIRED_SLUGS = new Set([
        'demon-slayer-kimetsu-no-yaiba',
        'frieren-beyond-journey-s-end',
        'tokyo-revengers-war-of-the-three-titans-arc',
        'blue-box-season-2',
        'the-apothecary-diaries-season-3',
        'cyberpunk-edgerunners-2',
        'the-laid-off-cheat-granting-mage-enjoys-a-second-lease-on',
      ]);

      for (const row of results || []) {
        if (RETIRED_SLUGS.has(row.id)) continue;
        const lastmod = row.added_at ? String(row.added_at).slice(0, 10) : now;

        // 1. Primary canonical Anime Overview & SEO Landing Page
        animeUrls.push({
          loc: `${origin}/anime/${row.id}`,
          lastmod,
          changefreq: 'weekly',
          priority: '0.9',
        });

        // 2. Canonical Player Entry Page
        animeUrls.push({
          loc: `${origin}/watch/${row.id}`,
          lastmod,
          changefreq: 'weekly',
          priority: '0.8',
        });

        // 3. Key watchable episode deep links (capped to maintain total sitemap below Google 50k limit)
        const total = Number.isInteger(row.episode_total) && row.episode_total > 0
          ? Math.min(row.episode_total, 24)
          : 0;
        for (let ep = 1; ep <= total; ep++) {
          animeUrls.push({
            loc: `${origin}/watch/${row.id}/${ep}`,
            lastmod,
            changefreq: 'monthly',
            priority: '0.6',
          });
        }
      }
    } catch (e) {
      console.error('Failed to generate dynamic sitemap entries:', e);
    }
  }

  const allUrls = [...staticUrls, ...animeUrls];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${allUrls
  .map(
    (u) => `  <url>
    <loc>${u.loc}</loc>
    ${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`
  )
  .join('\n')}
</urlset>`;

  return new Response(xml, {
    status: 200,
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=3600, s-maxage=86400',
    },
  });
}
