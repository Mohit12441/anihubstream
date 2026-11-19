// @ts-check

const ANIWATCH_SLUG_CACHE = new Map();

/**
 * Searches aniwatch.one to resolve the real slug
 * @param {string} query
 */
export async function searchAniWatchSlug(query) {
  if (!query) return null;
  const cleanQ = query.replace(/^aniwatch:/i, '').replace(/[-_]+/g, ' ').trim();
  const cached = ANIWATCH_SLUG_CACHE.get(cleanQ.toLowerCase());
  if (cached) return cached;

  try {
    const res = await fetch(`https://aniwatch.one/search?keyword=${encodeURIComponent(cleanQ)}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    const match = html.match(/\/watch\/([a-zA-Z0-9_\-]+-\d+)/i);
    if (match && match[1]) {
      ANIWATCH_SLUG_CACHE.set(cleanQ.toLowerCase(), match[1]);
      return match[1];
    }
  } catch (_) {}
  return null;
}

/**
 * Scrapes real embed servers from aniwatch.one
 * @param {{ slug?: string, title?: string, ep?: number, audio?: string, server?: string }} param0
 */
export async function resolveAniWatchDirect({ slug, title, ep = 1, audio = 'sub', server = 'MGCLD' }) {
  let targetSlug = (slug || '').replace(/^aniwatch:/i, '').replace(/\/episode\/\d+$/i, '').trim();

  // If slug doesn't match the aniwatch slug format (e.g. ends with -digits like -82064), search for it
  if (!/-\d+$/.test(targetSlug)) {
    const found = await searchAniWatchSlug(title || targetSlug);
    if (found) targetSlug = found;
  }

  if (!targetSlug) return null;
  const epUrl = `https://aniwatch.one/watch/${targetSlug}/episode/${ep}`;

  try {
    const res = await fetch(epUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(4500),
    });

    let html = '';
    if (res.status === 404 && !/-\d+$/.test(targetSlug)) {
      const found = await searchAniWatchSlug(title || targetSlug);
      if (found && found !== targetSlug) {
        targetSlug = found;
        const retryRes = await fetch(`https://aniwatch.one/watch/${targetSlug}/episode/${ep}`, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
          },
          signal: AbortSignal.timeout(4500),
        });
        if (retryRes.ok) html = await retryRes.text();
      }
    } else if (res.ok) {
      html = await res.text();
    }

    if (!html) return null;
    const srvIdx = html.indexOf('class="player-servers"');
    if (srvIdx === -1) return null;

    const srvSnippet = html.substring(srvIdx, srvIdx + 2500);
    const items = [...srvSnippet.matchAll(/<div class="item server-item" data-type="([^"]+)" data-url="([^"]+)">[\s\S]*?<a class="btn[^"]*">([^<]+)<\/a>/gi)];
    if (!items.length) return null;

    const parsed = items.map((m) => ({
      type: m[1].toLowerCase(),
      embedUrl: m[2],
      serverName: m[3].trim().toUpperCase(),
    }));

    const targetAudio = audio === 'dub' ? 'dub' : 'sub';
    const targetServer = (server || 'MGCLD').replace(/-dub$/i, '').replace(/\[.*?\]/g, '').trim().toUpperCase();

    // 1. Match audio and server name (MGCLD, BYFMS, DGHG)
    let match = parsed.find((p) => p.type === targetAudio && p.serverName === targetServer);
    // 2. Match audio
    if (!match) match = parsed.find((p) => p.type === targetAudio);
    // 3. Fallback
    if (!match) match = parsed[0];

    return {
      streamUrl: match.embedUrl,
      referer: 'https://aniwatch.one/',
      kind: 'embed',
      type: 'embed',
      serverName: match.serverName,
      quality: '1080p',
      subtitles: [],
      provider: 'aniwatch',
      hardcodedSubs: targetAudio === 'sub',
    };
  } catch (_) {
    return null;
  }
}
