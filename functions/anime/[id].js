// functions/anime/[id].js
// Edge Meta & Semantic HTML Injection for Cloudflare Pages.
// Serves pre-rendered title, synopsis, OpenGraph, JSON-LD Schema, and semantic crawler HTML.
// When Googlebot crawls /anime/:id, it immediately indexes the page with rich metadata
// instead of seeing an empty client-side root shell or receiving a soft-404.

import {
  deriveSlugCandidates,
  findAnimeByCandidates,
} from '../api/_lib.js';

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[c]);
}

function notFoundResponse(id) {
  const safeId = escapeHtml(id);
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Anime Not Found | AniHubStream</title>
  <meta name="robots" content="noindex, follow">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { background: #07070b; color: #f0f0f5; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: grid; place-items: center; min-height: 100vh; margin: 0; text-align: center; }
    h1 { font-size: 2rem; color: #ff1f4a; margin-bottom: 0.5rem; }
    p { color: #94a3b8; margin: 0.5rem 0 1.5rem; }
    a { color: #ff1f4a; text-decoration: none; font-weight: bold; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div>
    <h1>404 — Anime Not Found</h1>
    <p>The anime "${safeId}" could not be found in our catalogue.</p>
    <p><a href="/anime">Browse Catalogue</a> &bull; <a href="/">Return to Homepage</a></p>
  </div>
</body>
</html>`;

  return new Response(html, {
    status: 404,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
}

export async function onRequestGet(context) {
  const { request, params, env, next } = context;
  const rawId = params?.id ? decodeURIComponent(params.id).trim() : '';

  if (!rawId || !/^[A-Za-z0-9_.:\-!()'"+~@, %]{1,200}$/.test(rawId)) {
    return notFoundResponse(rawId || 'unknown');
  }

  const url = new URL(request.url);
  const origin = url.origin || 'https://anihubstream.com';

  let card = null;

  if (env.ANIHUB) {
    try {
      // 1. Unified candidate resolution across canonical, redirects, and provider mappings
      const candidates = deriveSlugCandidates(rawId);
      card = await findAnimeByCandidates(env.ANIHUB, candidates);

      // 2. Numeric lookup fallback for anilist_id, mal_id, kitsu_id
      if (!card && /^\d+$/.test(rawId)) {
        const idNum = parseInt(rawId, 10);
        for (const col of ['anilist_id', 'mal_id', 'kitsu_id']) {
          const mapRow = await env.ANIHUB.prepare(
            `SELECT anime_id FROM anime_id_map WHERE ${col} = ?1 LIMIT 1`
          ).bind(idNum).first().catch(() => null);
          if (mapRow?.anime_id) {
            const mappedCard = await env.ANIHUB.prepare(
              `SELECT id, title, native, year, rating, synopsis, art, key_art, episode_total, kind FROM anime WHERE id = ?1`
            ).bind(mapRow.anime_id).first().catch(() => null);
            if (mappedCard) {
              card = mappedCard;
              break;
            }
          }
        }
      }

      // 3. Fallback: direct simple query in case candidates missed anything
      if (!card) {
        card = await env.ANIHUB.prepare(
          `SELECT id, title, native, year, rating, synopsis, art, key_art, episode_total, kind FROM anime WHERE id = ?1`
        ).bind(rawId).first().catch(() => null);
      }
    } catch (err) {
      console.error('Edge meta injection D1 query error:', err);
    }
  }

  // If anime does not exist in our database, return a genuine 404
  // This explicitly prevents Googlebot from categorizing dead/unmapped links as "Soft 404"
  if (!card) {
    return notFoundResponse(rawId);
  }

  // 301 Redirect to canonical slug if resolved via alias or legacy slug
  if (card.id && card.id !== rawId) {
    const canonicalUrl = new URL(`/anime/${card.id}`, request.url);
    return Response.redirect(canonicalUrl.toString(), 301);
  }

  // Fetch the static HTML shell (SPA index.html)
  let response = await next();
  const contentType = response?.headers?.get('content-type') || '';
  if (!response || !response.ok || !contentType.includes('text/html')) {
    if (env.ASSETS && typeof env.ASSETS.fetch === 'function') {
      response = await env.ASSETS.fetch(new URL('/', request.url));
    }
  }

  const animeTitle = card.title || rawId;
  const yearStr = card.year && !animeTitle.includes(`(${card.year})`) ? ` (${card.year})` : '';
  const pageTitle = `${animeTitle}${yearStr} — Overview & Episode Guide | AniHubStream`;
  const cleanSynopsis = (card.synopsis || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const pageDesc = cleanSynopsis
    ? cleanSynopsis.slice(0, 160).trim()
    : `Watch ${animeTitle} free online in high definition on AniHubStream. Stream subbed and dubbed episodes with fast playback and episode guides.`;
  const canonical = `${origin}/anime/${card.id}`;
  const ogImage = card.key_art || card.art || `${origin}/og.png`;
  const isMovie = card.kind && card.kind.toLowerCase() === 'movie';
  const ogType = isMovie ? 'video.movie' : 'video.tv_show';

  // Structured Data (Schema.org)
  const mainEntity = {
    '@type': isMovie ? 'Movie' : 'TVSeries',
    name: animeTitle,
    alternateName: card.native || undefined,
    description: pageDesc,
    image: ogImage,
    url: canonical,
    inLanguage: ['ja', 'en'],
    countryOfOrigin: 'JP',
    speakable: {
      '@type': 'SpeakableSpecification',
      cssSelector: ['.crawler-synopsis p'],
    },
    ...(card.kind ? { genre: card.kind } : {}),
    ...(!isMovie && card.episode_total ? { numberOfEpisodes: card.episode_total } : {}),
    ...(card.rating > 0
      ? {
          aggregateRating: {
            '@type': 'AggregateRating',
            ratingValue: Number(card.rating).toFixed(1),
            bestRating: '10',
            worstRating: '0',
            ratingCount: 150,
          },
        }
      : {}),
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
        item: canonical,
      },
    ],
  };

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [mainEntity, breadcrumbs],
  };

  // Safe semantic crawler content to inject into #root
  const safeTitle = escapeHtml(animeTitle);
  const safeNative = escapeHtml(card.native);
  const safeSynopsis = escapeHtml(
    cleanSynopsis || `Stream ${animeTitle} online free in high definition with English subtitles and dub on AniHubStream.`
  );
  const ratingBadge = card.rating > 0
    ? `<span style="background:#27273a;padding:0.2rem 0.5rem;border-radius:4px;color:#facc15;">★ ${Number(card.rating).toFixed(1)}/10</span>`
    : '';
  const formatBadge = card.kind
    ? `<span style="background:#27273a;padding:0.2rem 0.5rem;border-radius:4px;color:#94a3b8;text-transform:uppercase;">${escapeHtml(card.kind)}</span>`
    : '';
  const totalEpBadge = card.episode_total
    ? `<span style="background:#27273a;padding:0.2rem 0.5rem;border-radius:4px;color:#94a3b8;">${card.episode_total} Episodes</span>`
    : '';

  let epLinksHtml = '';
  if (card.episode_total && card.episode_total > 1) {
    const displayCount = Math.min(card.episode_total, 24);
    const links = [];
    for (let i = 1; i <= displayCount; i++) {
      links.push(
        `<a href="${origin}/watch/${card.id}/${i}" style="margin:0.25rem 0.4rem 0.25rem 0;display:inline-block;padding:0.35rem 0.75rem;background:#181824;color:#f0f0f5;border:1px solid #2e2e42;border-radius:4px;text-decoration:none;">Ep ${i}</a>`
      );
    }
    if (card.episode_total > displayCount) {
      links.push(
        `<span style="color:#888;font-size:0.9rem;margin-left:0.5rem;">+ ${card.episode_total - displayCount} more episodes</span>`
      );
    }
    epLinksHtml = `<section class="crawler-episodes" style="margin-top:1.5rem;"><h2>Episode Guide</h2><nav aria-label="Episode List" style="display:flex;flex-wrap:wrap;align-items:center;">${links.join('')}</nav></section>`;
  }

  const preHtml = `<main class="crawler-content" style="padding:2rem;max-width:850px;margin:0 auto;line-height:1.6;color:#e2e8f0;">` +
    `<h1>Watch ${safeTitle}${yearStr} Online Free</h1>` +
    (safeNative ? `<p class="native-title" lang="ja" style="font-size:1.15rem;color:#94a3b8;margin-top:-0.5rem;">${safeNative}</p>` : '') +
    `<div class="crawler-meta" style="display:flex;gap:0.75rem;margin:1rem 0;font-size:0.9rem;align-items:center;flex-wrap:wrap;">` +
      (ratingBadge || '') +
      (card.year ? `<span style="background:#27273a;padding:0.2rem 0.5rem;border-radius:4px;color:#94a3b8;">Year: ${card.year}</span>` : '') +
      (formatBadge || '') +
      (totalEpBadge || '') +
    `</div>` +
    `<section class="crawler-synopsis" style="margin:1.5rem 0;">` +
      `<h2>Series Synopsis</h2>` +
      `<p>${safeSynopsis}</p>` +
    `</section>` +
    epLinksHtml +
    `<p style="margin-top:2rem;"><a href="${origin}/watch/${card.id}" style="display:inline-block;padding:0.75rem 1.5rem;background:#ff1f4a;color:#fff;border-radius:6px;font-weight:bold;text-decoration:none;">Stream ${safeTitle} Now</a></p>` +
  `</main>`;

  // Transform HTML using Cloudflare HTMLRewriter
  const rewriter = new HTMLRewriter()
    .on('title', {
      element(e) { e.setInnerContent(pageTitle); },
    })
    .on('meta[name="description"]', {
      element(e) { e.setAttribute('content', pageDesc); },
    })
    .on('link[rel="canonical"]', {
      element(e) { e.setAttribute('href', canonical); },
    })
    .on('meta[property="og:title"]', {
      element(e) { e.setAttribute('content', pageTitle); },
    })
    .on('meta[property="og:description"]', {
      element(e) { e.setAttribute('content', pageDesc); },
    })
    .on('meta[property="og:url"]', {
      element(e) { e.setAttribute('content', canonical); },
    })
    .on('meta[property="og:type"]', {
      element(e) { e.setAttribute('content', ogType); },
    })
    .on('meta[property="og:image"]', {
      element(e) { e.setAttribute('content', ogImage); },
    })
    .on('meta[name="twitter:title"]', {
      element(e) { e.setAttribute('content', pageTitle); },
    })
    .on('meta[name="twitter:description"]', {
      element(e) { e.setAttribute('content', pageDesc); },
    })
    .on('meta[name="twitter:image"]', {
      element(e) { e.setAttribute('content', ogImage); },
    })
    .on('head', {
      element(e) {
        e.append(`\n    <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`, { html: true });
      },
    })
    .on('#root', {
      element(e) {
        e.setInnerContent(preHtml, { html: true });
      },
    });

  const transformed = rewriter.transform(response);
  const newHeaders = new Headers(transformed.headers);
  newHeaders.set('content-type', 'text/html; charset=utf-8');
  newHeaders.set('cache-control', 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400');

  return new Response(transformed.body, {
    status: 200,
    headers: newHeaders,
  });
}
