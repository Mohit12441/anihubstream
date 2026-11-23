// @ts-check
/**
 * AnimeSalt Stream & Download Provider Module for AniHubStream
 * Target: https://animesalttv.to
 * Capabilities: Native HLS multi-audio streaming (Nekomux Direct M3U8, Ad-Free) and Multi-Quality Downloads (Mega/Direct).
 */

const BASE_URL = 'https://animesalttv.to';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// Ephemeral in-memory cache for resolved anime slugs and stream URLs
const ANIMESALT_CACHE = new Map();
const CACHE_TTL_MS = 20 * 60 * 1000; // 20 minutes

/**
 * Normalizes an anime title for optimal WordPress search matching
 * @param {string} rawTitle
 * @returns {string[]} Ordered search candidates
 */
export function deriveSearchCandidates(rawTitle) {
  if (!rawTitle) return [];
  const clean = rawTitle
    .replace(/\s*\([^)]*\)/g, '') // remove (TV), (Dub), etc.
    .replace(/\s*\[[^\]]*\]/g, '')
    .replace(/:\s*season\s*\d+/gi, '')
    .replace(/\s*season\s*\d+/gi, '')
    .replace(/Part\s*\d+/gi, '')
    .trim();

  const candidates = [clean];

  if (clean.includes(':')) {
    candidates.push(clean.split(':')[0].trim());
    candidates.push(clean.split(':')[1].trim());
  }
  if (clean.includes('-')) {
    candidates.push(clean.split('-')[0].trim());
  }

  return Array.from(new Set(candidates.filter((c) => c && c.length >= 2)));
}

/**
 * Normalizes title for token comparison
 * @param {string} s
 * @returns {string}
 */
export function cleanTitle(s) {
  return (s || '')
    .replace(/&#\d+;/g, '')
    .replace(/&[a-z]+;/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Validates that candidate title is a legitimate match for query title
 * @param {string} query
 * @param {string} candidate
 * @returns {boolean}
 */
export function isStrictTitleMatch(query, candidate) {
  const q = cleanTitle(query);
  const c = cleanTitle(candidate);
  if (!q || !c) return false;

  if (q === c || c.includes(q) || q.includes(c)) return true;

  const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'in', 'on', 'at', 'of', 'for', 'to', 'season', 'part', 'movie', 'tv']);
  const qTokens = q.split(' ').filter((w) => w.length >= 2 && !stopWords.has(w));
  const cTokens = new Set(c.split(' ').filter((w) => w.length >= 2 && !stopWords.has(w)));

  if (qTokens.length === 0) return q === c;

  let matches = 0;
  for (const token of qTokens) {
    if (cTokens.has(token) || Array.from(cTokens).some((ct) => ct.includes(token) || token.includes(ct))) {
      matches++;
    }
  }

  return (matches / qTokens.length) >= 0.7;
}

/**
 * Searches AnimeSalt WordPress REST API for a matching anime
 * @param {string} title
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ link: string; title: string; slug: string; id: number } | null>}
 */
export async function searchAnimeSalt(title, signal) {
  const cacheKey = `search:${cleanTitle(title)}`;
  const cached = ANIMESALT_CACHE.get(cacheKey);
  if (cached && cached.expires > Date.now()) {
    return cached.data;
  }

  const queries = deriveSearchCandidates(title);

  for (const q of queries) {
    try {
      const searchUrl = `${BASE_URL}/wp-json/wp/v2/anime?search=${encodeURIComponent(q)}&per_page=10`;
      const res = await fetch(searchUrl, {
        headers: {
          'user-agent': USER_AGENT,
          referer: `${BASE_URL}/`,
        },
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000),
      });

      if (!res.ok) continue;
      const items = await res.json();
      if (!Array.isArray(items) || items.length === 0) continue;

      for (const item of items) {
        const rawTitle = item.title?.rendered || '';
        if (isStrictTitleMatch(q, rawTitle) || isStrictTitleMatch(title, rawTitle)) {
          const match = {
            id: item.id,
            title: rawTitle,
            slug: item.slug,
            link: item.link || `${BASE_URL}/anime/${item.slug}/`,
          };
          ANIMESALT_CACHE.set(cacheKey, { data: match, expires: Date.now() + CACHE_TTL_MS });
          return match;
        }
      }
    } catch {
      // Continue to next candidate
    }
  }

  return null;
}

/**
 * Fetches episode HTML by checking standard slug pattern or anime overview page
 * @param {string} slug
 * @param {number} season
 * @param {number} ep
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ html: string; episodeUrl: string } | null>}
 */
