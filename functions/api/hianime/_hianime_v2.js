// @ts-check

/**
 * Parses HiAnime v2 episode list HTML from /ajax/v2/episode/list/:animeId
 * 
 * @param {string} html
 * @returns {Array<{ id: string, number: number, title: string }>}
 */
export function parseHiAnimeEpisodeList(html) {
  if (!html || typeof html !== 'string') return [];
  const episodes = [];
  const tagRegex = /<a\s+[^>]*class="[^"]*ep-item[^"]*"[^>]*>/gis;
  let tagMatch;
  while ((tagMatch = tagRegex.exec(html)) !== null) {
    const tag = tagMatch[0];
    const idMatch = /data-id="([^"]+)"/i.exec(tag);
    const numMatch = /data-number="([^"]+)"/i.exec(tag);
    const titleMatch = /title="([^"]*)"/i.exec(tag);
    if (idMatch && numMatch) {
      episodes.push({
        id: idMatch[1],
        number: Number.parseInt(numMatch[1], 10) || 0,
        title: titleMatch ? titleMatch[1] : `Episode ${numMatch[1]}`,
      });
    }
  }
  return episodes;
}

/**
 * Parses HiAnime v2 episode servers HTML from /ajax/v2/episode/servers?episodeId=:epId
 * 
 * @param {string} html
 * @returns {Array<{ id: string, serverId: string, type: 'sub' | 'dub', name: string }>}
 */
export function parseHiAnimeServers(html) {
  if (!html || typeof html !== 'string') return [];
  const servers = [];
  // Match <div class="item server-item" data-type="sub" data-id="321500" data-server-id="34801"> ... <a ... class="btn">HD-1</a>
  const regex = /<div[^>]*class="[^"]*server-item[^"]*"[^>]*data-type="([^"]+)"[^>]*data-id="([^"]+)"[^>]*data-server-id="([^"]+)"[^>]*>[\s\S]*?<a[^>]*class="btn"[^>]*>([^<]+)<\/a>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    servers.push({
      type: match[1].toLowerCase() === 'dub' ? 'dub' : 'sub',
      id: match[2],
      serverId: match[3],
      name: match[4].trim(),
    });
  }
  return servers;
}

/**
 * Strips iframe and extracts direct HLS stream + subtitles without ads
 * from HiAnime sources response: { type: "iframe", link: "..." }
 * 
 * @param {string} embedUrl
 * @param {Object} [deps]
 * @param {(url: string) => Promise<any>} [deps.resolveMegaplayEmbed]
 * @param {(url: string) => Promise<any>} [deps.resolveZokoEmbedEdge]
 * @returns {Promise<{ streamUrl: string, referer: string, subtitles: any[], quality?: string, skip?: any } | null>}
 */
export async function extractDirectStreamFromEmbed(embedUrl, deps = {}) {
  if (!embedUrl || typeof embedUrl !== 'string') return null;

  // 1. MegaPlay embed (HD-1)
  if (/megaplay\.buzz/i.test(embedUrl)) {
    const resolveMega = deps.resolveMegaplayEmbed || (await import('../_megaplay.js')).resolveMegaplayEmbed;
    const res = await resolveMega(embedUrl);
    if (res?.streamUrl) {
      return {
        streamUrl: res.streamUrl,
        referer: 'https://megaplay.buzz/',
        subtitles: res.subtitles || [],
        quality: res.quality || '1080p',
        skip: (res.intro || res.outro) ? { intro: res.intro, outro: res.outro } : null,
      };
    }
  }

  // 2. ZokoAnime embed (HD-3)
  if (/zokoanime\.video/i.test(embedUrl)) {
    const resolveZoko = deps.resolveZokoEmbedEdge || (await import('./_zoko.js')).resolveZokoEmbedEdge;
    const res = await resolveZoko(embedUrl);
    if (res?.masterUrl) {
      return {
        streamUrl: res.masterUrl,
        referer: 'https://zokoanime.video/',
        subtitles: res.subtitles || [],
        quality: res.defaultQuality || '1080p',
        skip: res.skip || null,
      };
    }
  }

  return null;
}

