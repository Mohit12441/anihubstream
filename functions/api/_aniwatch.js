// @ts-check

const ANIWATCH_SLUG_CACHE = new Map();

async function fetchAniWatchItems(keyword) {
  if (!keyword || !keyword.trim()) return [];
  try {
    const res = await fetch(`https://aniwatch.one/search?keyword=${encodeURIComponent(keyword.trim())}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return [];
    const html = await res.text();
    const itemRegex = /<div class="flw-item">[\s\S]*?<a\s+[^>]*href="\/watch\/([a-zA-Z0-9_\-]+-\d+)"[^>]*title="([^"]+)"/gi;
    const items = [];
    let m;
    while ((m = itemRegex.exec(html)) !== null) {
      items.push({ slug: m[1], title: m[2].trim() });
    }
    return items;
  } catch {
    return [];
  }
}

/**
 * Searches aniwatch.one to resolve the real slug
 * @param {string} query
 */
export async function searchAniWatchSlug(query) {
  if (!query) return null;
  const rawClean = query.replace(/^aniwatch:/i, '').trim();
  const cached = ANIWATCH_SLUG_CACHE.get(rawClean.toLowerCase());
  if (cached) return cached;

  const candidates = [];
  const cleanSpaced = rawClean.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  candidates.push(cleanSpaced);

  // If query contains season (e.g. "solo leveling season 2 arise from the shadow" or "solo-leveling-season-2")
  const sMatch = cleanSpaced.match(/(.*?)(?:\s*[-–—:]\s*|\s+)(season\s*\d+|\b\d+(?:st|nd|rd|th)?\s*season)/i);
  if (sMatch) {
    candidates.push(`${sMatch[1].trim()} ${sMatch[2].trim()}`);
  }

  // Subtitle strip: split by colons or dashes
  const mainPart = rawClean.split(/[-–—:]/)[0].replace(/[-_]+/g, ' ').trim();
  if (mainPart && !candidates.includes(mainPart)) {
    candidates.push(mainPart);
  }

  for (const cand of candidates) {
    const items = await fetchAniWatchItems(cand);
    if (items.length > 0) {
      const lowerQ = rawClean.toLowerCase();
      const seasonMatch = lowerQ.match(/season\s*(\d+)/i) || lowerQ.match(/\s(\d+)$/);
      if (seasonMatch) {
        const sNum = seasonMatch[1];
        const matchSeason = items.find((it) => new RegExp(`(season\\s*${sNum}|\\b${sNum}(st|nd|rd|th)?\\s*season|\\b${sNum}\\b)`, 'i').test(it.title));
        if (matchSeason) {
          ANIWATCH_SLUG_CACHE.set(rawClean.toLowerCase(), matchSeason.slug);
          return matchSeason.slug;
        }
      }

      ANIWATCH_SLUG_CACHE.set(rawClean.toLowerCase(), items[0].slug);
      return items[0].slug;
    }
  }

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
    let html = '';
    const res = await fetch(epUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(4500),
    });

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

    // If targetServer is DGHG and its upstream URL is on playmogo.com (which has purged video resources),
    // automatically fail-over to the working MGCLD or BYFMS mirror for the same audio type.
    if (match && match.serverName === 'DGHG' && match.embedUrl.includes('playmogo.com')) {
      const workingMirror = parsed.find((p) => p.type === targetAudio && /^(MGCLD|BYFMS)$/i.test(p.serverName));
      if (workingMirror) {
        match = {
          ...workingMirror,
          serverName: 'DGHG',
        };
      }
    }

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