async function fetchEpisodeHtml(slug, season = 1, ep = 1, signal) {
  const primaryUrl = `${BASE_URL}/episode/${slug}-${season}x${ep}/`;

  try {
    const res = await fetch(primaryUrl, {
      headers: {
        'user-agent': USER_AGENT,
        referer: `${BASE_URL}/`,
      },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(6000)]) : AbortSignal.timeout(6000),
    });

    if (res.ok) {
      const html = await res.text();
      return { html, episodeUrl: primaryUrl };
    }
  } catch {}

  // Fallback: Query anime overview page to find mapped episode URL
  try {
    const animeUrl = `${BASE_URL}/anime/${slug}/`;
    const aRes = await fetch(animeUrl, {
      headers: {
        'user-agent': USER_AGENT,
        referer: `${BASE_URL}/`,
      },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(6000)]) : AbortSignal.timeout(6000),
    });

    if (aRes.ok) {
      const aHtml = await aRes.text();
      // Match episode link pattern: /episode/{slug}-{season}x{ep}/ or /episode/{slug}-{ep}/
      const regexPatterns = [
        new RegExp(`https:\\/\\/animesalttv\\.to\\/episode\\/[^"']*?-${season}x${ep}\\/`, 'i'),
        new RegExp(`https:\\/\\/animesalttv\\.to\\/episode\\/[^"']*?-1x${ep}\\/`, 'i'),
        new RegExp(`https:\\/\\/animesalttv\\.to\\/episode\\/[^"']*?-${ep}\\/`, 'i'),
      ];

      for (const pattern of regexPatterns) {
        const match = aHtml.match(pattern);
        if (match) {
          const fallbackUrl = match[0];
          const fRes = await fetch(fallbackUrl, {
            headers: {
              'user-agent': USER_AGENT,
              referer: `${BASE_URL}/`,
            },
            signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(6000)]) : AbortSignal.timeout(6000),
          });
          if (fRes.ok) {
            const html = await fRes.text();
            return { html, episodeUrl: fallbackUrl };
          }
        }
      }
    }
  } catch {}

  return null;
}

/**
 * Resolves native HLS master playlist from Nekomux without iframes or ads
 * @param {string} episodeHtml
 * @param {string} episodeUrl
 * @param {AbortSignal} [signal]
 * @returns {Promise<string | null>}
 */
async function extractNekomuxHls(episodeHtml, episodeUrl, signal) {
  const nekomuxMatch = episodeHtml.match(/https:\/\/player\.nekomux\.com\/episode\/\d+/i);
  if (!nekomuxMatch) return null;

  const nekomuxEmbed = nekomuxMatch[0];

  try {
    const nRes = await fetch(nekomuxEmbed, {
      headers: {
        'user-agent': USER_AGENT,
        referer: episodeUrl,
      },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000),
    });

    if (!nRes.ok) return null;
    const nHtml = await nRes.text();

    const sourceMatch = nHtml.match(/data-source=["'](https:\/\/player\.nekomux\.com\/episode\/\d+\/source)["']/i);
    const sourceUrl = sourceMatch ? sourceMatch[1] : `${nekomuxEmbed}/source`;

    const sRes = await fetch(sourceUrl, {
      headers: {
        'user-agent': USER_AGENT,
        referer: nekomuxEmbed,
        accept: 'application/json',
      },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000),
    });

    if (!sRes.ok) return null;
    const sData = await sRes.json();
    if (sData?.ok && sData?.url) {
      return sData.url;
    }
  } catch {}

  return null;
}

/**
 * Extracts available audio languages from Abyss multi-language payload
 * @param {string} episodeHtml
 * @returns {Array<{ language: string; link?: string }>}
 */
function extractAvailableLanguages(episodeHtml) {
  const abyssMatch = episodeHtml.match(/abyss-multilang\.php\?data=([A-Za-z0-9+/=]+)/);
  if (abyssMatch) {
    try {
      const decoded = JSON.parse(atob(abyssMatch[1]));
      if (Array.isArray(decoded) && decoded.length > 0) {
        return decoded;
      }
    } catch {}
  }
  return [
    { language: 'Hindi' },
    { language: 'English' },
    { language: 'Japanese' }
  ];
}

/**
 * Extracts external subtitle track from AnimeSalt episode HTML or embedded multi-stream player
 * @param {string} episodeHtml
 * @param {AbortSignal} [signal]
 * @returns {Promise<Array<{ lang: string; url: string; default: boolean }>>}
 */
