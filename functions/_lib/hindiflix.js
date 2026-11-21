// @ts-check

const HINDIFLIX_BASE = 'https://hindiflix.cc';
const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Referer': `${HINDIFLIX_BASE}/`,
  'Origin': HINDIFLIX_BASE,
};

const HINDIFLIX_SERIES_CACHE = new Map();
const HINDIFLIX_STREAM_CACHE = new Map();
const HINDIFLIX_CACHE_TTL = 30 * 60 * 1000;

/**
 * Searches and extracts direct stream payload for an anime title and episode on HindiFlix.
 * @param {string} title
 * @param {number|string} ep
 * @returns {Promise<{ streamUrl: string, type: 'mp4', quality: string } | null>}
 */
export async function resolveHindiFlixStream(title, ep = 1) {
  if (!title) return null;

  const streamKey = `${String(title).toLowerCase().trim()}:${ep}`;
  const cachedStream = HINDIFLIX_STREAM_CACHE.get(streamKey);
  if (cachedStream && Date.now() < cachedStream.expires) {
    return cachedStream.data;
  }

  const queries = [];
  const rawClean = String(title).replace(/[-_]+/g, ' ').trim();
  const seasonMatch = /(?:season\s*(\d+)|s(\d+)|(\d+)(?:st|nd|rd|th)\s*season)/i.exec(rawClean);
  const seasonNum = seasonMatch ? (seasonMatch[1] || seasonMatch[2] || seasonMatch[3]) : null;

  // Primary base name: strip subtitle suffixes and season suffixes
  const baseName = rawClean
    .split(/[:]/)[0]
    .replace(/\s*\(Season \d+\)|\s*Season \d+.*$|\s*\d+(?:st|nd|rd|th)\s*season.*$/i, '')
    .trim();

  if (seasonNum && baseName) {
    queries.push(`${baseName} Season ${seasonNum}`);
    queries.push(`${baseName} ${seasonNum}`);
  }
  if (baseName && !queries.includes(baseName)) {
    queries.push(baseName);
  }
  const strippedTitle = rawClean.replace(/\s*\(Season \d+\)|\s*Season \d+.*$|\s*\d+(?:st|nd|rd|th)\s*season.*$/i, '').trim();
  if (strippedTitle && !queries.includes(strippedTitle)) {
    queries.push(strippedTitle);
  }
  if (rawClean && !queries.includes(rawClean)) {
    queries.push(rawClean);
  }

  try {
    // 1. Search HindiFlix via AJAX in parallel across candidate queries
    let hits = [];
    const searchPromises = queries.slice(0, 3).map((q) =>
      fetch(`${HINDIFLIX_BASE}/wp-admin/admin-ajax.php`, {
        method: 'POST',
        headers: {
          ...DEFAULT_HEADERS,
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: new URLSearchParams({
          action: 'ts_ac_do_search',
          ts_ac_query: q,
        }).toString(),
        signal: AbortSignal.timeout(3500),
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => data?.anime?.[0]?.all || [])
        .catch(() => [])
    );

    const results = await Promise.all(searchPromises);
    for (const resHits of results) {
      if (resHits.length > 0) {
        hits = resHits;
        break;
      }
    }

    if (!hits.length) return null;

    let hit = hits[0];
    const targetSeason = seasonNum || '1';

    // Prioritize matching the target season (e.g. season-1, season 1, s01, s1)
    const matchedHit = hits.find((h) => {
      const link = (h.post_link || '').toLowerCase();
      const t = (h.post_title || '').toLowerCase();
      return (
        link.includes(`season-${targetSeason}`) ||
        t.includes(`season ${targetSeason}`) ||
        t.includes(`(season ${targetSeason})`) ||
        t.includes(`s0${targetSeason}`) ||
        t.includes(`s${targetSeason}`)
      );
    });

    if (matchedHit) {
      hit = matchedHit;
    } else if (targetSeason === '1') {
      // If asking for Season 1 (or default base series), avoid sequels like Season 2, 3, etc.
      const nonSequelHit = hits.find((h) => {
        const link = (h.post_link || '').toLowerCase();
        const t = (h.post_title || '').toLowerCase();
        return !/season[- ]([2-9]|\d{2})/i.test(link) && !/season[- ]([2-9]|\d{2})/i.test(t);
      });
      if (nonSequelHit) hit = nonSequelHit;
    }

    let seriesHtml = '';
    const cachedSeries = HINDIFLIX_SERIES_CACHE.get(hit.post_link);
    if (cachedSeries && Date.now() < cachedSeries.expires) {
      seriesHtml = cachedSeries.html;
    } else {
      const seriesRes = await fetch(hit.post_link, {
        headers: DEFAULT_HEADERS,
        signal: AbortSignal.timeout(4000),
      });
      if (!seriesRes.ok) return null;
      seriesHtml = await seriesRes.text();
      if (seriesHtml) {
        HINDIFLIX_SERIES_CACHE.set(hit.post_link, {
          html: seriesHtml,
          expires: Date.now() + HINDIFLIX_CACHE_TTL,
        });
      }
    }
    const epRegex = /<a[^>]+href="(https:\/\/hindiflix\.cc\/[^"]*(?:episode|ep)-(\d+)[^"]*)"[^>]*>/gi;
    let targetUrl = null;
    let firstUrl = null;
    let match;
    while ((match = epRegex.exec(seriesHtml)) !== null) {
      const epUrl = match[1];
      const epNum = parseInt(match[2], 10);
      if (!firstUrl) firstUrl = epUrl;
      if (epNum === Number(ep)) {
        targetUrl = epUrl;
        break;
      }
    }

    const finalEpUrl = targetUrl || (Number(ep) === 1 ? firstUrl : null);
    if (!finalEpUrl) return null;

    const epRes = await fetch(finalEpUrl, {
      headers: DEFAULT_HEADERS,
    });
    if (!epRes.ok) return null;

    const epHtml = await epRes.text();
    let directUrl = null;
    const sourceMatch = /source=(https%3A%2F%2F[^&"'\s]+|https:\/\/[^&"'\s]+)/i.exec(epHtml);
    if (sourceMatch) {
      const raw = sourceMatch[1];
      directUrl = raw.includes('%') ? decodeURIComponent(raw) : raw;
    }

    if (!directUrl) return null;

    let quality = '1080p';
    if (directUrl.includes('720p')) quality = '720p';
    else if (directUrl.includes('480p')) quality = '480p';

    const resData = {
      streamUrl: directUrl,
      type: 'mp4',
      quality,
    };

    if (HINDIFLIX_STREAM_CACHE.size >= 500) {
      const first = HINDIFLIX_STREAM_CACHE.keys().next().value;
      if (first) HINDIFLIX_STREAM_CACHE.delete(first);
    }
    HINDIFLIX_STREAM_CACHE.set(streamKey, {
      data: resData,
      expires: Date.now() + HINDIFLIX_CACHE_TTL,
    });

    return resData;
  } catch {
    return null;
  }
}
