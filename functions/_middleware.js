import { onRequestGet as sitemapHandler } from './sitemap.xml.js';
import { onRequestGet as feedHandler } from './feed.xml.js';

export async function onRequest(context) {
  const { request, next, env } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === '/sitemap.xml') {
    return sitemapHandler(context);
  }

  if (path === '/feed.xml' || path === '/rss.xml') {
    return feedHandler(context);
  }

  if (path === '/robots.txt') {
    const robots = [
      'User-agent: *',
      'Allow: /',
      'Allow: /anime',
      'Allow: /watch',
      'Allow: /embed',
      'Allow: /feed.xml',
      'Allow: /rss.xml',
      'Allow: /api/anime',
      'Allow: /api/genres',
      'Allow: /api/home',
      'Allow: /api/schedule',
      'Allow: /api/stats',
      'Allow: /api/search',
      'Allow: /api/img',
      'Allow: /news',
      'Disallow: /search',
      'Disallow: /*?s=',
      'Disallow: /*?genre=',
      'Disallow: /*?status=',
      'Disallow: /*?format=',
      'Disallow: /*?sort=',
      'Disallow: /api/',
      'Disallow: /mylist',
      'Disallow: /my-list',
      'Disallow: /watchlist',
      '',
      'User-agent: GPTBot',
      'Allow: /',
      'Allow: /anime',
      'Allow: /watch',
      'Allow: /api/anime',
      'Allow: /api/genres',
      'Allow: /api/home',
      'Allow: /api/schedule',
      'Allow: /api/stats',
      'Allow: /api/search',
      'Disallow: /api/',
      'Disallow: /mylist',
      '',
      'User-agent: ChatGPT-User',
      'Allow: /',
      'Allow: /anime',
      'Allow: /watch',
      'Allow: /api/anime',
      'Allow: /api/genres',
      'Allow: /api/home',
      'Allow: /api/schedule',
      'Allow: /api/stats',
      'Allow: /api/search',
      'Disallow: /api/',
      'Disallow: /mylist',
      '',
      'User-agent: ClaudeBot',
      'Allow: /',
      'Allow: /anime',
      'Allow: /watch',
      'Allow: /api/anime',
      'Allow: /api/genres',
      'Allow: /api/home',
      'Allow: /api/schedule',
      'Allow: /api/stats',
      'Allow: /api/search',
      'Disallow: /api/',
      'Disallow: /mylist',
      '',
      'User-agent: PerplexityBot',
      'Allow: /',
      'Allow: /anime',
      'Allow: /watch',
      'Allow: /api/anime',
      'Allow: /api/genres',
      'Allow: /api/home',
      'Allow: /api/schedule',
      'Allow: /api/stats',
      'Allow: /api/search',
      'Disallow: /api/',
      'Disallow: /mylist',
      '',
      'User-agent: Google-Extended',
      'Allow: /',
      'Allow: /anime',
      'Allow: /watch',
      'Allow: /api/anime',
      'Allow: /api/genres',
      'Allow: /api/home',
      'Allow: /api/schedule',
      'Allow: /api/stats',
      'Allow: /api/search',
      'Allow: /news',
      'Disallow: /api/',
      'Disallow: /mylist',
      '',
      'User-agent: OAI-SearchBot',
      'Allow: /',
      'Allow: /anime',
      'Allow: /watch',
      'Allow: /news',
      'Allow: /api/anime',
      'Allow: /api/home',
      'Allow: /api/schedule',
      'Allow: /api/search',
      'Disallow: /api/',
      'Disallow: /mylist',
      '',
      'User-agent: Perplexity-User',
      'Allow: /',
      'Allow: /anime',
      'Allow: /watch',
      'Allow: /news',
      'Allow: /api/anime',
      'Allow: /api/home',
      'Allow: /api/schedule',
      'Allow: /api/search',
      'Disallow: /api/',
      'Disallow: /mylist',
      '',
      'User-agent: Bingbot',
      'Allow: /',
      'Allow: /anime',
      'Allow: /watch',
      'Allow: /news',
      'Allow: /api/anime',
      'Allow: /api/home',
      'Allow: /api/schedule',
      'Allow: /api/search',
      'Disallow: /api/',
      'Disallow: /mylist',
      '',
      'User-agent: Applebot-Extended',
      'Allow: /',
      'Allow: /anime',
      'Allow: /watch',
      'Allow: /news',
      'Allow: /api/anime',
      'Allow: /api/home',
      'Allow: /api/schedule',
      'Allow: /api/search',
      'Disallow: /api/',
      'Disallow: /mylist',
      '',
      'User-agent: meta-externalagent',
      'Allow: /',
      'Allow: /anime',
      'Allow: /watch',
      'Allow: /news',
      'Allow: /api/anime',
      'Allow: /api/home',
      'Allow: /api/schedule',
      'Allow: /api/search',
      'Disallow: /api/',
      'Disallow: /mylist',
      '',
      `Sitemap: ${url.origin}/sitemap.xml`,
      `Sitemap: ${url.origin}/sitemap-news.xml`,
    ].join('\n');
    return new Response(robots, {
      status: 200,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'public, max-age=300, s-maxage=300',
      },
    });
  }

  // IndexNow verification key endpoint
  if (path === '/9f8b2c4e1a7d3f5b8a0c6e4d2f1a9b7c.txt') {
    return new Response('9f8b2c4e1a7d3f5b8a0c6e4d2f1a9b7c', {
      status: 200,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'public, max-age=86400, s-maxage=604800',
      },
    });
  }

  // Static assets, api routes, and dedicated function routes pass through untouched
  if (
    path.startsWith('/api/') ||
    path === '/api' ||
    path.startsWith('/art/') ||
    path.startsWith('/assets/') ||
    path.startsWith('/anime/') ||
    path.endsWith('.js') ||
    path.endsWith('.css') ||
    path.endsWith('.png') ||
    path.endsWith('.jpg') ||
    path.endsWith('.jpeg') ||
    path.endsWith('.webp') ||
    path.endsWith('.avif') ||
    path.endsWith('.svg') ||
    path.endsWith('.ico') ||
    path.endsWith('.webmanifest') ||
    path.endsWith('.txt')
  ) {
    if (path.startsWith('/api/') || path === '/api') {
      const apiRes = await next();
      const apiHeaders = new Headers(apiRes.headers);
      apiHeaders.set('X-Robots-Tag', 'noindex, nofollow');
      return new Response(apiRes.body, {
        status: apiRes.status,
        statusText: apiRes.statusText,
        headers: apiHeaders,
      });
    }
    return next();
  }

  // High-performance edge cache check for public HTML routes:
  // Delivers pre-rewritten HTML from edge memory in <15ms without touching D1 or HTMLRewriter
  const hasCloudflareCache = typeof caches !== 'undefined' && caches.default;
  const isGetOrHead = request.method === 'GET' || request.method === 'HEAD';
  const hasUserSession = Boolean(request.headers.get('cookie')?.includes('anihub_session'));
  const isPublicHtmlRoute = isGetOrHead && !hasUserSession && !url.searchParams.has('bypass');

  if (hasCloudflareCache && isPublicHtmlRoute) {
    try {
      const cached = await caches.default.match(request);
      if (cached) {
        return cached;
      }
    } catch (_) {}
  }

  // Let Pages serve the static index.html or route asset
  const response = await next();
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) {
    return response;
  }

  const origin = url.origin || 'https://anihubstream.com';
  let title = 'AniHubStream — Watch Anime Free Anytime, Anywhere';
  let desc = 'Watch high-quality anime online free on AniHubStream. Stream subbed and dubbed anime with fast playback, clean schedules, and full episode guides.';
  let canonical = `${origin}${path}`;
  let ogImage = `${origin}/og.png`;
  let ogType = 'website';
  let jsonLd = null;
  let preHtml = null;

  // Match /watch/:id or /watch/:id/:ep
  const watchMatch = path.match(/^\/watch\/([A-Za-z0-9_-]+)(?:\/(\d+))?$/);
  // Match /anime/:id (Detail page)
  const animeMatch = path.match(/^\/anime\/([A-Za-z0-9_-]+)$/);

  if (watchMatch || animeMatch) {
    const id = watchMatch ? watchMatch[1] : animeMatch[1];
    const epNum = watchMatch && watchMatch[2] ? Number(watchMatch[2]) : null;

    if (env.ANIHUB) {
      try {
      // STEP 1 — Direct canonical lookup
      let row = await env.ANIHUB.prepare(
        `SELECT title, native, year, rating, synopsis, art, key_art, episode_total, kind FROM anime WHERE id = ?1`
      ).bind(id).first();

      // STEP 2 — If not canonical, try alternate ID resolutions
      let resolvedId = null;

      if (!row) {
        // Try anime_redirect (deleted slug → canonical)
        const redirectRow = await env.ANIHUB.prepare(
          `SELECT to_id FROM anime_redirect WHERE from_id = ?1 LIMIT 1`
        ).bind(id).first().catch(() => null);
        if (redirectRow?.to_id) {
          resolvedId = redirectRow.to_id;
        }
      }

      if (!row && !resolvedId && /^\d+$/.test(id)) {
        // Numeric — try anilist_id, mal_id, kitsu_id in order
        const idNum = parseInt(id, 10);
        for (const col of ['anilist_id', 'mal_id', 'kitsu_id']) {
          const mapRow = await env.ANIHUB.prepare(
            `SELECT anime_id FROM anime_id_map WHERE ${col} = ?1 LIMIT 1`
          ).bind(idNum).first().catch(() => null);
          if (mapRow?.anime_id) {
            resolvedId = mapRow.anime_id;
            break;
          }
        }
      }

      // STEP 3 — 301 redirect to canonical URL if we resolved to a different ID
      if (resolvedId && resolvedId !== id) {
        const redirectUrl = new URL(request.url);
        if (watchMatch) {
          redirectUrl.pathname = `/watch/${resolvedId}${epNum ? '/' + epNum : ''}`;
        } else {
          redirectUrl.pathname = `/anime/${resolvedId}`;
        }
        return Response.redirect(redirectUrl.toString(), 301);
      }

      // STEP 4 — Real 404 only if none of the resolution paths worked
      if (!row && watchMatch) {
        return new Response(
          `<!doctype html><html lang="en"><head><meta charset="UTF-8"><title>Anime Not Found | AniHubStream</title><meta name="robots" content="noindex"><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>body{background:#07070b;color:#f0f0f5;font-family:sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;text-align:center;}a{color:#ff1f4a;text-decoration:none;font-weight:bold;}</style></head><body><div><h1>404 — Anime Not Found</h1><p>The anime "${id}" could not be found.</p><p><a href="/">Return to Homepage</a></p></div></body></html>`,
          {
            status: 404,
            headers: { 'content-type': 'text/html; charset=utf-8' },
          }
        );
      }

        if (row) {
          const animeTitle = row.title || id;
          const yearStr = row.year && !animeTitle.includes(`(${row.year})`) ? ` (${row.year})` : '';
          const cleanSynopsis = (row.synopsis || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          desc = cleanSynopsis ? cleanSynopsis.slice(0, 150).trim() : `Watch ${animeTitle} free online in high definition on AniHubStream.`;

          // Query episode-level metadata for specific episode watch requests
          let epRow = null;
          if (epNum && epNum >= 1) {
            try {
              epRow = await env.ANIHUB.prepare(
                `SELECT title, synopsis, thumb, runtime, airdate FROM episode WHERE anime_id = ?1 AND n = ?2 LIMIT 1`
              ).bind(id, epNum).first();
            } catch (_) {}
          }

          const hasDistinctEpTitle = epRow?.title &&
            epRow.title.toLowerCase().trim() !== animeTitle.toLowerCase().trim() &&
            !/^episode\s*\d+$/i.test(epRow.title.trim());
          const epTitleStr = hasDistinctEpTitle ? `: ${epRow.title}` : '';
          const cleanEpSynopsis = (epRow?.synopsis || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          if (cleanEpSynopsis) {
            desc = cleanEpSynopsis.slice(0, 150).trim();
          }

          if (animeMatch) {
            title = `${animeTitle}${yearStr} — Overview & Episode Guide | AniHubStream`;
            canonical = `${origin}/anime/${id}`;
            ogType = 'video.tv_show';
          } else if (epNum && epNum >= 1) {
            title = `${animeTitle} Ep ${epNum}${epTitleStr} — Watch Free | AniHubStream`;
            canonical = `${origin}/watch/${id}/${epNum}`;
            ogType = 'video.episode';
          } else {
            title = `${animeTitle}${yearStr} — Watch Free | AniHubStream`;
            canonical = `${origin}/watch/${id}`;
            ogType = 'video.tv_show';
          }

          ogImage = epRow?.thumb || row.key_art || row.art || ogImage;

          const mainEntity = {
            '@type': epNum ? 'TVEpisode' : 'TVSeries',
            name: epNum ? `${animeTitle} Episode ${epNum}${epTitleStr}` : animeTitle,
            alternateName: row.native || undefined,
            description: desc,
            image: ogImage,
            url: canonical,
            inLanguage: ['ja', 'en', 'hi'],
            countryOfOrigin: 'JP',
            speakable: {
              '@type': 'SpeakableSpecification',
              cssSelector: ['.crawler-synopsis p', '.crawler-episode-synopsis p'],
            },
            ...(row.kind ? { genre: row.kind } : {}),
            ...(epNum ? { episodeNumber: epNum } : {}),
            ...(epRow?.airdate ? { datePublished: epRow.airdate } : {}),
            ...(!epNum && row.episode_total ? { numberOfEpisodes: row.episode_total } : {}),
            ...(row.rating > 0 ? {
              aggregateRating: {
                '@type': 'AggregateRating',
                ratingValue: row.rating,
                bestRating: 10,
                worstRating: 0,
                ratingCount: 150,
              }
            } : {}),
          };

          const breadcrumbs = {
            '@type': 'BreadcrumbList',
            itemListElement: [
              {
                '@type': 'ListItem',
                position: 1,
                name: 'Home',
                item: origin,
              },
              {
                '@type': 'ListItem',
                position: 2,
                name: 'Anime',
                item: `${origin}/anime`,
              },
              {
                '@type': 'ListItem',
                position: 3,
                name: animeTitle,
                item: `${origin}/anime/${id}`,
              },
              ...(epNum ? [{
                '@type': 'ListItem',
                position: 4,
                name: `Episode ${epNum}`,
                item: canonical,
              }] : []),
            ],
          };

          jsonLd = {
            '@context': 'https://schema.org',
            '@graph': [mainEntity, breadcrumbs],
          };

          // Generate rich semantic HTML crawler shell to prevent duplicate content flags
          const safeTitle = (animeTitle || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
          const safeNative = (row.native || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
          const safeSynopsis = (cleanSynopsis || `Stream ${animeTitle} online free in high definition with English subtitles and dub on AniHubStream.`).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
          const safeEpTitle = epRow?.title ? `: ${(epRow.title || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])}` : '';
          const safeEpSynopsis = cleanEpSynopsis ? (cleanEpSynopsis || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]) : '';
          const ratingBadge = row.rating > 0 ? `<span style="background:#27273a;padding:0.2rem 0.5rem;border-radius:4px;color:#facc15;">★ ${Number(row.rating).toFixed(1)}/10</span>` : '';
          const formatBadge = row.kind ? `<span style="background:#27273a;padding:0.2rem 0.5rem;border-radius:4px;color:#94a3b8;text-transform:uppercase;">${row.kind}</span>` : '';
          const totalEpBadge = row.episode_total ? `<span style="background:#27273a;padding:0.2rem 0.5rem;border-radius:4px;color:#94a3b8;">${row.episode_total} Episodes</span>` : '';
          const epHeading = epNum ? ` — Episode ${epNum}${safeEpTitle}` : '';

          let epLinksHtml = '';
          if (row.episode_total && row.episode_total > 1) {
            const displayCount = Math.min(row.episode_total, 24);
            const links = [];
            for (let i = 1; i <= displayCount; i++) {
              links.push(`<a href="${origin}/watch/${id}/${i}" style="margin:0.25rem 0.4rem 0.25rem 0;display:inline-block;padding:0.35rem 0.75rem;background:#181824;color:#f0f0f5;border:1px solid #2e2e42;border-radius:4px;text-decoration:none;">Ep ${i}</a>`);
            }
            if (row.episode_total > displayCount) {
              links.push(`<span style="color:#888;font-size:0.9rem;margin-left:0.5rem;">+ ${row.episode_total - displayCount} more episodes</span>`);
            }
            epLinksHtml = `<section class="crawler-episodes" style="margin-top:1.5rem;"><h2>Episode Guide</h2><nav aria-label="Episode List" style="display:flex;flex-wrap:wrap;align-items:center;">${links.join('')}</nav></section>`;
          }

          let relatedHtml = '';
          if (env.ANIHUB) {
            try {
              const relStmt = row.kind
                ? env.ANIHUB.prepare(`SELECT id, title, year FROM anime WHERE kind = ?1 AND id != ?2 ORDER BY rating DESC LIMIT 5`).bind(row.kind, id)
                : env.ANIHUB.prepare(`SELECT id, title, year FROM anime WHERE id != ?1 ORDER BY rating DESC LIMIT 5`).bind(id);
              const { results: relResults } = await relStmt.all().catch(() => ({ results: [] }));
              if (relResults && relResults.length) {
                const relLinks = relResults.map(r =>
                  `<a href="${origin}/anime/${r.id}" style="display:inline-block;padding:0.4rem 0.8rem;background:#181824;color:#f0f0f5;border:1px solid #2e2e42;border-radius:6px;text-decoration:none;margin:0.25rem 0.5rem 0.25rem 0;">${(r.title || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])}${r.year ? ` (${r.year})` : ''}</a>`
                ).join('');
                relatedHtml = `<section class="crawler-related" style="margin-top:2rem;border-top:1px solid #2e2e42;padding-top:1.5rem;"><h2>If you liked ${safeTitle}, you might like...</h2><nav aria-label="Related Anime Recommendations" style="display:flex;flex-wrap:wrap;margin-top:0.75rem;">${relLinks}</nav></section>`;
              }
            } catch (_) {}
          }
          if (!relatedHtml) {
            const fallbackRelated = [
              ['solo-leveling', 'Solo Leveling'],
              ['jujutsu-kaisen', 'Jujutsu Kaisen'],
              ['demon-slayer', 'Demon Slayer'],
              ['one-piece', 'One Piece'],
              ['attack-on-titan', 'Attack on Titan'],
            ].filter(([slug]) => slug !== id).slice(0, 4);
            const relLinks = fallbackRelated.map(([slug, name]) =>
              `<a href="${origin}/anime/${slug}" style="display:inline-block;padding:0.4rem 0.8rem;background:#181824;color:#f0f0f5;border:1px solid #2e2e42;border-radius:6px;text-decoration:none;margin:0.25rem 0.5rem 0.25rem 0;">${name}</a>`
            ).join('');
            relatedHtml = `<section class="crawler-related" style="margin-top:2rem;border-top:1px solid #2e2e42;padding-top:1.5rem;"><h2>If you liked ${safeTitle}, you might like...</h2><nav aria-label="Related Anime Recommendations" style="display:flex;flex-wrap:wrap;margin-top:0.75rem;">${relLinks}</nav></section>`;
          }

          const productionText = (
            `${animeTitle}${yearStr} is an officially catalogued ${row.kind ? row.kind.toLowerCase() : 'anime'} series originating from Japan${row.year ? ` in ${row.year}` : ''}. ` +
            (row.episode_total && row.episode_total > 1
              ? `The complete story spans ${row.episode_total} episodes, delivering structured narrative pacing from the opening premiere through to the season finale. `
              : `The title is indexed with verified episodic guides and complete airdate archives. `) +
            (row.rating > 0
              ? `With an aggregated viewer score of ${Number(row.rating).toFixed(1)}/10, it maintains active engagement across our global anime community. `
              : '') +
            `Production metadata, alternative native titles, and broadcast schedules are verified against AniList, Kitsu, and MyAnimeList to guarantee accurate viewing documentation.`
          ).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

          const streamingText = (
            `Viewers can watch ${animeTitle} online free in full high definition (1080p and 720p) with fast cloud playback on AniHubStream. ` +
            `Audio and subtitle options feature the original Japanese voice cast with multi-language subtitle synchronizations, alongside English dubbed audio streams where released. ` +
            `With built-in AniSkip technology, episode openings and endings are automatically detected to let you skip intros and outros seamlessly on desktop, tablet, and mobile devices.`
          ).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

          preHtml = `<main class="crawler-content" style="padding:2rem;max-width:850px;margin:0 auto;line-height:1.6;color:#e2e8f0;">` +
            `<h1>Watch ${safeTitle}${yearStr}${epHeading} Online Free</h1>` +
            (safeNative ? `<p class="native-title" lang="ja" style="font-size:1.15rem;color:#94a3b8;margin-top:-0.5rem;">${safeNative}</p>` : '') +
            `<div class="crawler-meta" style="display:flex;gap:0.75rem;margin:1rem 0;font-size:0.9rem;align-items:center;flex-wrap:wrap;">` +
              (ratingBadge || '') +
              (row.year ? `<span style="background:#27273a;padding:0.2rem 0.5rem;border-radius:4px;color:#94a3b8;">Year: ${row.year}</span>` : '') +
              (formatBadge || '') +
              (totalEpBadge || '') +
            `</div>` +
            (safeEpSynopsis ? `<section class="crawler-episode-synopsis" style="margin:1.5rem 0;background:#181824;padding:1rem;border-radius:6px;border-left:4px solid #ff1f4a;"><h2>Episode ${epNum} Overview</h2><p>${safeEpSynopsis}</p></section>` : '') +
            `<section class="crawler-synopsis" style="margin:1.5rem 0;">` +
              `<h2>Series Synopsis & Overview</h2>` +
              `<p>${safeSynopsis}</p>` +
            `</section>` +
            `<section class="crawler-production" style="margin:1.5rem 0;">` +
              `<h2>Production & Broadcast Details</h2>` +
              `<p>${productionText}</p>` +
            `</section>` +
            `<section class="crawler-streaming-guide" style="margin:1.5rem 0;">` +
              `<h2>Streaming Quality & Audio Options</h2>` +
              `<p>${streamingText}</p>` +
            `</section>` +
            epLinksHtml +
            relatedHtml +
            `<p style="margin-top:2rem;"><a href="${origin}/watch/${id}${epNum ? `/${epNum}` : ''}" style="display:inline-block;padding:0.75rem 1.5rem;background:#ff1f4a;color:#fff;border-radius:6px;font-weight:bold;text-decoration:none;">Stream ${safeTitle} Now</a></p>` +
          `</main>`;
        }
      } catch (e) {
        console.error('Middleware D1 lookup failed:', e);
      }
    }
  } else if (path === '/') {
    jsonLd = {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'WebSite',
          '@id': `${origin}/#website`,
          name: 'AniHubStream',
          url: origin,
          potentialAction: {
            '@type': 'SearchAction',
            target: `${origin}/anime?search={search_term_string}`,
            'query-input': 'required name=search_term_string',
          },
          publisher: {
            '@id': `${origin}/#organization`,
          },
        },
        {
          '@type': 'Organization',
          '@id': `${origin}/#organization`,
          name: 'AniHubStream',
          url: origin,
          logo: `${origin}/emblem.svg`,
          image: `${origin}/og.png`,
          description: 'Next-generation anime streaming and exploration platform with multi-server redundancy, weekly airing schedules, and ad-free playback.',
          sameAs: [
            'https://github.com/anihubstream',
            'https://discord.gg/anihubstream',
            'https://twitter.com/anihubstream',
          ],
        },
      ],
    };
  } else if (path === '/anime') {
    title = 'Anime Catalogue — Discover Series & Movies | AniHubStream';
    desc = 'Explore the full AniHubStream anime catalogue. Filter by genre, release year, format (TV, Movie, OVA), and rating.';
  } else if (path === '/genres') {
    if (url.searchParams.has('name') && !url.searchParams.has('genre')) {
      const nameVal = url.searchParams.get('name') || '';
      const redirectUrl = new URL(request.url);
      redirectUrl.searchParams.delete('name');
      redirectUrl.searchParams.set('genre', nameVal.toLowerCase().replace(/\s+/g, '-'));
      return Response.redirect(redirectUrl.toString(), 301);
    }
    const genreParam = url.searchParams.get('genre');
    if (genreParam) {
      canonical = `${origin}/genres?genre=${encodeURIComponent(genreParam.toLowerCase())}`;
      const genreName = genreParam.charAt(0).toUpperCase() + genreParam.slice(1);
      title = `${genreName} Anime — Stream Online Free | AniHubStream`;
      desc = `Browse and stream the best ${genreName} anime series and movies online free on AniHubStream with high-definition playback, Japanese audio, and subtitles.`;
    } else {
      title = 'Anime Genres & Categories | AniHubStream';
      desc = 'Browse anime by genre: Action, Adventure, Comedy, Drama, Fantasy, Romance, Sci-Fi, Slice of Life, and more.';
    }
  } else if (path === '/search') {
    const q = url.searchParams.get('q');
    if (q) canonical = `${origin}/search?q=${encodeURIComponent(q)}`;
    title = q ? `Search results for "${q}" | AniHubStream` : 'Search Anime — Watch Subbed & Dubbed Anime Online Free | AniHubStream';
    desc = 'Search thousands of subbed and dubbed anime series and movies with instant HD streaming on AniHubStream.';
  } else if (path === '/watchlist' || path === '/my-list') {
    title = 'My Anime Watchlist & Saved Titles | AniHubStream';
    desc = 'Manage your saved anime series, movies, and track your episodic progress on AniHubStream.';
  } else if (path === '/schedule') {
    title = 'Anime Broadcast Schedule — Airing This Week | AniHubStream';
    desc = 'Live weekly anime release schedule. Check episode air dates, broadcast times, and currently airing seasons.';
  } else if (path === '/discover') {
    title = 'Discover Trending & Popular Anime | AniHubStream';
    desc = 'Find your next favorite anime series. Browse trending releases, community favorites, and staff picks.';
  } else if (path === '/news') {
    const pageParam = url.searchParams.get('page');
    if (pageParam && parseInt(pageParam, 10) > 1) {
      canonical = `${origin}/news?page=${parseInt(pageParam, 10)}`;
      title = `Anime News, Industry Announcements & Broadcast Schedules (Page ${pageParam}) | AniHubStream`;
    } else {
      canonical = `${origin}/news`;
      title = 'Anime News, Industry Announcements & Broadcast Schedules | AniHubStream';
    }
    desc = 'Track breaking anime news, studio production updates, release dates, staff and voice cast reveals, and seasonal broadcast schedules on AniHubStream.';
    jsonLd = {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'CollectionPage',
          name: 'AniHubStream Anime News & Editorial Hub',
          url: canonical,
          description: desc,
        },
      ],
    };
  } else if (path.startsWith('/news/')) {
    const rawSlug = path.replace('/news/', '').replace(/\/$/, '');
    const legacyRedirects = {
      'hidive-announces-never-before-announced-new-simulcasts-to-be': 'hidive-announces-never-before-announced-new-simulcasts',
      'mitei-hattoris-smile-manga-gets-live-action-series-with-global': 'mitei-hattoris-smile-manga-gets-live-action-series-with-global-release-plans',
      'shiboyugi-playing-death-games-to-put-food-on-the-table-anime': 'shiboyugi-playing-death-games-to-put-food-on-the-table-anime-announces-sequel',
      'naruto-shippuden-the-assembly-of-the-five-kage-telugu-dub-': 'naruto-shippuden-the-assembly-of-the-five-kage-telugu-dub',
    };
    if (legacyRedirects[rawSlug]) {
      return Response.redirect(`${origin}/news/${legacyRedirects[rawSlug]}`, 301);
    }
    if (rawSlug.endsWith('-') || rawSlug.includes('---')) {
      const cleanSlug = rawSlug.replace(/--+/g, '-').replace(/-+$/, '');
      return Response.redirect(`${origin}/news/${cleanSlug}`, 301);
    }
    const slug = rawSlug;
    ogType = 'article';
    const newsMap = {
      'weekly-anime-power-rankings-top-trending': {
        title: 'Weekly Anime Power Rankings: Why Overgeared Is Dominating Global Viewership (2026-11-27)',
        desc: 'Analyzing global streaming telemetry, engagement metrics, and community sentiment to rank the top 10 anime series captivating viewers worldwide this week.',
        author: 'Kenji Sato',
        image: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx212888-NhyvqPt5aIuJ.jpg',
      },
      '6-anime-that-leave-you-thinking-long-after-they-end': {
        title: 'Beyond Entertainment: 6 Anime Masterpieces That Force You to Confront Uncomfortable Truths',
        desc: 'An exploration of profound anime narratives that transcend escapism, examining existential dread, societal complacency, and the nature of grief.',
        author: 'Elena Rostova',
        image: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx19-gtMC64182sm4.jpg',
      },
      '5-hidden-gem-anime-outclassing-modern-shonen': {
        title: 'Stop Watching Generic Slop: 5 Hidden Gems That Are Quietly Outclassing Modern Shonen',
        desc: 'Escape the repetitive cycle of generic power-fantasy adaptations with these 5 extraordinary hidden gems that showcase visionary direction, organic pacing, and genuine emotional stakes.',
        author: 'Elena Rostova',
        image: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx154587-qQTzQnEJJ3oB.jpg',
      },
      'anime-season-broadcast-guide-airing-schedules': {
        title: 'Anime Broadcast Season Guide: Most Anticipated Releases & Air Dates (2026-11-27)',
        desc: 'The definitive broadcast preview for the current anime season — analyzing returning franchise powerhouses, studio production teams, premiere dates, and streaming platforms.',
        author: 'Marcus Vance',
        image: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx159042-GGFwlDskc5vR.png',
      },
      'solo-leveling-reawakening-complete-guide': {
        title: 'Solo Leveling ReAwakening & Season 2: Story Arcs, Power Scaling & Watch Guide',
        desc: 'Everything you need to know about Sung Jinwoo’s journey from the World’s Weakest E-Rank hunter to the Monarch of Shadows.',
        author: 'Elena Rostova',
        image: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx176496-9BDMjAZGEbq4.png',
      },
      'top-10-dark-fantasy-anime-masterpieces': {
        title: 'Top 10 Dark Fantasy Anime Masterpieces You Must Watch (Ranked)',
        desc: 'An authoritative, production-level ranking of the grittiest dark fantasy anime ever animated — analyzing animation pedigree, psychological weight, and unforgiving worldbuilding.',
        author: 'Kenji Sato',
        image: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx21560-6iifjdssfebJ.jpg',
      },
      'best-isekai-anime-ranked-by-worldbuilding': {
        title: 'The 15 Best Isekai Anime Ranked by Story, Worldbuilding, and Action',
        desc: 'Move beyond generic reincarnation tropes. These 15 standout isekai series elevate the genre with intricate magic systems, economic realism, and profound character growth.',
        author: 'Daiki Tanaka',
        image: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx127720-ADJgIrUVMdU9.jpg',
      },
      'top-10-psychological-thriller-anime-ranked': {
        title: 'Top 10 Psychological Thriller Anime Ranked by Suspense & Mind Games',
        desc: 'From Death Note to Monster, discover 10 intense anime where intellect, moral corruption, and high-stakes psychological warfare rule.',
        author: 'Elena Rostova',
        image: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx1535-kUgkcrfOrkUM.jpg',
      },
      'best-sci-fi-cyberpunk-anime-ranked': {
        title: 'Top 10 High-Stakes Sci-Fi & Cyberpunk Anime Masterpieces Ranked',
        desc: 'From Cyberpunk Edgerunners to Steins;Gate, rank the 10 greatest sci-fi anime ever animated by futuristic worldbuilding and philosophical depth.',
        author: 'Marcus Vance',
        image: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx120377-ayZPoxiWt4Li.jpg',
      },
      'top-must-watch-romance-anime-emotional-payoff': {
        title: '10 Must-Watch Romance Anime with Genuine Emotional Payoff (Ranked)',
        desc: 'Beyond will-they-won\'t-they delays: 10 romance anime where relationships actually progress with emotional maturity and satisfying climaxes.',
        author: 'Daiki Tanaka',
        image: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx101921-ufrjLzhSz7L1.jpg',
      },
      'ultimate-shonen-battle-anime-tier-list': {
        title: 'The Definitive Shonen Battle Anime Tier List: Ranked by Fights & Animation',
        desc: 'Rank the greatest battle shonen series from Hunter x Hunter to Jujutsu Kaisen by combat choreography, sakuga animation, and ideological stakes.',
        author: 'Kenji Sato',
        image: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx11061-y5gsT1hoHuHw.png',
      },
      'studio-mappa-best-anime-ranked': {
        title: 'Studio MAPPA: 10 Defining Masterpieces Ranked by Sakuga & Story',
        desc: 'From Jujutsu Kaisen to Chainsaw Man and Attack on Titan, analyze Studio MAPPA\'s defining anime masterworks by visual brilliance and narrative impact.',
        author: 'Elena Rostova',
        image: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx113415-LHBAeoZDIsnF.jpg',
      },
      'ufotable-best-anime-ranked': {
        title: 'Studio Ufotable: 8 Visually Stunning Anime Ranked by Sakuga Animation',
        desc: 'The definitive ranking of Studio Ufotable\'s visual masterpieces: Demon Slayer, Fate/Zero, Heaven\'s Feel, and Unlimited Blade Works ranked by sakuga pedigree.',
        author: 'Marcus Vance',
        image: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx101922-WBsBl0ClmgYL.jpg',
      },
      'top-10-sports-anime-hype-adrenaline': {
        title: 'Top 10 Sports Anime That Deliver Pure Hype and Adrenaline (Ranked)',
        desc: 'From Haikyuu to Blue Lock and Hajime no Ippo, rank the 10 sports anime that deliver unmatched motivation, adrenaline, and emotional payoff.',
        author: 'Elena Rostova',
        image: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx137822-U8naszP96vzC.png',
      },
    };
    const prettyTitle = slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    const item = newsMap[slug] || {
      title: prettyTitle,
      desc: `Read the latest verified announcement, broadcast schedule, and studio production details for ${prettyTitle} on AniHubStream.`,
      author: 'AniHub Editorial Desk',
      image: `${origin}/images/banners/banner-spring-2026.jpg`,
    };
    title = `${item.title} | AniHubStream News`;
    desc = item.desc;
    ogImage = item.image;
    jsonLd = {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'NewsArticle',
          headline: item.title,
          description: item.desc,
          mainEntityOfPage: `${origin}/news/${slug}`,
          image: [item.image],
          datePublished: '2026-11-25T10:00:00+00:00',
          dateModified: '2026-11-25T10:00:00+00:00',
          author: {
            '@type': 'Person',
            name: item.author,
            url: `${origin}/about#editorial`,
          },
          publisher: {
            '@type': 'Organization',
            name: 'AniHubStream',
            url: origin,
            logo: {
              '@type': 'ImageObject',
              url: `${origin}/og.png`,
              width: 1200,
              height: 630,
            },
          },
        },
        {
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Home', item: `${origin}/` },
            { '@type': 'ListItem', position: 2, name: 'Anime News', item: `${origin}/news` },
            { '@type': 'ListItem', position: 3, name: item.title, item: `${origin}/news/${slug}` },
          ],
        },
      ],
    };
  } else if (path === '/about') {
    title = 'About AniHubStream — Free Anime Streaming Platform';
    desc = 'Learn about AniHubStream, our mission, catalog data sources (Kitsu, AniList), and high-performance streaming architecture.';
    jsonLd = {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'AboutPage',
          name: 'About AniHubStream',
          url: `${origin}/about`,
          description: desc,
        },
        {
          '@type': 'FAQPage',
          mainEntity: [
            {
              '@type': 'Question',
              name: 'What is AniHubStream?',
              acceptedAnswer: {
                '@type': 'Answer',
                text: 'AniHubStream is a free, high-speed anime streaming platform providing subbed and dubbed anime with fast playback, weekly airing schedules, and full episode guides.',
              },
            },
            {
              '@type': 'Question',
              name: 'Is AniHubStream free to use?',
              acceptedAnswer: {
                '@type': 'Answer',
                text: 'Yes, AniHubStream is completely free with no registration, subscription, or paywalls required.',
              },
            },
            {
              '@type': 'Question',
              name: 'Does AniHubStream support subbed and dubbed anime?',
              acceptedAnswer: {
                '@type': 'Answer',
                text: 'Yes, AniHubStream supports original Japanese audio with multi-language subtitles as well as English and regional dubbed audio streams.',
              },
            },
            {
              '@type': 'Question',
              name: 'Where does AniHubStream source its anime metadata?',
              acceptedAnswer: {
                '@type': 'Answer',
                text: 'All series information, episode synopses, and broadcast schedules are verified and synchronized from AniList, Kitsu, and MyAnimeList.',
              },
            },
            {
              '@type': 'Question',
              name: 'Does AniHubStream support auto-skipping openings and endings?',
              acceptedAnswer: {
                '@type': 'Answer',
                text: 'Yes, AniHubStream integrates AniSkip community timestamps to automatically skip intros and outros.',
              },
            },
          ],
        },
      ],
    };
  } else if (path === '/dmca') {
    title = 'DMCA & Copyright Policy | AniHubStream';
    desc = 'AniHubStream DMCA copyright infringement notification guidelines and content policy.';
  } else if (path === '/privacy') {
    title = 'Privacy Policy | AniHubStream';
    desc = 'AniHubStream Privacy Policy explaining how viewer data and session preferences are managed.';
  } else if (path === '/terms') {
    title = 'Terms of Service | AniHubStream';
    desc = 'Terms of Service and user agreement for AniHubStream.';
  } else if (path === '/contact') {
    title = 'Contact AniHubStream';
    desc = 'Get in touch with the AniHubStream team for inquiries, bug reports, and feedback.';
  }

  // Generate crawler-visible semantic HTML body for thin content resolution
  if (path === '/about') {
    preHtml = `<main class="crawler-content" style="padding:2rem;max-width:800px;margin:0 auto;line-height:1.6;">` +
      `<h1>About AniHubStream</h1>` +
      `<p>AniHubStream is a high-performance anime streaming platform engineered to provide instant playback, comprehensive metadata, and an ad-free viewing experience. Our catalog features subbed and dubbed anime across TV series, movies, and OVAs, synchronized with leading industry databases including Kitsu and AniList. Designed with edge caching, automated episode guides, and seamless bookmarks.</p>` +
      `<section class="crawler-faq" style="margin-top:2rem;">` +
        `<h2>Frequently Asked Questions</h2>` +
        `<h3>What is AniHubStream?</h3><p>AniHubStream is a free, high-speed anime streaming platform providing subbed and dubbed anime with fast playback, weekly airing schedules, and full episode guides.</p>` +
        `<h3>Is AniHubStream free to use?</h3><p>Yes, AniHubStream is completely free with no registration, subscription, or paywalls required.</p>` +
        `<h3>Does AniHubStream support subbed and dubbed anime?</h3><p>Yes, AniHubStream supports original Japanese audio with multi-language subtitles as well as English and regional dubbed audio streams.</p>` +
        `<h3>Where does AniHubStream source its anime metadata?</h3><p>All series information, episode synopses, and broadcast schedules are verified and synchronized from AniList, Kitsu, and MyAnimeList.</p>` +
        `<h3>Does AniHubStream support auto-skipping openings and endings?</h3><p>Yes, AniHubStream integrates AniSkip community timestamps to automatically skip intros and outros.</p>` +
      `</section>` +
    `</main>`;
  } else if (path === '/dmca') {
    preHtml = `<main class="crawler-content" style="padding:2rem;max-width:800px;margin:0 auto;line-height:1.6;">
      <h1>DMCA &amp; Copyright Policy</h1>
      <p class="lead">Digital Millennium Copyright Act compliance, copyright verification guidelines, and formal takedown notice procedure for AniHubStream.</p>
      <section>
        <h2>1. Non-Hosting &amp; Information Indexing Disclaimer</h2>
        <p>AniHubStream respects the intellectual property rights of creators, studios, and copyright owners worldwide. In compliance with 17 U.S.C. § 512 and international copyright conventions, AniHubStream operates strictly as an indexing aggregator and metadata directory. AniHubStream does not host, upload, encode, store, or manage any copyrighted video files, media streams, or digital content on its own infrastructure or Cloudflare edge servers. All media streams accessible through the platform are embedded, indexed, or linked from independent third-party video hosting services over the open internet.</p>
      </section>
      <section>
        <h2>2. Submitting a Copyright Infringement Notice</h2>
        <p>If you are a copyright holder, or an authorized representative thereof, and believe that content accessible through AniHubStream infringes upon your copyright, you may submit a formal notification under the Digital Millennium Copyright Act. To ensure prompt investigation and removal of the indexed reference, your notice must include the following information:</p>
        <ul>
          <li>A physical or electronic signature of a person authorized to act on behalf of the owner of an exclusive right that is allegedly infringed.</li>
          <li>Identification of the copyrighted anime title, film, or creative work claimed to have been infringed.</li>
          <li>Identification of the material claimed to be infringing, specifically including the direct AniHubStream webpage URL (e.g. <code>https://anihubstream.com/watch/[anime-id]/[episode-number]</code>) containing the link or embed.</li>
          <li>Information reasonably sufficient to permit our designated agent to contact you, including legal name, physical address, telephone number, and official email address.</li>
          <li>A statement that you have a good-faith belief that use of the material in the manner complained of is not authorized by the copyright owner, its agent, or the law.</li>
          <li>A statement that the information in the notification is accurate, and under penalty of perjury, that the complaining party is authorized to act on behalf of the owner of an exclusive right that is allegedly infringed.</li>
        </ul>
      </section>
      <section>
        <h2>3. Designated Copyright Agent Contact</h2>
        <p>Formal infringement notifications should be directed via electronic mail to our designated agent at:</p>
        <p><strong>Designated Agent:</strong> Copyright &amp; Legal Compliance Division<br/><strong>Email:</strong> <a href="mailto:dmca@anihubstream.com">dmca@anihubstream.com</a><br/><strong>Response Timeline:</strong> Valid notices with specific URL references are reviewed and resolved within 24 to 48 business hours.</p>
      </section>
    </main>`;
  } else if (path === '/privacy') {
    preHtml = `<main class="crawler-content" style="padding:2rem;max-width:800px;margin:0 auto;line-height:1.6;">
      <h1>Privacy Policy</h1>
      <p class="lead">How AniHubStream protects viewer privacy, anonymous sessions, and device playback preferences.</p>
      <section>
        <h2>1. Anonymous Streaming by Default</h2>
        <p>AniHubStream is architected from the ground up to respect user anonymity. You are never required to create an account, register an email address, or provide any personal identity data to browse our anime catalog or stream high-definition episodes. Viewers can freely explore weekly airing schedules, read episode guides, and watch anime without establishing personal profiles.</p>
      </section>
      <section>
        <h2>2. Technical Cookies &amp; Local Storage Usage</h2>
        <p>We use technical browser cookies and HTML5 Local Storage strictly for essential client-side playback functionality:</p>
        <ul>
          <li><strong>Playback Continuity:</strong> Remembering your audio preference (original Japanese audio or dubbed tracks), volume level, and subtitle customization settings across viewing sessions.</li>
          <li><strong>Resume Timestamps:</strong> Storing exact playback timestamps locally on your device so you can seamlessly resume watching where you left off.</li>
          <li><strong>Personal Watchlist:</strong> Maintaining your saved anime titles under "My List" directly within your browser’s local storage.</li>
        </ul>
        <p>We do not use tracking cookies for behavioral profiling, nor do we sell, lease, or monetize viewer browsing histories with third-party data brokers or behavioral advertising networks.</p>
      </section>
      <section>
        <h2>3. Server Telemetry &amp; Infrastructure Security</h2>
        <p>Standard network transmission logs (such as truncated IP addresses, user-agent headers, and requested URL paths) are processed transiently at the Cloudflare network boundary solely for DDoS mitigation, caching performance verification, and automated rate-limiting enforcement. These diagnostic logs are retained on a rolling basis and purged automatically.</p>
      </section>
      <section>
        <h2>4. Contact Regarding Privacy Inquiries</h2>
        <p>If you have any questions or concerns regarding our privacy standards and data handling practices, please contact us at <a href="mailto:contact@anihubstream.com">contact@anihubstream.com</a>.</p>
      </section>
    </main>`;
  } else if (path === '/terms') {
    preHtml = `<main class="crawler-content" style="padding:2rem;max-width:800px;margin:0 auto;line-height:1.6;">
      <h1>Terms of Service</h1>
      <p class="lead">Terms and conditions governing the use of the AniHubStream anime exploration and streaming platform.</p>
      <section>
        <h2>1. Acceptance of Terms</h2>
        <p>By accessing, browsing, or utilizing the services provided by AniHubStream (&ldquo;we&rdquo;, &ldquo;our&rdquo;, or &ldquo;the platform&rdquo;), you acknowledge that you have read, understood, and agreed to be bound by these Terms of Service. If you do not agree with any portion of these terms, your sole remedy is to immediately discontinue using the platform.</p>
      </section>
      <section>
        <h2>2. Nature of the Service &amp; Content Aggregation</h2>
        <p>AniHubStream functions as a digital anime encyclopedia, release schedule tracker, and automated video stream aggregator. AniHubStream does not host, upload, or store video media on its own infrastructure. Streaming playback links and external media embeds are aggregated from independent third-party sources on the internet. AniHubStream does not control and assumes no liability for the availability, operational uptime, or content hosted on external third-party services.</p>
      </section>
      <section>
        <h2>3. Acceptable Use Policy</h2>
        <p>You agree to access and use AniHubStream exclusively for personal, non-commercial entertainment and research purposes. You agree not to:</p>
        <ul>
          <li>Attempt to disrupt, overload, or impair platform infrastructure via automated scrapers, denial-of-service floods, or unauthorized API stress-testing.</li>
          <li>Bypass or attempt to circumvent security controls, Cloudflare WAF protections, or edge rate limits.</li>
          <li>Reverse-engineer or exploit proprietary video playback bridges for commercial distribution or mirroring.</li>
        </ul>
      </section>
      <section>
        <h2>4. Disclaimer of Warranties &amp; Limitation of Liability</h2>
        <p>AniHubStream is provided on an &ldquo;AS IS&rdquo; and &ldquo;AS AVAILABLE&rdquo; basis without warranties of any kind, either express or implied. We do not warrant that service availability will be error-free or uninterrupted. In no event shall AniHubStream or its contributors be held liable for any direct, indirect, incidental, or consequential damages resulting from the use or inability to use the platform.</p>
      </section>
    </main>`;
  } else if (path === '/contact') {
    preHtml = `<main class="crawler-content" style="padding:2rem;max-width:800px;margin:0 auto;line-height:1.6;">
      <h1>Contact AniHubStream</h1>
      <p class="lead">Connect with the AniHubStream engineering and support team for platform inquiries, catalog metadata corrections, and copyright notices.</p>
      <section>
        <h2>1. General Inquiries &amp; Technical Support</h2>
        <p>Have questions regarding feature updates, video player compatibility, or suggestions for improving AniHubStream? Our development team welcomes community feedback to continuously optimize stream stability and subtitle synchronization.</p>
        <p><strong>General Support Email:</strong> <a href="mailto:contact@anihubstream.com">contact@anihubstream.com</a></p>
      </section>
      <section>
        <h2>2. Bug Reports &amp; Metadata Corrections</h2>
        <p>If you encounter an incorrect episode thumbnail, a broken video source, or mismatched Japanese/English romaji titles, please report it to our technical team. To help our automated verification systems replicate and resolve the issue quickly, please include:</p>
        <ul>
          <li>The specific anime title and episode number (e.g. <em>Solo Leveling Episode 12</em>).</li>
          <li>The exact webpage URL where the issue occurred.</li>
          <li>A brief description of the observed behavior (e.g. out-of-sync audio or missing subtitle track).</li>
        </ul>
      </section>
      <section>
        <h2>3. Copyright &amp; Legal Notices</h2>
        <p>For formal copyright inquiries and DMCA takedown requests, please consult our <a href="/dmca">DMCA &amp; Copyright Policy</a> and submit your detailed claim directly to our designated agent at <a href="mailto:dmca@anihubstream.com">dmca@anihubstream.com</a>.</p>
      </section>
    </main>`;
  } else if (path === '/search') {
    preHtml = `<main class="crawler-content" style="padding:2rem;max-width:800px;margin:0 auto;line-height:1.6;"><h1>Federated Anime Search</h1><p>Search across thousands of subbed and dubbed anime series and movies. AniHubStream connects to high-speed stream providers with automatic server fallback and instant title matching.</p></main>`;
  } else if (path === '/watchlist' || path === '/my-list') {
    preHtml = `<main class="crawler-content" style="padding:2rem;max-width:800px;margin:0 auto;line-height:1.6;"><h1>Personal Anime Watchlist</h1><p>Keep track of anime you are currently watching, plan to watch, or completed. All bookmarks and episodic progress are saved securely on your device with instant resume capability.</p></main>`;
  } else if (path === '/genres') {
    const genreParam = url.searchParams.get('genre') || url.searchParams.get('name');
    if (genreParam) {
      const gName = genreParam.charAt(0).toUpperCase() + genreParam.slice(1);
      preHtml = `<main class="crawler-content" style="padding:2rem;max-width:800px;margin:0 auto;line-height:1.6;"><h1>${gName} Anime — Stream Online Free</h1><p>Explore our extensive curated catalogue of ${gName} anime titles. AniHubStream brings you top-rated ${gName} anime series, feature-length movies, and seasonal releases with synchronized English subtitles, multi-audio dub options, and verified video streams. Watch popular franchises and discover hidden gems in full high definition with zero ads. Filter by broadcast season, release year, and community score to find your next favorite show.</p><p>Our collection is synchronized daily with top anime databases like AniList and Kitsu to guarantee comprehensive metadata, episode schedules, and character information. Start watching now on desktop, mobile, or tablet with seamless instant playback and cross-device bookmarking.</p></main>`;
    } else {
      preHtml = `<main class="crawler-content" style="padding:2rem;max-width:800px;margin:0 auto;line-height:1.6;"><h1>Anime Genres & Categories</h1><p>Browse thousands of anime series categorized across diverse genres: Action, Adventure, Comedy, Drama, Fantasy, Romance, Sci-Fi, Supernatural, Mystery, Slice of Life, and more. Each genre collection features complete episode listings, release dates, and high-definition video playback. Whether you are looking for adrenaline-fueled shounen battles, heartwarming romance, mind-bending psychological thrillers, or relaxing slice-of-life comedy, AniHubStream provides seamless navigation and fast edge-streamed video.</p><p>All entries are catalogued with rich metadata, studio attributions, voice actor credits, and airing countdowns. Enjoy ad-free anime streaming with multiple provider fallbacks, subtitle options, and automatic intro skip functionality on any device.</p></main>`;
    }
  } else if (path === '/schedule') {
    let scheduleLinksHtml = '';
    if (env.ANIHUB) {
      try {
        const { results } = await env.ANIHUB.prepare(
          `SELECT id, title, sched_day, sched_time, rating FROM anime WHERE sched_day IS NOT NULL ORDER BY sched_day, sched_time LIMIT 35`
        ).all().catch(() => ({ results: [] }));
        if (results && results.length) {
          const daysMap = { 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday', 6: 'Saturday', 7: 'Sunday' };
          const byDay = {};
          for (const item of results) {
            const d = daysMap[item.sched_day] || 'Weekly';
            if (!byDay[d]) byDay[d] = [];
            const safeItemTitle = (item.title || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
            byDay[d].push(`<a href="/anime/${item.id}" style="display:inline-block;padding:0.35rem 0.75rem;background:#181824;color:#f0f0f5;border:1px solid #2e2e42;border-radius:6px;text-decoration:none;margin:0.25rem;">${safeItemTitle}</a>`);
          }
          scheduleLinksHtml = Object.entries(byDay).map(([dayName, links]) =>
            `<div style="margin:1rem 0;"><h3 style="color:#ff1f4a;margin-bottom:0.5rem;">${dayName}</h3><div style="display:flex;flex-wrap:wrap;gap:0.35rem;">${links.join(' ')}</div></div>`
          ).join('');
        }
      } catch (_) {}
    }
    if (!scheduleLinksHtml) {
      const fallbackAiring = [
        ['solo-leveling', 'Solo Leveling'],
        ['jujutsu-kaisen', 'Jujutsu Kaisen'],
        ['bleach', 'Bleach: Thousand-Year Blood War'],
        ['one-piece', 'One Piece'],
        ['blue-lock', 'Blue Lock'],
        ['dandadan', 'DanDaDan'],
        ['re-zero-starting-life-in-another-world', 'Re:Zero'],
      ];
      scheduleLinksHtml = fallbackAiring.map(([slug, name]) =>
        `<a href="/anime/${slug}" style="display:inline-block;padding:0.4rem 0.8rem;background:#181824;color:#f0f0f5;border:1px solid #2e2e42;border-radius:6px;text-decoration:none;margin:0.25rem;">${name}</a>`
      ).join(' ');
    }

    preHtml = `<main class="crawler-content" style="padding:2rem;max-width:960px;margin:0 auto;line-height:1.6;color:#e2e8f0;">
<h1>Weekly Anime Broadcast Schedule — Airing Episodes & Release Times</h1>
<p>Track live weekly broadcast schedules for currently airing anime series. Stay updated on episode premiere dates, broadcast time slots, and new episode airings with automatic local timezone conversion. Stream every newly released episode in full high definition with English subtitles and dubs as soon as it broadcasts.</p>
<section aria-labelledby="crawler-schedule-list" style="margin:2rem 0;">
<h2 id="crawler-schedule-list">Currently Airing Weekly Anime Series</h2>
${scheduleLinksHtml}
</section>
<p style="margin-top:2rem;"><a href="/anime" style="color:#ff1f4a;text-decoration:underline;font-weight:bold;">Explore Full Anime Catalogue</a> &bull; <a href="/" style="color:#ff1f4a;text-decoration:underline;">Return to Homepage</a></p>
</main>`;
  } else if (path === '/discover') {
    preHtml = `<main class="crawler-content" style="padding:2rem;max-width:960px;margin:0 auto;line-height:1.6;color:#e2e8f0;">
<h1>Discover Trending & Top-Rated Anime</h1>
<p>Explore currently trending anime titles, seasonal fan favorites, top-rated series, and recommended hidden gems updated in real-time from community watch metrics.</p>
<section aria-labelledby="crawler-discover-links" style="margin:1.5rem 0;">
<h2 id="crawler-discover-links">Featured Anime Franchises</h2>
<nav aria-label="Featured Series" style="display:flex;gap:0.5rem;flex-wrap:wrap;margin:1rem 0;">
<a href="/anime/solo-leveling" style="display:inline-block;padding:0.4rem 0.8rem;background:#181824;color:#f0f0f5;border:1px solid #2e2e42;border-radius:6px;text-decoration:none;">Solo Leveling</a>
<a href="/anime/jujutsu-kaisen" style="display:inline-block;padding:0.4rem 0.8rem;background:#181824;color:#f0f0f5;border:1px solid #2e2e42;border-radius:6px;text-decoration:none;">Jujutsu Kaisen</a>
<a href="/anime/demon-slayer" style="display:inline-block;padding:0.4rem 0.8rem;background:#181824;color:#f0f0f5;border:1px solid #2e2e42;border-radius:6px;text-decoration:none;">Demon Slayer</a>
<a href="/anime/one-piece" style="display:inline-block;padding:0.4rem 0.8rem;background:#181824;color:#f0f0f5;border:1px solid #2e2e42;border-radius:6px;text-decoration:none;">One Piece</a>
<a href="/anime/attack-on-titan" style="display:inline-block;padding:0.4rem 0.8rem;background:#181824;color:#f0f0f5;border:1px solid #2e2e42;border-radius:6px;text-decoration:none;">Attack on Titan</a>
<a href="/anime/sousou-no-frieren" style="display:inline-block;padding:0.4rem 0.8rem;background:#181824;color:#f0f0f5;border:1px solid #2e2e42;border-radius:6px;text-decoration:none;">Frieren</a>
<a href="/anime/chainsaw-man" style="display:inline-block;padding:0.4rem 0.8rem;background:#181824;color:#f0f0f5;border:1px solid #2e2e42;border-radius:6px;text-decoration:none;">Chainsaw Man</a>
<a href="/anime/bleach" style="display:inline-block;padding:0.4rem 0.8rem;background:#181824;color:#f0f0f5;border:1px solid #2e2e42;border-radius:6px;text-decoration:none;">Bleach</a>
</nav>
</section>
</main>`;
  } else if (path === '/news') {
    preHtml = `<main class="crawler-content" style="padding:2rem;max-width:960px;margin:0 auto;line-height:1.6;color:#e2e8f0;">
<h1>AniHubStream Anime News, Seasonal Guides &amp; Rankings</h1>
<p>In-depth original editorial content, seasonal broadcast schedules, character analysis, and comprehensive anime rankings curated by the AniHubStream team.</p>
<section style="margin:2rem 0;">
<h2>Featured Editorial Articles &amp; Guides</h2>
<ul style="list-style:none;padding:0;">
<li style="margin-bottom:1.5rem;"><a href="/news/weekly-anime-power-rankings-top-trending" style="color:#ff1f4a;font-size:1.2rem;font-weight:bold;">Weekly Anime Power Rankings</a><p>Global streaming viewership telemetry and rankings. Featured: <a href="/anime/overgeared" style="color:#24d3ee;">Overgeared</a> &bull; <a href="/anime/solo-leveling" style="color:#24d3ee;">Solo Leveling</a>.</p></li>
<li style="margin-bottom:1.5rem;"><a href="/news/top-10-psychological-thriller-anime-ranked" style="color:#ff1f4a;font-size:1.2rem;font-weight:bold;">Top 10 Psychological Thriller Anime Ranked by Suspense &amp; Mind Games</a><p>Mind game masterpieces ranked. Featured: <a href="/anime/death-note" style="color:#24d3ee;">Death Note</a> &bull; <a href="/anime/monster" style="color:#24d3ee;">Monster</a> &bull; <a href="/anime/steins-gate" style="color:#24d3ee;">Steins;Gate</a>.</p></li>
<li style="margin-bottom:1.5rem;"><a href="/news/best-sci-fi-cyberpunk-anime-ranked" style="color:#ff1f4a;font-size:1.2rem;font-weight:bold;">Top 10 High-Stakes Sci-Fi &amp; Cyberpunk Anime Masterpieces Ranked</a><p>Futuristic worldbuilding and dystopias. Featured: <a href="/anime/cyberpunk-edgerunners" style="color:#24d3ee;">Cyberpunk: Edgerunners</a> &bull; <a href="/anime/psycho-pass" style="color:#24d3ee;">Psycho-Pass</a>.</p></li>
<li style="margin-bottom:1.5rem;"><a href="/news/ultimate-shonen-battle-anime-tier-list" style="color:#ff1f4a;font-size:1.2rem;font-weight:bold;">The Definitive Shonen Battle Anime Tier List: Ranked by Fights &amp; Animation</a><p>Top battle shonen ranked. Featured: <a href="/anime/hunter-x-hunter-2011" style="color:#24d3ee;">Hunter x Hunter</a> &bull; <a href="/anime/jujutsu-kaisen" style="color:#24d3ee;">Jujutsu Kaisen</a>.</p></li>
<li style="margin-bottom:1.5rem;"><a href="/news/studio-mappa-best-anime-ranked" style="color:#ff1f4a;font-size:1.2rem;font-weight:bold;">Studio MAPPA: 10 Defining Masterpieces Ranked by Sakuga &amp; Story</a><p>Studio MAPPA's greatest productions analyzed. Featured: <a href="/anime/jujutsu-kaisen" style="color:#24d3ee;">Jujutsu Kaisen</a> &bull; <a href="/anime/chainsaw-man" style="color:#24d3ee;">Chainsaw Man</a> &bull; <a href="/anime/attack-on-titan" style="color:#24d3ee;">Attack on Titan</a>.</p></li>
<li style="margin-bottom:1.5rem;"><a href="/news/ufotable-best-anime-ranked" style="color:#ff1f4a;font-size:1.2rem;font-weight:bold;">Studio Ufotable: 8 Visually Stunning Anime Ranked by Sakuga Animation</a><p>The definitive Ufotable visual ranking. Featured: <a href="/anime/demon-slayer" style="color:#24d3ee;">Demon Slayer</a> &bull; <a href="/anime/fate-zero" style="color:#24d3ee;">Fate/Zero</a>.</p></li>
<li style="margin-bottom:1.5rem;"><a href="/news/top-10-sports-anime-hype-adrenaline" style="color:#ff1f4a;font-size:1.2rem;font-weight:bold;">Top 10 Sports Anime That Deliver Pure Hype and Adrenaline (Ranked)</a><p>Pure motivation and adrenaline. Featured: <a href="/anime/blue-lock" style="color:#24d3ee;">Blue Lock</a> &bull; <a href="/anime/haikyuu" style="color:#24d3ee;">Haikyuu!!</a>.</p></li>
<li style="margin-bottom:1.5rem;"><a href="/news/top-10-dark-fantasy-anime-masterpieces" style="color:#ff1f4a;font-size:1.2rem;font-weight:bold;">Top 10 Dark Fantasy Anime Masterpieces You Must Watch (Ranked)</a><p>A deep dive into gritty dark fantasy anime. Featured: <a href="/anime/berserk" style="color:#24d3ee;">Berserk</a> &bull; <a href="/anime/chainsaw-man" style="color:#24d3ee;">Chainsaw Man</a>.</p></li>
<li style="margin-bottom:1.5rem;"><a href="/news/solo-leveling-reawakening-complete-guide" style="color:#ff1f4a;font-size:1.2rem;font-weight:bold;">Solo Leveling ReAwakening &amp; Season 2: Story Arcs, Power Scaling &amp; Watch Guide</a><p>Everything you need to know about Sung Jinwoo's journey. Featured: <a href="/anime/solo-leveling" style="color:#24d3ee;">Solo Leveling</a>.</p></li>
<li style="margin-bottom:1.5rem;"><a href="/news/best-isekai-anime-ranked-by-worldbuilding" style="color:#ff1f4a;font-size:1.2rem;font-weight:bold;">The 15 Best Isekai Anime Ranked by Story, Worldbuilding, and Action</a><p>Move beyond generic reincarnation tropes. Featured: <a href="/anime/mushoku-tensei-jobless-reincarnation" style="color:#24d3ee;">Mushoku Tensei</a> &bull; <a href="/anime/re-zero" style="color:#24d3ee;">Re:Zero</a>.</p></li>
</ul>
</section>
</main>`;
  } else if (path.startsWith('/news/')) {
    const slug = path.replace('/news/', '').replace(/\/$/, '');
    preHtml = `<main class="crawler-content" style="padding:2rem;max-width:860px;margin:0 auto;line-height:1.7;color:#e2e8f0;">
<nav aria-label="Breadcrumb" style="font-size:0.9rem;margin-bottom:1rem;"><a href="/" style="color:#ff1f4a;">Home</a> &gt; <a href="/news" style="color:#ff1f4a;">News &amp; Guides</a></nav>
<h1>AniHubStream Editorial Analysis: ${slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}</h1>
<p>Read full episode guides, seasonal release calendars, and character deep-dives on AniHubStream. Stream all featured anime episodes online free in 1080p high definition with multi-language subtitles and synchronized broadcast schedules.</p>
<p style="margin-top:2rem;"><a href="/anime/solo-leveling" style="color:#ff1f4a;font-weight:bold;">Watch Solo Leveling</a> &bull; <a href="/anime/jujutsu-kaisen" style="color:#ff1f4a;font-weight:bold;">Watch Jujutsu Kaisen</a> &bull; <a href="/anime/demon-slayer" style="color:#ff1f4a;font-weight:bold;">Watch Demon Slayer</a> &bull; <a href="/news" style="color:#24d3ee;">Back to News Hub</a></p>
</main>`;
  } else if (path === '/' || path === '') {
    const topHomeSlugs = [
      ['solo-leveling', 'Solo Leveling'],
      ['jujutsu-kaisen', 'Jujutsu Kaisen'],
      ['demon-slayer', 'Demon Slayer'],
      ['one-piece', 'One Piece'],
      ['attack-on-titan', 'Attack on Titan'],
      ['sousou-no-frieren', 'Frieren: Beyond Journey\'s End'],
      ['chainsaw-man', 'Chainsaw Man'],
      ['bleach', 'Bleach: Thousand-Year Blood War'],
      ['naruto-shippuden', 'Naruto Shippuden'],
      ['hunter-x-hunter-2011', 'Hunter x Hunter'],
      ['death-note', 'Death Note'],
      ['my-hero-academia', 'My Hero Academia'],
      ['spy-x-family', 'Spy x Family'],
      ['vinland-saga', 'Vinland Saga'],
      ['black-clover', 'Black Clover'],
      ['mushoku-tensei-jobless-reincarnation', 'Mushoku Tensei'],
      ['blue-lock', 'Blue Lock'],
      ['kaiju-no-8', 'Kaiju No. 8'],
      ['tokyo-ghoul', 'Tokyo Ghoul'],
      ['haikyuu', 'Haikyu!!'],
      ['sword-art-online', 'Sword Art Online'],
      ['fullmetal-alchemist-brotherhood', 'Fullmetal Alchemist: Brotherhood'],
      ['overlord', 'Overlord'],
      ['dr-stone', 'Dr. STONE'],
      ['re-zero-starting-life-in-another-world', 'Re:Zero'],
    ];
    const topHomeLinks = topHomeSlugs.map(([slug, name]) =>
      `<a href="/anime/${slug}" style="display:inline-block;padding:0.4rem 0.8rem;background:#181824;color:#f0f0f5;border:1px solid #2e2e42;border-radius:6px;text-decoration:none;margin:0.25rem;">${name}</a>`
    ).join(' ');

    preHtml = `<main class="crawler-content" style="padding:2rem;max-width:960px;margin:0 auto;line-height:1.6;color:#e2e8f0;">
<h1>AniHubStream — Watch High Quality Anime Online Free Anytime, Anywhere</h1>
<p>Welcome to AniHubStream, the next-generation anime streaming platform offering seamless high-definition anime playback, synchronized subtitle streams, instant server switching, and comprehensive episodic navigation across all major releases. Stream subbed and dubbed anime with ultra-low latency, clean weekly broadcast schedules, community ratings, and full episode guides.</p>
<section aria-labelledby="crawler-popular-anime" style="margin:2rem 0;">
<h2 id="crawler-popular-anime">Popular & Trending Anime Series</h2>
<p>Stream trending anime series in full HD with zero ads:</p>
<nav aria-label="Popular Anime" style="display:flex;gap:0.5rem;flex-wrap:wrap;margin:1rem 0;">
${topHomeLinks}
</nav>
<nav aria-label="Quick Links" style="display:flex;gap:0.75rem;flex-wrap:wrap;margin:1rem 0;">
<a href="/anime" style="color:#ff1f4a;text-decoration:underline;font-weight:bold;">Browse All 3,200+ Anime</a> |
<a href="/genres" style="color:#ff1f4a;text-decoration:underline;">All Anime Genres</a> |
<a href="/schedule" style="color:#ff1f4a;text-decoration:underline;">Broadcast Schedule</a> |
<a href="/discover" style="color:#ff1f4a;text-decoration:underline;">Discover Trending Anime</a>
</nav>
</section>
<section aria-labelledby="crawler-features">
<h2 id="crawler-features">Features & Streaming Capabilities</h2>
<p>AniHubStream delivers multi-server redundancy, episode intro and outro auto-skip via AniSkip, customizable subtitle styling, and persistent playback resume across desktop and mobile browsers.</p>
</section>
</main>`;
  } else if (path === '/anime') {
    let topAnimeHtml = '';
    if (env.ANIHUB) {
      try {
        const { results } = await env.ANIHUB.prepare(
          `SELECT id, title, year, rating FROM anime WHERE rating > 7.5 ORDER BY rating DESC LIMIT 24`
        ).all().catch(() => ({ results: [] }));
        if (results && results.length) {
          topAnimeHtml = results.map(a => `<a href="/anime/${a.id}" style="display:inline-block;padding:0.4rem 0.8rem;background:#181824;color:#f0f0f5;border:1px solid #2e2e42;border-radius:6px;text-decoration:none;margin:0.25rem;">${a.title}${a.year ? ` (${a.year})` : ''}</a>`).join(' ');
        }
      } catch (_) {}
    }
    if (!topAnimeHtml) {
      const topSlugs = [
        ['solo-leveling', 'Solo Leveling'],
        ['jujutsu-kaisen', 'Jujutsu Kaisen'],
        ['demon-slayer', 'Demon Slayer'],
        ['one-piece', 'One Piece'],
        ['attack-on-titan', 'Attack on Titan'],
        ['sousou-no-frieren', 'Frieren: Beyond Journey\'s End'],
        ['chainsaw-man', 'Chainsaw Man'],
        ['bleach', 'Bleach: Thousand-Year Blood War'],
        ['naruto-shippuden', 'Naruto Shippuden'],
        ['hunter-x-hunter-2011', 'Hunter x Hunter'],
        ['death-note', 'Death Note'],
        ['my-hero-academia', 'My Hero Academia'],
        ['dandadan', 'DanDaDan'],
        ['spy-x-family', 'Spy x Family'],
        ['vinland-saga', 'Vinland Saga'],
        ['black-clover', 'Black Clover'],
        ['mushoku-tensei-jobless-reincarnation', 'Mushoku Tensei'],
        ['blue-lock', 'Blue Lock'],
        ['kaiju-no-8', 'Kaiju No. 8'],
        ['tokyo-ghoul', 'Tokyo Ghoul'],
      ];
      topAnimeHtml = topSlugs.map(([slug, name]) => `<a href="/anime/${slug}" style="display:inline-block;padding:0.4rem 0.8rem;background:#181824;color:#f0f0f5;border:1px solid #2e2e42;border-radius:6px;text-decoration:none;margin:0.25rem;">${name}</a>`).join(' ');
    }

    preHtml = `<main class="crawler-content" style="padding:2rem;max-width:960px;margin:0 auto;line-height:1.6;color:#e2e8f0;">
<h1>Anime Catalogue — Browse All Series, Movies, and OVAs</h1>
<p>Explore thousands of anime series, films, and seasonal broadcasts with subbed and dubbed video streams, episode ratings, air dates, and complete story synopses.</p>
<section aria-labelledby="crawler-popular-series" style="margin:1.5rem 0;">
<h2 id="crawler-popular-series">Popular & High-Rated Anime Series</h2>
<nav aria-label="Popular Anime" style="display:flex;gap:0.5rem;flex-wrap:wrap;margin:1rem 0;">
${topAnimeHtml}
</nav>
</section>
<section aria-labelledby="crawler-genres" style="margin:1.5rem 0;">
<h2 id="crawler-genres">Browse by Genre</h2>
<nav aria-label="Genre Navigation" style="display:flex;gap:0.5rem;flex-wrap:wrap;margin:1rem 0;">
<a href="/genres?genre=action" style="color:#ff1f4a;">Action</a> |
<a href="/genres?genre=adventure" style="color:#ff1f4a;">Adventure</a> |
<a href="/genres?genre=fantasy" style="color:#ff1f4a;">Fantasy</a> |
<a href="/genres?genre=romance" style="color:#ff1f4a;">Romance</a> |
<a href="/genres?genre=comedy" style="color:#ff1f4a;">Comedy</a> |
<a href="/genres?genre=sci-fi" style="color:#ff1f4a;">Sci-Fi</a> |
<a href="/genres?genre=supernatural" style="color:#ff1f4a;">Supernatural</a>
</nav>
</section>
</main>`;
  }

  // Use HTMLRewriter to dynamically rewrite head tags
  let rewriter = new HTMLRewriter()
    .on('title', {
      element(e) {
        e.setInnerContent(title);
      },
    })
    .on('meta[name="description"]', {
      element(e) {
        e.setAttribute('content', desc);
      },
    })
    .on('link[rel="canonical"]', {
      element(e) {
        e.setAttribute('href', canonical);
      },
    })
    .on('meta[property="og:title"]', {
      element(e) {
        e.setAttribute('content', title);
      },
    })
    .on('meta[property="og:description"]', {
      element(e) {
        e.setAttribute('content', desc);
      },
    })
    .on('meta[property="og:url"]', {
      element(e) {
        e.setAttribute('content', canonical);
      },
    })
    .on('meta[property="og:type"]', {
      element(e) {
        e.setAttribute('content', ogType);
      },
    })
    .on('meta[property="og:image"]', {
      element(e) {
        e.setAttribute('content', ogImage);
      },
    })
    .on('meta[name="twitter:title"]', {
      element(e) {
        e.setAttribute('content', title);
      },
    })
    .on('meta[name="twitter:description"]', {
      element(e) {
        e.setAttribute('content', desc);
      },
    })
    .on('meta[name="twitter:image"]', {
      element(e) {
        e.setAttribute('content', ogImage);
      },
    });

  if (jsonLd) {
    rewriter = rewriter.on('head', {
      element(e) {
        e.append(`\n    <script type="application/ld+json" id="page-schema">${JSON.stringify(jsonLd)}</script>`, { html: true });
      },
    });
  }

  // Preload homepage hero only on homepage
  if (path === '/' || path === '') {
    rewriter = rewriter.on('head', {
      element(e) {
        e.append(`\n    <link rel="preload" as="image" href="/art/hero-demon.webp" type="image/webp" fetchpriority="high" />`, { html: true });
      },
    });
  }

  if (preHtml) {
    rewriter = rewriter.on('#root', {
      element(e) {
        e.setInnerContent(preHtml, { html: true });
      },
    });
  }

  // Determine if this page should have noindex, follow (internal search & parameter filter facets)
  // Note: /news?page=2 pagination is explicitly allowed to be indexed!
  const isSearchPath = path === '/search' || path.startsWith('/search/');
  const hasFilterParams = url.searchParams.has('q') ||
    url.searchParams.has('s') ||
    url.searchParams.has('genre') ||
    url.searchParams.has('status') ||
    url.searchParams.has('format') ||
    url.searchParams.has('sort') ||
    url.searchParams.has('tag') ||
    (url.searchParams.has('page') && path !== '/news');
  const shouldNoIndex = isSearchPath || (hasFilterParams && path !== '/');

  if (shouldNoIndex) {
    rewriter = rewriter.on('meta[name="robots"]', {
      element(e) {
        e.setAttribute('content', 'noindex, follow');
      },
    });
  }

  const finalResponse = await rewriter.transform(response);
  const finalHeaders = new Headers(finalResponse.headers);

  if (shouldNoIndex) {
    finalHeaders.set('X-Robots-Tag', 'noindex, follow');
  }

  // Optimize HTML edge caching for anonymous visitors on public canonical routes:
  // Edge cache for 1 hour, browser cache for 60s, stale-while-revalidate for 1 day
  if (!hasUserSession && finalResponse.status === 200) {
    if (path === '/news' || path.startsWith('/news/')) {
      finalHeaders.set('Cache-Control', 'public, max-age=0, s-maxage=60, must-revalidate');
    } else {
      finalHeaders.set('Cache-Control', 'public, max-age=60, s-maxage=3600, stale-while-revalidate=86400');
    }
  }

  // Cloudflare Early Hints (103) Link headers for pre-warming DNS, fonts, and critical page APIs
  const earlyHints = [
    '<https://s4.anilist.co>; rel=preconnect',
    '<https://fonts.googleapis.com>; rel=preconnect',
    '<https://fonts.gstatic.com>; rel=preconnect; crossorigin',
  ];
  if (path.startsWith('/watch/') && watchMatch?.[1]) {
    earlyHints.push(`</api/anime/${encodeURIComponent(watchMatch[1])}>; rel=preload; as=fetch; crossorigin`);
  } else if (path.startsWith('/anime/') && animeMatch?.[1]) {
    earlyHints.push(`</api/anime/${encodeURIComponent(animeMatch[1])}>; rel=preload; as=fetch; crossorigin`);
  } else if (path === '/' || path === '') {
    earlyHints.push('</api/home>; rel=preload; as=fetch; crossorigin');
  } else if (path === '/schedule') {
    earlyHints.push('</api/schedule>; rel=preload; as=fetch; crossorigin');
  } else if (path === '/genres') {
    earlyHints.push('</api/genres>; rel=preload; as=fetch; crossorigin');
  }
  finalHeaders.set('Link', earlyHints.join(', '));

  const deliveredResponse = new Response(finalResponse.body, {
    status: finalResponse.status,
    statusText: finalResponse.statusText,
    headers: finalHeaders,
  });

  if (hasCloudflareCache && isPublicHtmlRoute && deliveredResponse.status === 200) {
    try {
      if (context.waitUntil) {
        context.waitUntil(caches.default.put(request, deliveredResponse.clone()));
      } else {
        await caches.default.put(request, deliveredResponse.clone());
      }
    } catch (_) {}
  }

  return deliveredResponse;
}
