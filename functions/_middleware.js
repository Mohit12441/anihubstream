import { onRequestGet as sitemapHandler } from './sitemap.xml.js';

export async function onRequest(context) {
  const { request, next, env } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === '/sitemap.xml') {
    return sitemapHandler(context);
  }

  // Static assets and api routes pass through untouched
  if (
    path.startsWith('/api/') ||
    path === '/api' ||
    path.startsWith('/art/') ||
    path.startsWith('/assets/') ||
    path.endsWith('.js') ||
    path.endsWith('.css') ||
    path.endsWith('.png') ||
    path.endsWith('.jpg') ||
    path.endsWith('.svg') ||
    path.endsWith('.ico') ||
    path.endsWith('.webmanifest') ||
    path.endsWith('.txt')
  ) {
    return next();
  }

  // Let Pages serve the static index.html or route asset
  const response = await next();
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) {
    return response;
  }

  const origin = 'https://anihubstream.com';
  let title = 'AniHubStream — Watch Anime Free Anytime, Anywhere';
  let desc = 'Watch high-quality anime online free on AniHubStream. Stream subbed and dubbed anime with fast playback, clean schedules, and full episode guides.';
  let canonical = `${origin}${path}`;
  let ogImage = `${origin}/og.png`;
  let ogType = 'website';
  let jsonLd = null;

  // Match /watch/:id or /watch/:id/:ep
  const watchMatch = path.match(/^\/watch\/([A-Za-z0-9_-]+)(?:\/(\d+))?$/);
  if (watchMatch) {
    const id = watchMatch[1];
    const epNum = watchMatch[2] ? Number(watchMatch[2]) : null;

    if (env.ANIHUB) {
      try {
        const row = await env.ANIHUB.prepare(
          `SELECT title, native, year, rating, synopsis, art, key_art, episode_total, kind FROM anime WHERE id = ?1`
        ).bind(id).first();

        if (!row) {
          // Real 404 for non-existent anime
          return new Response(
            `<!doctype html><html lang="en"><head><meta charset="UTF-8"><title>Anime Not Found | AniHubStream</title><meta name="robots" content="noindex"><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>body{background:#07070b;color:#f0f0f5;font-family:sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;text-align:center;}a{color:#ff1f4a;text-decoration:none;font-weight:bold;}</style></head><body><div><h1>404 — Anime Not Found</h1><p>The anime "${id}" could not be found.</p><p><a href="/">Return to Homepage</a></p></div></body></html>`,
            {
              status: 404,
              headers: { 'content-type': 'text/html; charset=utf-8' },
            }
          );
        }

        const animeTitle = row.title || id;
        const yearStr = row.year ? ` (${row.year})` : '';
        const cleanSynopsis = (row.synopsis || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        desc = cleanSynopsis ? cleanSynopsis.slice(0, 150).trim() : `Watch ${animeTitle} free online in high definition on AniHubStream.`;

        if (epNum && epNum > 1) {
          title = `${animeTitle} Episode ${epNum} — Watch Online Free | AniHubStream`;
          canonical = `${origin}/watch/${id}/${epNum}`;
          ogType = 'video.episode';
        } else {
          title = `${animeTitle}${yearStr} — Watch Online Free | AniHubStream`;
          canonical = `${origin}/watch/${id}`;
          ogType = 'video.tv_show';
        }

        ogImage = row.key_art || row.art || ogImage;

        jsonLd = {
          '@context': 'https://schema.org',
          '@type': epNum ? 'TVEpisode' : 'TVSeries',
          name: epNum ? `${animeTitle} Episode ${epNum}` : animeTitle,
          alternateName: row.native || undefined,
          description: desc,
          image: ogImage,
          url: canonical,
          ...(epNum ? { episodeNumber: epNum } : {}),
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
      } catch (e) {
        console.error('Middleware D1 lookup failed:', e);
      }
    }
  } else if (path === '/') {
    jsonLd = {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: 'AniHubStream',
      url: origin,
      potentialAction: {
        '@type': 'SearchAction',
        target: `${origin}/anime?search={search_term_string}`,
        'query-input': 'required name=search_term_string',
      },
    };
  } else if (path === '/anime') {
    title = 'Browse Anime Catalogue — Discover Series & Movies | AniHubStream';
    desc = 'Explore the full AniHubStream anime catalogue. Filter by genre, release year, format (TV, Movie, OVA), and rating.';
  } else if (path === '/genres') {
    title = 'Anime Genres & Categories | AniHubStream';
    desc = 'Browse anime by genre: Action, Adventure, Comedy, Drama, Fantasy, Romance, Sci-Fi, Slice of Life, and more.';
  } else if (path === '/schedule') {
    title = 'Anime Broadcast Schedule — Airing This Week | AniHubStream';
    desc = 'Live weekly anime release schedule. Check episode air dates, broadcast times, and currently airing seasons.';
  } else if (path === '/discover') {
    title = 'Discover Trending & Popular Anime | AniHubStream';
    desc = 'Find your next favorite anime series. Browse trending releases, community favorites, and staff picks.';
  } else if (path === '/about') {
    title = 'About AniHubStream — Free Anime Streaming Platform';
    desc = 'Learn about AniHubStream, our mission, catalog data sources (Kitsu, AniList), and high-performance streaming architecture.';
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
        e.append(`\n    <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`, { html: true });
      },
    });
  }

  return rewriter.transform(response);
}