async function extractSubtitles(episodeHtml, signal) {
  const subtitles = [];

  // 1. Check direct subtitle URLs in HTML
  let subMatch = episodeHtml.match(/playerjsSubtitle\s*=\s*["'](?:\[([^\]]+)\])?([^"']+)["']/i);
  let subUrl = subMatch ? subMatch[2] : null;
  let subLang = subMatch && subMatch[1] ? subMatch[1] : 'English';

  // 2. Check multi-server embed player (Ravok or similar) if not in outer HTML
  if (!subUrl) {
    const multiMatch = episodeHtml.match(/https:\/\/(?:ravok\.buzz|[^"'\s]+)\/video\/[a-zA-Z0-9]+/i);
    if (multiMatch) {
      try {
        const res = await fetch(multiMatch[0], {
          headers: {
            'user-agent': USER_AGENT,
            referer: `${BASE_URL}/`,
          },
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(4000)]) : AbortSignal.timeout(4000),
        });
        if (res.ok) {
          const rHtml = await res.text();
          const rMatch = rHtml.match(/playerjsSubtitle\s*=\s*["'](?:\[([^\]]+)\])?([^"']+)["']/i);
          if (rMatch) {
            subLang = rMatch[1] || 'English';
            subUrl = rMatch[2];
          }
        }
      } catch {}
    }
  }

  if (subUrl) {
    subtitles.push({
      lang: subLang,
      url: `/api/proxy?url=${encodeURIComponent(subUrl)}&referer=${encodeURIComponent('https://ravok.buzz/')}&type=sub`,
      default: true,
    });
  }

  return subtitles;
}

/**
 * Resolves direct native streaming for AnimeSalt
 * @param {{ title: string; ep?: number; season?: number; audio?: string; signal?: AbortSignal }} options
 * @returns {Promise<{
 *   streamUrl: string;
 *   referer: string;
 *   quality: string;
 *   provider: string;
 *   type: string;
 *   audio: string;
 *   audioTracks: Array<{ id: string; language: string; label: string; default: boolean }>;
 *   subtitles: any[];
 *   downloads: any[];
 * } | null>}
 */
export async function resolveAnimeSaltDirect({ title, ep = 1, season = 1, audio = 'dub', signal }) {
  if (!title) return null;

  const animeMatch = await searchAnimeSalt(title, signal);
  if (!animeMatch?.slug) return null;

  const pageData = await fetchEpisodeHtml(animeMatch.slug, season, ep, signal);
  if (!pageData?.html) return null;

  const masterM3u8 = await extractNekomuxHls(pageData.html, pageData.episodeUrl, signal);
  if (!masterM3u8) return null;

  const rawLanguages = extractAvailableLanguages(pageData.html);
  const audioTracks = rawLanguages.map((item, idx) => {
    const lang = typeof item === 'string' ? item : item.language;
    const l = (lang || '').toLowerCase();
    const code = l === 'hindi' ? 'hi'
      : l === 'english' ? 'en'
      : l === 'japanese' ? 'ja'
      : l === 'tamil' ? 'ta'
      : l === 'telugu' ? 'te'
      : l === 'malayalam' ? 'ml'
      : l === 'bengali' ? 'bn'
      : l === 'kannada' ? 'kn'
      : l === 'marathi' ? 'mr'
      : l === 'korean' ? 'ko'
      : l.slice(0, 2);

    return {
      id: `animesalt-${code}`,
      language: code,
      label: `${lang} Dub`,
      default: idx === 0,
    };
  });

  const [subtitles, dlResult] = await Promise.all([
    extractSubtitles(pageData.html, signal).catch(() => []),
    resolveAnimeSaltDownloads(title, ep, season, signal).catch(() => ({ downloads: [], downloadPage: null })),
  ]);

  return {
    streamUrl: masterM3u8,
    referer: 'https://player.nekomux.com/',
    quality: '480p',
    provider: 'animesalt',
    type: 'hls',
    audio: audio === 'sub' ? 'sub' : 'dub',
    audioTracks,
    subtitles,
    downloads: dlResult.downloads || [],
  };
}

/**
 * Resolves direct downloads for AnimeSalt
 * @param {string} title
 * @param {number} ep
 * @param {number} [season]
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ downloads: any[]; downloadPage: string | null }>}
 */
export async function resolveAnimeSaltDownloads(title, ep = 1, season = 1, signal) {
  if (!title) return { downloads: [], downloadPage: null };

  const animeMatch = await searchAnimeSalt(title, signal);
  if (!animeMatch?.slug) return { downloads: [], downloadPage: null };

  const pageData = await fetchEpisodeHtml(animeMatch.slug, season, ep, signal);
  if (!pageData?.html) {
    return {
      downloads: [],
      downloadPage: `${BASE_URL}/anime/${animeMatch.slug}/`,
    };
  }

  const downloads = [];
  const dlMatches = [...pageData.html.matchAll(/class=["']as-dl-row["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];

  for (const dl of dlMatches) {
    const qMatch = dl[2].match(/class=["']as-dl-q["']>([^<]+)</);
    const hostMatch = dl[2].match(/class=["']as-dl-host["']>([^<]+)</);
    const langMatch = dl[2].match(/class=["']as-dl-lang["']>([^<]+)</);

    const quality = qMatch ? qMatch[1].trim() : '1080p';
    const host = hostMatch ? hostMatch[1].trim() : 'Mega';
    const lang = langMatch ? langMatch[1].trim() : 'Multi-Audio';

    downloads.push({
      name: `AnimeSalt ${host} · ${quality} (${lang})`,
      label: `AnimeSalt ${quality}`,
      quality,
      url: dl[1],
      provider: 'animesalt',
      audio: lang.toLowerCase().includes('hindi') ? 'dub' : 'multi',
      type: 'direct',
      format: 'MP4',
      server: host,
    });
  }

  return {
    downloads,
    downloadPage: pageData.episodeUrl,
  };
}
