// @ts-check
/**
 * AnimeHindiDub Download Provider Module for AniHubStream
 * Target: https://animehindidub.net
 * Capabilities: Direct MP4 / Batch ZIP download resolution in Hindi & Multi Audio (Strictly Download-Only)
 */

const BASE_URL = 'https://animehindidub.net';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/**
 * Normalizes an anime title for optimal WordPress search matching
 * @param {string} rawTitle
 * @returns {string[]} Ordered search candidates
 */
function deriveSearchCandidates(rawTitle) {
  if (!rawTitle) return [];
  const clean = rawTitle
    .replace(/\s*\([^)]*\)/g, '') // remove (TV), (Dub), etc.
    .replace(/\s*\[[^\]]*\]/g, '')
    .replace(/:\s*season\s*\d+/gi, '')
    .replace(/\s*season\s*\d+/gi, '')
    .replace(/Part\s*\d+/gi, '')
    .trim();

  const candidates = [clean];

  // If title has a colon or dash, also add the primary part
  if (clean.includes(':')) {
    candidates.push(clean.split(':')[0].trim());
    candidates.push(clean.split(':')[1].trim());
  }
  if (clean.includes('-')) {
    candidates.push(clean.split('-')[0].trim());
  }

  // Deduplicate and filter short items
  return Array.from(new Set(candidates.filter((c) => c && c.length >= 2)));
}

/**
 * Searches AnimeHindiDub WordPress REST API for a matching series or movie
 * @param {string} title
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ link: string; title: string; slug: string; type: 'series' | 'movie' } | null>}
 */
export async function searchAnimeHindiDub(title, signal) {
  const queries = deriveSearchCandidates(title);

  for (const q of queries) {
    // 1. Try /wp/v2/series first
    try {
      const seriesRes = await fetch(`${BASE_URL}/wp-json/wp/v2/series?search=${encodeURIComponent(q)}&per_page=5`, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(4500)]) : AbortSignal.timeout(4500),
      });
      if (seriesRes.ok) {
        const items = await seriesRes.json();
        if (Array.isArray(items) && items.length > 0) {
          // Find best title match
          const qLower = q.toLowerCase();
          const best = items.find((it) => it.title?.rendered?.toLowerCase().includes(qLower)) || items[0];
          return {
            link: best.link || `${BASE_URL}/series/${best.slug}/`,
            title: best.title?.rendered || q,
            slug: best.slug,
            type: 'series',
          };
        }
      }
    } catch (_) {}

    // 2. Try /wp/v2/movies if series not found
    try {
      const movieRes = await fetch(`${BASE_URL}/wp-json/wp/v2/movies?search=${encodeURIComponent(q)}&per_page=5`, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(4500)]) : AbortSignal.timeout(4500),
      });
      if (movieRes.ok) {
        const items = await movieRes.json();
        if (Array.isArray(items) && items.length > 0) {
          const qLower = q.toLowerCase();
          const best = items.find((it) => it.title?.rendered?.toLowerCase().includes(qLower)) || items[0];
          return {
            link: best.link || `${BASE_URL}/movies/${best.slug}/`,
            title: best.title?.rendered || q,
            slug: best.slug,
            type: 'movie',
          };
        }
      }
    } catch (_) {}
  }

  return null;
}

/**
 * Resolves AnimeHindiDub download links for an anime and episode number
 * @param {string} animeTitle
 * @param {number} ep
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ downloads: Array<any>; downloadPage: string | null }>}
 */
