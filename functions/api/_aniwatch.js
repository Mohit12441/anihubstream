// @ts-check

/**
 * Scrapes real embed servers from aniwatch.one
 * @param {{ slug: string, ep?: number, audio?: string, server?: string }} param0
 */
export async function resolveAniWatchDirect({ slug, ep = 1, audio = 'sub', server = 'MGCLD' }) {
  if (!slug) return null;
  const cleanSlug = String(slug).replace(/^aniwatch:/i, '').replace(/\/episode\/\d+$/i, '').trim();
  const epUrl = `https://aniwatch.one/watch/${cleanSlug}/episode/${ep}`;

  try {
    const res = await fetch(epUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(4500),
    });
    if (!res.ok) return null;
    const html = await res.text();
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
