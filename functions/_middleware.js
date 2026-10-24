import { onRequestGet as sitemapHandler } from './sitemap.xml.js';

export async function onRequest(context) {
  const { request, next, env } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === '/sitemap.xml') {
    return sitemapHandler(context);
  }

  if (path === '/robots.txt') {
    const robots = [
      'User-agent: *',
      'Allow: /',
      'Allow: /anime',
      'Allow: /watch',
      'Disallow: /api/',
      'Disallow: /mylist',
      '',
      `Sitemap: ${url.origin}/sitemap.xml`,
    ].join('\n');
    return new Response(robots, {
      status: 200,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'public, max-age=3600, s-maxage=86400',
      },
    });
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

  const origin = url.origin || 'https://anihubstream.com';
  let title = 'AniHubStream — Watch Anime Free Anytime, Anywhere';
  let desc = 'Watch high-quality anime online free on AniHubStream. Stream subbed and dubbed anime with fast playback, clean schedules, and full episode guides.';
  let canonical = `${origin}${path}`;
  let ogImage = `${origin}/og.png`;
  let ogType = 'website';
  let jsonLd = null;

  // Match /watch/:id or /watch/:id/:ep
  const watchMatch = path.match(/^\/watch\/([A-Za-z0-9_-]+)(?:\/(\d+))?$/);
  // Match /anime/:id (Detail page)
  const animeMatch = path.match(/^\/anime\/([A-Za-z0-9_-]+)$/);

  if (watchMatch || animeMatch) {
    const id = watchMatch ? watchMatch[1] : animeMatch[1];
    const epNum = watchMatch && watchMatch[2] ? Number(watchMatch[2]) : null;

    if (env.ANIHUB) {
      try {
        const row = await env.ANIHUB.prepare(
          `SELECT title, native, year, rating, synopsis, art, key_art, episode_total, kind FROM anime WHERE id = ?1`
        ).bind(id).first();

        if (!row && watchMatch) {
          // Real 404 for non-existent anime on watch page
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
          const yearStr = row.year ? ` (${row.year})` : '';
          const cleanSynopsis = (row.synopsis || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          desc = cleanSynopsis ? cleanSynopsis.slice(0, 150).trim() : `Watch ${animeTitle} free online in high definition on AniHubStream.`;

          if (animeMatch) {
            title = `${animeTitle}${yearStr} — Overview & Episode Guide | AniHubStream`;
            canonical = `${origin}/anime/${id}`;
            ogType = 'video.tv_show';
          } else if (epNum && epNum >= 1) {
            title = `${animeTitle} Ep ${epNum} — Watch Free | AniHubStream`;
            canonical = `${origin}/watch/${id}/${epNum}`;
            ogType = 'video.episode';
          } else {
            title = `${animeTitle}${yearStr} — Watch Free | AniHubStream`;
            canonical = `${origin}/watch/${id}`;
            ogType = 'video.tv_show';
          }

          ogImage = row.key_art || row.art || ogImage;

          const mainEntity = {
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
        }
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

  // Generate crawler-visible semantic HTML body for thin content resolution
  let preHtml = null;
  if (path === '/about') {
    preHtml = `<main class="crawler-content" style="padding:2rem;max-width:800px;margin:0 auto;line-height:1.6;"><h1>About AniHubStream</h1><p>AniHubStream is a high-performance anime streaming platform engineered to provide instant playback, comprehensive metadata, and an ad-free viewing experience. Our catalog features subbed and dubbed anime across TV series, movies, and OVAs, synchronized with leading industry databases including Kitsu and AniList. Designed with edge caching, automated episode guides, and seamless bookmarks.</p></main>`;
  } else if (path === '/dmca') {
    preHtml = `<main class="crawler-content" style="padding:2rem;max-width:800px;margin:0 auto;line-height:1.6;"><h1>DMCA & Copyright Policy</h1><p>AniHubStream respects intellectual property rights and complies with the Digital Millennium Copyright Act (DMCA). AniHubStream does not host media files on its servers; streams are embedded or linked from third-party services. If you believe your copyrighted work is accessible without authorization, please submit a formal takedown request containing the specific URL, description of work, and contact details.</p></main>`;
  } else if (path === '/privacy') {
    preHtml = `<main class="crawler-content" style="padding:2rem;max-width:800px;margin:0 auto;line-height:1.6;"><h1>Privacy Policy</h1><p>AniHubStream is committed to user privacy and minimal data retention. We do not require account registration to stream. Playback positions, preferences, and watchlist bookmarks are stored locally on your device using browser storage. Server logs are strictly anonymized for infrastructure health, caching performance, and DDoS prevention.</p></main>`;
  } else if (path === '/terms') {
    preHtml = `<main class="crawler-content" style="padding:2rem;max-width:800px;margin:0 auto;line-height:1.6;"><h1>Terms of Service</h1><p>Welcome to AniHubStream. By accessing our platform, you agree to these Terms of Service. AniHubStream provides an informational catalog and video streaming client for personal, non-commercial entertainment. Users agree not to misuse platform infrastructure, reverse-engineer proprietary services, or conduct automated scraping that degrades system stability.</p></main>`;
  } else if (path === '/contact') {
    preHtml = `<main class="crawler-content" style="padding:2rem;max-width:800px;margin:0 auto;line-height:1.6;"><h1>Contact AniHubStream</h1><p>Have questions, suggestions, or need to report a playback issue? Contact the AniHubStream development and support team. We continuously refine stream health, subtitle rendering, and catalog accuracy.</p></main>`;
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
    preHtml = `<main class="crawler-content" style="padding:2rem;max-width:800px;margin:0 auto;line-height:1.6;"><h1>Anime Broadcast Schedule</h1><p>Discover when new anime episodes air weekly with local timezone conversion. Stay updated on premiere dates, seasonal broadcast slots, and episode countdowns.</p></main>`;
  } else if (path === '/discover') {
    preHtml = `<main class="crawler-content" style="padding:2rem;max-width:800px;margin:0 auto;line-height:1.6;"><h1>Discover Trending Anime</h1><p>Explore currently trending anime titles, seasonal fan favorites, top-rated series, and recommended hidden gems updated in real-time from community watch metrics.</p></main>`;
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

  if (preHtml) {
    rewriter = rewriter.on('#root', {
      element(e) {
        e.setInnerContent(preHtml, { html: true });
      },
    });
  }

  return rewriter.transform(response);
}
