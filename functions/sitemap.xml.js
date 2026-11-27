// functions/sitemap.xml.js
// Generates a live XML sitemap dynamically from the Cloudflare D1 database.
// Caches at the edge for 24 hours.
import { withEdgeCache } from './api/_lib.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const origin = request?.url ? new URL(request.url).origin : 'https://anihubstream.com';

  if (env?.ASSETS) {
    try {
      const assetRes = await env.ASSETS.fetch(new URL('/sitemap.xml', origin));
      if (assetRes && assetRes.status === 200) {
        return assetRes;
      }
    } catch {}
  }

  return withEdgeCache(request, env, 3600, async () => {
    const now = new Date().toISOString().slice(0, 10);

  const staticUrls = [
    { loc: `${origin}/` },
    { loc: `${origin}/anime` },
    { loc: `${origin}/genres` },
    { loc: `${origin}/schedule` },
    { loc: `${origin}/discover` },
    { loc: `${origin}/news` },
    { loc: `${origin}/about` },
    { loc: `${origin}/dmca` },
    { loc: `${origin}/privacy` },
    { loc: `${origin}/terms` },
    { loc: `${origin}/contact` },
  ];

  const newsUrls = [
    { loc: `${origin}/news/spring-2026-anime-season-guide`, lastmod: '2026-03-20' },
    { loc: `${origin}/news/top-10-dark-fantasy-anime-masterpieces`, lastmod: '2026-03-15' },
    { loc: `${origin}/news/solo-leveling-reawakening-complete-guide`, lastmod: '2026-03-08' },
    { loc: `${origin}/news/best-isekai-anime-ranked-by-worldbuilding`, lastmod: '2026-02-28' },
    { loc: `${origin}/news/top-10-psychological-thriller-anime-ranked`, lastmod: now },
    { loc: `${origin}/news/best-sci-fi-cyberpunk-anime-ranked`, lastmod: now },
    { loc: `${origin}/news/top-must-watch-romance-anime-emotional-payoff`, lastmod: now },
    { loc: `${origin}/news/ultimate-shonen-battle-anime-tier-list`, lastmod: now },
    { loc: `${origin}/news/studio-mappa-best-anime-ranked`, lastmod: now },
    { loc: `${origin}/news/ufotable-best-anime-ranked`, lastmod: now },
    { loc: `${origin}/news/top-10-sports-anime-hype-adrenaline`, lastmod: now },
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
        });
      }
    } catch (e) {
      console.error('Failed to generate dynamic sitemap entries:', e);
    }
  }

  const allUrls = [...staticUrls, ...newsUrls, ...animeUrls];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${allUrls
  .map(
    (u) => `  <url>
    <loc>${u.loc}</loc>
    ${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : `<lastmod>${now}</lastmod>`}
  </url>`
  )
  .join('\n')}
</urlset>`;

    return new Response(xml, {
      status: 200,
      headers: {
        'content-type': 'application/xml; charset=utf-8',
        'cache-control': 'public, max-age=3600, s-maxage=3600',
      },
    });
  });
}