export async function resolveAnimeHindiDubDownloads(animeTitle, ep, signal) {
  const emptyResult = { downloads: [], downloadPage: null };
  if (!animeTitle) return emptyResult;

  try {
    const matched = await searchAnimeHindiDub(animeTitle, signal);
    if (!matched || !matched.link) {
      return {
        downloads: [],
        downloadPage: `${BASE_URL}/?s=${encodeURIComponent(animeTitle)}`,
      };
    }

    const downloadPage = matched.link;
    const pageRes = await fetch(downloadPage, {
      headers: {
        'User-Agent': USER_AGENT,
        Referer: `${BASE_URL}/`,
      },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(6000)]) : AbortSignal.timeout(6000),
    });

    if (!pageRes.ok) return { downloads: [], downloadPage };
    const html = await pageRes.text();

    if (!html.includes('animexia-dl-row')) {
      return { downloads: [], downloadPage };
    }

    const downloads = [];
    // Split by season blocks if present, or parse entire rows if single movie
    const seasonBlocks = html.split('<div class="animexia-dl-season-block">');

    if (seasonBlocks.length > 1) {
      for (let s = 1; s < seasonBlocks.length; s++) {
        const block = seasonBlocks[s];
        const seasonMatch = block.match(/<p class="animexia-dl-season-header">\s*([^<]+)<\/p>/);
        const seasonName = seasonMatch ? seasonMatch[1].trim() : `Season ${s}`;

        const rows = block.split('<div class="animexia-dl-row">');
        for (let r = 1; r < rows.length; r++) {
          const item = parseDownloadRow(rows[r], ep, seasonName);
          if (item) downloads.push(item);
        }
      }
    } else {
      // Single movie or unpartitioned rows
      const rows = html.split('<div class="animexia-dl-row">');
      for (let r = 1; r < rows.length; r++) {
        const item = parseDownloadRow(rows[r], ep, matched.type === 'movie' ? 'Movie' : 'Main');
        if (item) downloads.push(item);
      }
    }

    return { downloads, downloadPage };
  } catch (err) {
    console.error('[AnimeHindiDub] Resolution error:', err);
    return emptyResult;
  }
}

/**
 * Parses an individual HTML download row from animehindidub
 * @param {string} rowHtml
 * @param {number} ep
 * @param {string} seasonName
 * @returns {any | null}
 */
function parseDownloadRow(rowHtml, ep, seasonName) {
  const epMatch = rowHtml.match(/class="animexia-dl-badge-ep">([^<]+)</);
  const qMatch = rowHtml.match(/class="animexia-dl-badge-quality">([^<]+)</);
  const sizeMatch = rowHtml.match(/File Size:[\s\S]*?<span class="animexia-dl-value">([^<]+)</);
  const audioMatch = rowHtml.match(/Audio:[\s\S]*?<span class="animexia-dl-value">([^<]+)</);
  const linkMatch = rowHtml.match(/class="animexia-dl-btn"[^>]*href="([^"]+)"/);

  if (!linkMatch || !linkMatch[1]) return null;

  const url = linkMatch[1];
  const epStr = epMatch ? epMatch[1].trim() : '';
  const rawQuality = qMatch ? qMatch[1].trim() : '1080p';
  const size = sizeMatch ? sizeMatch[1].trim() : '';
  const audioStr = audioMatch ? audioMatch[1].trim() : 'Hindi / Multi Audio';
  const isZip = rawQuality.toLowerCase().includes('zip');
  const isBatch = epStr.includes('-') || isZip;

  let matchesEpisode = false;
  if (!epStr) {
    // Single release / Movie
    matchesEpisode = true;
  } else if (isBatch) {
    const matchNums = epStr.match(/\d+/g);
    if (matchNums && matchNums.length >= 2) {
      const start = parseInt(matchNums[0], 10);
      const end = parseInt(matchNums[1], 10);
      if (ep >= start && ep <= end) matchesEpisode = true;
    } else {
      matchesEpisode = true;
    }
  } else {
    const epNum = parseInt(epStr.replace(/\D/g, ''), 10);
    if (!isNaN(epNum) && epNum === ep) matchesEpisode = true;
  }

  // Include if directly matches episode or is a full batch ZIP containing it
  if (!matchesEpisode && !isBatch) {
    return null;
  }

  const cleanQuality = rawQuality.replace(/\s*-\s*ZIP/i, '').trim();

  const epBadgeText = isBatch
    ? `(Batch ${epStr || 'All'})`
    : epStr
    ? `(Ep ${epStr})`
    : seasonName === 'Movie'
    ? '(Movie)'
    : '(Complete)';

  return {
    name: `AnimeHindiDub · ${cleanQuality} ${epBadgeText}${size ? ` · ${size}` : ''}`,
    label: `${cleanQuality} ${size ? `(${size})` : ''}`,
    quality: cleanQuality,
    url,
    provider: 'animehindidub',
    audio: 'hindi',
    type: 'portal',
    format: isZip ? 'ZIP' : 'MP4',
    fileSize: size,
    isBatch,
    audioLabel: audioStr,
    season: seasonName,
  };
}
