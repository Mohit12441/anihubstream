// @ts-check

const HINDIFLIX_BASE = process.env.HINDIFLIX_BASE_URL || 'https://hindiflix.cc';
const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Referer': `${HINDIFLIX_BASE}/`,
  'Origin': HINDIFLIX_BASE,
};

/**
 * Searches HindiFlix via its AJAX live search endpoint.
 * @param {string} query
 * @param {any} [opts]
 * @returns {Promise<Array<{ id: number, title: string, slug: string, link: string, image: string, genres: string[], type: string, latestEp: number }>>}
 */
export async function search(query, opts = {}) {
  if (!query || typeof query !== 'string' || !query.trim()) return [];
  const q = query.trim();

  const res = await fetch(`${HINDIFLIX_BASE}/wp-admin/admin-ajax.php`, {
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
    signal: opts.signal || (opts.timeout ? AbortSignal.timeout(opts.timeout) : undefined),
  });

  if (!res.ok) return [];
  const data = await res.json().catch(() => null);
  const hits = data?.anime?.[0]?.all || [];

  return hits.map((hit) => {
    const slugMatch = /\/watch\/([^/]+)\/?/.exec(hit.post_link) || /\/([^/]+)\/?$/.exec(hit.post_link);
    const slug = slugMatch ? slugMatch[1] : `hf-${hit.ID}`;
    const latestEp = parseInt(hit.post_latest || '0', 10);
    const genres = (hit.post_genres || '')
      .split(',')
      .map((g) => g.trim())
      .filter(Boolean);

    return {
      id: hit.ID,
      title: hit.post_title,
      slug,
      link: hit.post_link,
      image: hit.post_image,
      genres,
      type: hit.post_type || 'TV',
      latestEp: isNaN(latestEp) ? 1 : latestEp,
    };
  });
}

/**
 * Fetches series details and episode list from a HindiFlix series page.
 * @param {string} slugOrUrl
 * @param {any} [opts]
 * @returns {Promise<{ title: string, slug: string, link: string, episodes: Array<{ epNum: number, url: string }> } | null>}
 */
export async function details(slugOrUrl, opts = {}) {
  if (!slugOrUrl) return null;
  const url = slugOrUrl.startsWith('http')
    ? slugOrUrl
    : `${HINDIFLIX_BASE}/watch/${encodeURIComponent(slugOrUrl)}/`;

  const res = await fetch(url, {
    headers: DEFAULT_HEADERS,
    signal: opts.signal || (opts.timeout ? AbortSignal.timeout(opts.timeout) : undefined),
  });
  if (!res.ok) return null;

  const html = await res.text();
  const titleMatch = /<title>([^<]+)<\/title>/i.exec(html);
  const cleanTitle = titleMatch ? titleMatch[1].replace(/ - HindiFlix$/i, '').trim() : '';

  // Extract episode links
  const epRegex = /<a[^>]+href="(https:\/\/hindiflix\.cc\/[^"]*episode-(\d+)[^"]*)"[^>]*>/gi;
  const episodes = [];
  const seen = new Set();
  let match;
  while ((match = epRegex.exec(html)) !== null) {
    const epUrl = match[1];
    const epNum = parseInt(match[2], 10);
    if (!seen.has(epNum)) {
      seen.add(epNum);
      episodes.push({ epNum, url: epUrl });
    }
  }

  episodes.sort((a, b) => a.epNum - b.epNum);

  return {
    title: cleanTitle,
    slug: slugOrUrl.replace(/^https?:\/\/[^/]+\/watch\//, '').replace(/\/$/, ''),
    link: url,
    episodes,
  };
}

/**
 * Extracts direct stream URL from an episode page.
 * @param {string} epUrl
 * @param {any} [opts]
 * @returns {Promise<{ streamUrl: string, type: 'mp4', quality: string, audio: 'dub', audioTracks: Array<{ id: string, language: string, label: string, default: boolean }> } | null>}
 */
export async function sources(epUrl, opts = {}) {
  if (!epUrl) return null;

  const res = await fetch(epUrl, {
    headers: DEFAULT_HEADERS,
    signal: opts.signal || (opts.timeout ? AbortSignal.timeout(opts.timeout) : undefined),
  });
  if (!res.ok) return null;

  const html = await res.text();

  // 1. Direct source= query parameter in player.html
  let directUrl = null;
  const sourceMatch = /source=(https%3A%2F%2F[^&"'\s]+|https:\/\/[^&"'\s]+)/i.exec(html);
  if (sourceMatch) {
    const raw = sourceMatch[1];
    directUrl = raw.includes('%') ? decodeURIComponent(raw) : raw;
  }

  // 2. Direct video tag src or iframe fallback
  if (!directUrl) {
    const videoMatch = /<video[^>]+src="([^"]+)"/i.exec(html);
    if (videoMatch) directUrl = videoMatch[1];
  }

  if (!directUrl) return null;

  // Detect quality rung from filename (e.g. 1080p, 720p, etc.)
  let quality = '1080p';
  if (directUrl.includes('720p')) quality = '720p';
  else if (directUrl.includes('480p')) quality = '480p';
  else if (directUrl.includes('1080p')) quality = '1080p';

  return {
    streamUrl: directUrl,
    type: 'mp4',
    quality,
    audio: 'dub',
    audioTracks: [
      { id: 'audio-hi', language: 'hi', label: 'Hindi Dub', default: true },
    ],
  };
}

/**
 * End-to-end resolver for an anime and episode number.
 * @param {string} title
 * @param {number} epNum
 * @param {any} [opts]
 */
export async function resolveStream(title, epNum = 1, opts = {}) {
  const hits = await search(title, opts);
  if (!hits.length) return null;

  // Filter hits for title relevance and preferably matching season
  const hit = hits[0];
  const seriesInfo = await details(hit.link, opts);
  if (!seriesInfo || !seriesInfo.episodes.length) return null;

  // Locate the requested episode
  const ep = seriesInfo.episodes.find((e) => e.epNum === epNum) || seriesInfo.episodes[0];
  if (!ep) return null;

  const streamInfo = await sources(ep.url, opts);
  if (!streamInfo) return null;

  return {
    ...streamInfo,
    seriesTitle: hit.title,
    episodeNumber: ep.epNum,
  };
}
