// @ts-check
const REZKA_BASE = process.env.HDREZKA_BASE_URL || 'https://hdrezka.ag';
const REZKA_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Referer': `${REZKA_BASE}/`,
  'Origin': REZKA_BASE,
  'X-Requested-With': 'XMLHttpRequest',
};

export const KNOWN_TRANSLATORS = {
  '105': 'Studio Band',
  '19': 'AniLibria',
  '565': 'TVShows',
  '318': 'Amber',
  '115': 'JAM',
  '477': 'DreamCast',
  '238': 'Original (Subtitles)',
  '68': 'AniDUB',
  '81': 'Persona99',
  '377': 'SHIZA Project',
  '73': 'Dream Records',
  '56': 'AnimeVost',
  '440': 'DEEP',
};

/**
 * Cleans HDRezka's custom trash characters and decodes the stream payload.
 * @param {string} rawUrl
 * @returns {Array<{ quality: string, mp4: string, hls: string | null }>}
 */
export function decodeRezkaStream(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return [];

  let decoded = rawUrl;
  if (rawUrl.startsWith('#h') || !rawUrl.includes('http')) {
    let cleaned = rawUrl.replace(/^#h/, '').split('//_//').join('');

    // 1. Generate base64 trash noise tokens: permutations of ['@', '#', '!', '^', '$'] of lengths 2 and 3
    const trashChars = ['@', '#', '!', '^', '$'];
    const trashTokens = new Set();
    for (const a of trashChars) {
      for (const b of trashChars) {
        trashTokens.add(Buffer.from(a + b).toString('base64'));
        for (const c of trashChars) {
          trashTokens.add(Buffer.from(a + b + c).toString('base64'));
        }
      }
    }

    // 2. Strip generated trash tokens
    for (const token of trashTokens) {
      cleaned = cleaned.replaceAll(token, '');
    }

    // 3. Fix padding and base64 decode
    while (cleaned.length % 4 !== 0) cleaned += '=';
    try {
      decoded = Buffer.from(cleaned, 'base64').toString('utf-8');
    } catch {
      return [];
    }
  }

  // 4. Parse stream qualities (e.g. "[1080p Ultra]https://...:hls:manifest.m3u8 or https://...mp4")
  const regex = /\[([^\]]+)\]([^\s,\[]+(?:\s+or\s+[^\s,\[]+)?)/g;
  const streams = [];
  let match;
  while ((match = regex.exec(decoded)) !== null) {
    const [_, rawQual, linkGroup] = match;
    const quality = rawQual.replace(/<[^>]+>/g, '').trim();
    let mp4Url = '';
    let hlsUrl = null;

    if (linkGroup.includes(' or ')) {
      const parts = linkGroup.split(/\s+or\s+/);
      mp4Url = parts.find((p) => !p.includes(':hls:') && p.includes('.mp4')) || parts[0];
      hlsUrl = parts.find((p) => p.includes(':hls:') || p.includes('.m3u8')) || null;
    } else if (linkGroup.includes(':hls:')) {
      const parts = linkGroup.split(':hls:');
      mp4Url = parts[0];
      hlsUrl = parts[1] || null;
    } else {
      mp4Url = linkGroup;
      if (linkGroup.includes('.m3u8')) hlsUrl = linkGroup;
    }

    streams.push({
      quality,
      mp4: mp4Url,
      hls: hlsUrl,
    });
  }

  return streams;
}

/**
 * Search HDRezka with title verification and Shikimori fallback.
 * @param {string} query
 * @param {{ malId?: number, signal?: AbortSignal }} [opts]
 */
export async function search(query, opts = {}) {
  let q = query;

  // Resolve Russian title via Shikimori if query is in English/Latin
  if (opts.malId && !/[а-яА-Я]/.test(q)) {
    try {
      const shikiRes = await fetch(`https://shikimori.one/api/animes/${opts.malId}`, {
        headers: { 'User-Agent': REZKA_HEADERS['User-Agent'] },
        signal: AbortSignal.timeout(4000),
      });
      if (shikiRes.ok) {
        const shiki = await shikiRes.json();
        if (shiki?.russian) q = shiki.russian;
      }
    } catch {}
  }

  const searchUrl = `${REZKA_BASE}/search/?do=search&subaction=search&q=${encodeURIComponent(q)}`;
  let html = '';
  try {
    const res = await fetch(searchUrl, {
      headers: REZKA_HEADERS,
      signal: opts.signal || AbortSignal.timeout(6000),
    });
    if (res.ok) html = await res.text();
  } catch {
    return [];
  }

  const results = [];
  const itemRegex = /<div class="b-content__inline_item"[^>]*data-id="(\d+)"(?:[^>]*data-url="([^"]+)")?[\s\S]*?<div class="b-content__inline_item-link">\s*<a href="([^"]+)">([^<]+)<\/a>/g;
  let match;
  while ((match = itemRegex.exec(html)) !== null) {
    const [_, id, dataUrl, linkUrl, title] = match;
    results.push({
      id,
      slug: id,
      title: title.trim(),
      originalTitle: '',
      url: dataUrl || linkUrl,
    });
  }

  return results;
}

/**
 * Retrieve series details and episodes.
 * @param {string} slugOrId
 * @param {{ signal?: AbortSignal }} [opts]
 */
export async function details(slugOrId, opts = {}) {
  const id = String(slugOrId).replace(/[^\d]/g, '');
  if (!id) throw new Error(`Invalid HDRezka ID: ${slugOrId}`);

  const wantsSub = opts.audio === 'sub' || opts.audio === 'ja';
  let defaultTranslator = opts.translatorId || (wantsSub ? '238' : '105');
  let episodes = [];
  const translators = [];

  // Scrape page for translator and series events
  try {
    const pageUrl = `${REZKA_BASE}/animation/${id}-anime.html`;
    const res = await fetch(pageUrl, {
      headers: REZKA_HEADERS,
      signal: opts.signal || AbortSignal.timeout(6000),
    });
    if (res.ok) {
      const html = await res.text();
      // Extract active or first translator_id
      const trMatch = html.match(/data-translator_id="(\d+)"/) || html.match(/initCDNSeriesEvents\(\s*\d+,\s*(\d+)/);
      if (trMatch && !opts.translatorId) {
        if (wantsSub ? trMatch[1] === '238' : trMatch[1] !== '238') {
          defaultTranslator = trMatch[1];
        }
      }

      const trRegex = /data-translator_id="(\d+)"(?:[^>]*title="([^"]+)")?/g;
      let m;
      while ((m = trRegex.exec(html)) !== null) {
        const trId = m[1];
        if (!translators.some((t) => t.id === trId)) {
          translators.push({
            id: trId,
            name: m[2] || KNOWN_TRANSLATORS[trId] || `Studio ${trId}`,
          });
        }
      }
    }
  } catch {}

  const candidateTranslators = wantsSub
    ? [defaultTranslator, '238', '105', '19', '565', '318', '115']
    : [defaultTranslator, '105', '19', '565', '318', '115', '477', '238'];
  const uniqueTranslators = [...new Set(candidateTranslators)];

  // Fetch episodes list from CDN series handler
  for (const tr of uniqueTranslators) {
    try {
      const epUrl = `${REZKA_BASE}/ajax/get_cdn_series/?t=${Date.now()}`;
      const body = new URLSearchParams({
        id,
        translator_id: tr,
        action: 'get_episodes',
      });
      const epRes = await fetch(epUrl, {
        method: 'POST',
        headers: { ...REZKA_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        signal: opts.signal || AbortSignal.timeout(4000),
      });
      if (epRes.ok) {
        const data = await epRes.json();
        if (data?.success && data?.episodes) {
          defaultTranslator = tr;
          const epRegex = /data-season_id="(\d+)"\s+data-episode_id="(\d+)"/g;
          let epMatch;
          let count = 1;
          while ((epMatch = epRegex.exec(data.episodes)) !== null) {
            const [_, s, e] = epMatch;
            episodes.push({
              id: `${id}:${s}:${e}:${tr}`,
              number: count++,
              season: Number(s),
              episode: Number(e),
            });
          }
          if (episodes.length > 0) break;
        }
      }
    } catch {}
  }

  // Default fallback if episodes cannot be pre-enumerated
  if (episodes.length === 0) {
    for (let i = 1; i <= 24; i++) {
      episodes.push({
        id: `${id}:1:${i}:${defaultTranslator}`,
        number: i,
        season: 1,
        episode: i,
      });
    }
  }

  return {
    id,
    slug: id,
    translatorId: defaultTranslator,
    episodes,
    translators: translators.length > 0 ? translators : [{ id: defaultTranslator, name: KNOWN_TRANSLATORS[defaultTranslator] || 'Studio Band' }],
  };
}

/**
 * Retrieve stream sources for an episode.
 * @param {string} epRef - Formatted as "id:season:episode:translator" or "id:episode"
 * @param {{ translatorId?: string, signal?: AbortSignal }} [opts]
 */
export async function sources(epRef, opts = {}) {
  const parts = String(epRef).split(':');
  const id = parts[0];
  const season = parts[1] || '1';
  const ep = parts[2] || '1';
  const srv = String(opts.server || opts.serverParam || opts.translatorId || '').toLowerCase();
  let requestedTr = opts.translatorId || null;
  if (!requestedTr) {
    if (srv.includes('anilibria') || srv.includes('19')) requestedTr = '19';
    else if (srv.includes('tvshows') || srv.includes('565')) requestedTr = '565';
    else if (srv.includes('studioband') || srv.includes('105')) requestedTr = '105';
    else if (srv.includes('original') || srv.includes('238')) requestedTr = '238';
  }
  const isExplicitDub = srv.includes('dub') || (requestedTr && requestedTr !== '238');
  const wantsSub = !isExplicitDub && (opts.audio === 'sub' || opts.audio === 'ja' || opts.audioType === 'sub');
  const defaultTr = wantsSub ? '238' : (requestedTr || '105');
  let translator = requestedTr || (wantsSub ? (parts[3] === '238' ? '238' : defaultTr) : (parts[3] !== '238' ? parts[3] : defaultTr));

  const candidateTranslators = wantsSub
    ? [translator, '238', '105', '19', '565']
    : [translator, '105', '19', '565', '318', '115', '477', '238'];
  const uniqueTranslators = [...new Set(candidateTranslators)];

  let lastError = null;
  for (const tr of uniqueTranslators) {
    try {
      const body = new URLSearchParams({
        id,
        translator_id: tr,
        season,
        episode: ep,
        action: 'get_stream',
      });

      const res = await fetch(`${REZKA_BASE}/ajax/get_cdn_series/?t=${Date.now()}`, {
        method: 'POST',
        headers: { ...REZKA_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        signal: opts.signal || AbortSignal.timeout(6000),
      });

      if (!res.ok) continue;
      const data = await res.json();
      if (data?.success && data?.url) {
        return {
          rawUrl: data.url,
          subtitle: data.subtitle || '',
          subtitle_lns: data.subtitle_lns || {},
          translatorId: tr,
          translatorName: KNOWN_TRANSLATORS[tr] || `Studio ${tr}`,
        };
      }
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error('HDRezka returned empty or invalid stream response');
}

/**
 * Decode stream and format player response.
 * @param {any} embed
 * @param {{ quality?: string }} [opts]
 */
export async function resolve(embed, opts = {}) {
  const rawUrl = typeof embed === 'string' ? embed : embed?.rawUrl;
  const streams = decodeRezkaStream(rawUrl);
  if (streams.length === 0) return null;

  // Filter out premium 1-min demo video (1080p Ultra) unless explicitly requested
  const validStreams = streams.filter((s) => !s.quality.toLowerCase().includes('ultra'));
  const candidatePool = validStreams.length > 0 ? validStreams : streams;

  const requested = opts.quality ? String(opts.quality).toLowerCase() : '';
  let chosen = requested && requested !== 'ultra' ? candidatePool.find((s) => s.quality.toLowerCase().includes(requested)) : null;
  if (!chosen) chosen = candidatePool.find((s) => s.quality.includes('1080')) || candidatePool.find((s) => s.quality.includes('720')) || candidatePool[0];

  const primaryUrl = chosen.mp4 || chosen.hls || '';
  const isMp4 = primaryUrl.includes('.mp4');

  // Parse subtitle tracks if present
  const subtitles = [];
  const rawSubtitles = embed?.subtitle || opts.subtitles || opts.subtitle;
  if (rawSubtitles && typeof rawSubtitles === 'string') {
    const subRegex = /\[([^\]]+)\](https?:\/\/[^\s,]+)/g;
    let sm;
    while ((sm = subRegex.exec(rawSubtitles)) !== null) {
      subtitles.push({
        language: sm[1],
        name: sm[1],
        label: sm[1],
        url: sm[2],
      });
    }
  }

  const trId = embed?.translatorId || opts.translatorId;
  const isJa = trId === '238' || (opts.audio === 'sub' && !trId);
  const audioTracks = isJa
    ? [{ id: 'audio-ja', language: 'ja', label: 'Japanese (Original)', default: true }]
    : [{ id: 'audio-ru', language: 'ru', label: `${embed?.translatorName || 'Russian'} Dub`, default: true }];

  return {
    provider: 'hdrezka',
    master: {
      url: primaryUrl,
      headers: { referer: 'https://rezka.ag/' },
    },
    streamUrl: primaryUrl,
    quality: chosen.quality,
    audio: isJa ? 'sub' : 'russian',
    audioTracks,
    type: isMp4 ? 'mp4' : 'hls',
    kind: isMp4 ? 'mp4' : 'hls',
    referer: 'https://rezka.ag/',
    variants: candidatePool.map((s) => s.quality),
    subtitles,
    direct: candidatePool.map((s) => ({
      quality: parseInt(s.quality, 10) || 1080,
      url: s.mp4 || s.hls,
      container: s.mp4 ? 'mp4' : 'hls',
    })),
  };
}
