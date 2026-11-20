// @ts-check

const HINDIFLIX_BASE = 'https://hindiflix.cc';
const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Referer': `${HINDIFLIX_BASE}/`,
  'Origin': HINDIFLIX_BASE,
};

/**
 * Searches and extracts direct stream payload for an anime title and episode on HindiFlix.
 * @param {string} title
 * @param {number|string} ep
 * @returns {Promise<{ streamUrl: string, type: 'mp4', quality: string } | null>}
 */
export async function resolveHindiFlixStream(title, ep = 1) {
  if (!title) return null;
  const cleanTitle = title.replace(/\s*\(Season \d+\)|\s*Season \d+/i, '').trim();

  try {
    // 1. Search HindiFlix via AJAX
    const searchRes = await fetch(`${HINDIFLIX_BASE}/wp-admin/admin-ajax.php`, {
      method: 'POST',
      headers: {
        ...DEFAULT_HEADERS,
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: new URLSearchParams({
        action: 'ts_ac_do_search',
        ts_ac_query: cleanTitle,
      }).toString(),
    });

    if (!searchRes.ok) return null;
    const data = await searchRes.json().catch(() => null);
    const hits = data?.anime?.[0]?.all || [];
    if (!hits.length) return null;

    const hit = hits[0];
    const seriesRes = await fetch(hit.post_link, {
      headers: DEFAULT_HEADERS,
    });
    if (!seriesRes.ok) return null;

    const seriesHtml = await seriesRes.text();
    const epRegex = /<a[^>]+href="(https:\/\/hindiflix\.cc\/[^"]*episode-(\d+)[^"]*)"[^>]*>/gi;
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

    return {
      streamUrl: directUrl,
      type: 'mp4',
      quality,
    };
  } catch {
    return null;
  }
}