const HIANIME_MAIN = 'https://hianimex.com.in';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

/**
 * Resolves a HiAnime v2 stream directly without iframe/ads using official v2 Ajax endpoints.
 * 
 * @param {Object} options
 * @param {string} [options.slug]
 * @param {string|number} [options.animeId]
 * @param {number} [options.ep=1]
 * @param {string} [options.audio='sub']
 * @param {string} [options.server='HD-1']
 * @returns {Promise<{ streamUrl: string, referer: string, subtitles: any[], quality?: string, skip?: any, serverName?: string } | null>}
 */
export async function resolveHiAnimeV2Direct({ slug = '', animeId = '', ep = 1, audio = 'sub', server = 'HD-1' }) {
  let numericId = String(animeId || '').trim();

  if (!numericId && slug) {
    const suffixMatch = /-([0-9]+)$/.exec(slug);
    if (suffixMatch) {
      numericId = suffixMatch[1];
    } else if (/^[0-9]+$/.test(slug)) {
      numericId = slug;
    } else {
      try {
        const searchRes = await fetch(`${HIANIME_MAIN}/search?keyword=${encodeURIComponent(slug.replace(/[-_]+/g, ' '))}`, {
          headers: { 'User-Agent': USER_AGENT, Referer: `${HIANIME_MAIN}/` },
          signal: AbortSignal.timeout(4000),
        });
        if (searchRes.ok) {
          const searchHtml = await searchRes.text();
          const idMatch = /href="\/[^"]*-([0-9]+)(?:\?[^"]*)?"/i.exec(searchHtml);
          if (idMatch) numericId = idMatch[1];
        }
      } catch (_) {}
    }
  }

  if (!numericId) return null;

  try {
    const epListRes = await fetch(`${HIANIME_MAIN}/ajax/v2/episode/list/${numericId}`, {
      headers: { 'User-Agent': USER_AGENT, Referer: `${HIANIME_MAIN}/`, 'X-Requested-With': 'XMLHttpRequest' },
      signal: AbortSignal.timeout(3500),
    });
    if (!epListRes.ok) return null;

    const epListData = await epListRes.json();
    const episodes = parseHiAnimeEpisodeList(epListData?.html || '');
    const targetEp = episodes.find((e) => e.number === Number(ep)) || episodes[0];
    if (!targetEp?.id) return null;

    const serversRes = await fetch(`${HIANIME_MAIN}/ajax/v2/episode/servers?episodeId=${targetEp.id}`, {
      headers: { 'User-Agent': USER_AGENT, Referer: `${HIANIME_MAIN}/`, 'X-Requested-With': 'XMLHttpRequest' },
      signal: AbortSignal.timeout(3500),
    });
    if (!serversRes.ok) return null;

    const serversData = await serversRes.json();
    const servers = parseHiAnimeServers(serversData?.html || '');
    const wantedAudio = audio === 'dub' ? 'dub' : 'sub';
    const matchingServers = servers.filter((s) => s.type === wantedAudio);
    const targetServerName = (server || 'HD-1').replace(/-dub$/i, '').toUpperCase();
    const chosenServer = matchingServers.find((s) => s.name.toUpperCase() === targetServerName) ||
      matchingServers.find((s) => s.name.toUpperCase() === 'HD-1') ||
      matchingServers[0];

    if (!chosenServer?.id) return null;

    const sourceRes = await fetch(`${HIANIME_MAIN}/ajax/v2/episode/sources?id=${chosenServer.id}`, {
      headers: { 'User-Agent': USER_AGENT, Referer: `${HIANIME_MAIN}/`, 'X-Requested-With': 'XMLHttpRequest' },
      signal: AbortSignal.timeout(3500),
    });
    if (!sourceRes.ok) return null;

    const sourceData = await sourceRes.json();
    if (!sourceData?.link) return null;

    const direct = await extractDirectStreamFromEmbed(sourceData.link);
    if (!direct?.streamUrl) return null;

    return {
      ...direct,
      serverName: chosenServer.name || 'HD-1',
    };
  } catch (_) {
    return null;
  }
}

