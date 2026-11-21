// @ts-check
/**
 * functions/feed.xml.js
 * Generates an automated RSS 2.0 / Atom syndication feed for AniHubStream.
 * Drives external search engine discovery, RSS aggregators, and authoritative backlinks.
 * Cached at the Cloudflare Edge for 1 hour.
 */
import { withEdgeCache } from './api/_lib.js';

export async function onRequestGet(context) {
  const { request, env } = context;

  return withEdgeCache(request, env, 3600, async () => {
    const origin = request?.url ? new URL(request.url).origin : 'https://anihubstream.com';
    const nowRfc822 = new Date().toUTCString();

    let items = [];

    if (env?.ANIHUB) {
      try {
        const { results } = await env.ANIHUB.prepare(
          `SELECT id, title, title_english, description, poster, banner, episode_total, year, season, genres, added_at 
           FROM anime 
           ORDER BY COALESCE(trend_rank, 9999) ASC, added_at DESC 
           LIMIT 40`
        ).all();

        if (Array.isArray(results) && results.length > 0) {
          items = results;
        }
      } catch (err) {
        // Fallback to static items if D1 query fails
      }
    }

    // Static fallback items if database is empty or offline
    if (items.length === 0) {
      items = [
        {
          id: 'solo-leveling-season-2-arise-from-the-shadow',
          title: 'Solo Leveling Season 2: Arise from the Shadow',
          description: 'Follow Sung Jinwoo on his journey as the Shadow Monarch with multi-server streaming on AniHubStream.',
          year: 2025,
          poster: 'https://media.kitsu.app/anime/poster_images/48532/medium.jpg',
        },
        {
          id: 'frieren-beyond-journeys-end',
          title: 'Frieren: Beyond Journey\'s End',
          description: 'An elf mage and her companions journey across the continent to reach the resting place of souls.',
          year: 2024,
          poster: 'https://media.kitsu.app/anime/poster_images/46474/medium.jpg',
        },
        {
          id: 'demon-slayer-kimetsu-no-yaiba-infinity-castle',
          title: 'Demon Slayer: Kimetsu no Yaiba - Infinity Castle',
          description: 'The Demon Slayer Corps plunges into the Infinity Castle for the final confrontation with Muzan Kibutsuji.',
          year: 2025,
          poster: 'https://media.kitsu.app/anime/poster_images/48625/medium.jpg',
        },
      ];
    }

    const itemsXml = items.map((anime) => {
      const animeTitle = escapeXml(anime.title_english || anime.title || anime.id);
      const animeDesc = escapeXml(anime.description || `Watch ${animeTitle} in HD with English subtitles and dubbing on AniHubStream.`);
      const animeUrl = `${origin}/anime/${anime.id}`;
      const watchUrl = `${origin}/watch/${anime.id}/1`;
      const posterUrl = anime.poster || anime.banner || `${origin}/og.png`;
      const pubDate = anime.added_at ? new Date(anime.added_at).toUTCString() : nowRfc822;

      return `    <item>
      <title><![CDATA[${animeTitle}]]></title>
      <link>${watchUrl}</link>
      <guid isPermaLink="true">${animeUrl}</guid>
      <description><![CDATA[${animeDesc}]]></description>
      <pubDate>${pubDate}</pubDate>
      <category>Anime</category>
      <enclosure url="${posterUrl}" type="image/jpeg" length="0" />
      <source url="${origin}/feed.xml">AniHubStream</source>
    </item>`;
    }).join('\n');

    const rssXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>AniHubStream — Latest Anime Series, Episodes &amp; Movies</title>
    <link>${origin}</link>
    <description>Stream thousands of anime series and movies with real-time metadata, synchronized Watch Party, and multi-server HD streaming.</description>
    <language>en-us</language>
    <lastBuildDate>${nowRfc822}</lastBuildDate>
    <atom:link href="${origin}/feed.xml" rel="self" type="application/rss+xml" />
    <image>
      <url>${origin}/og.png</url>
      <title>AniHubStream</title>
      <link>${origin}</link>
    </image>
${itemsXml}
  </channel>
</rss>`;

    return new Response(rssXml, {
      status: 200,
      headers: {
        'content-type': 'application/rss+xml; charset=utf-8',
        'cache-control': 'public, max-age=3600, s-maxage=3600',
        'x-content-type-options': 'nosniff',
      },
    });
  });
}

function escapeXml(unsafe) {
  if (!unsafe) return '';
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
