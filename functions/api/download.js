// @ts-check
import { HttpError, errorResponse, ok } from './_lib.js';
import { resolveMegaplayDirect } from './_megaplay.js';
import { resolveZokoEmbedEdge } from './hianime/_zoko.js';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const CACHE_TTL_MS = 20 * 60 * 1000; // 20 minutes

/**
 * Extract AniKoto direct mirror downloads from mapper.nekostream.site
 * @param {number} malId
 * @param {number} ep
 * @param {string} audio
 * @param {AbortSignal} [signal]
 */
async function extractAnikotoDownloads(malId, ep, audio, signal) {
  if (!malId) return [];
  const cleanAudio = audio === 'dub' ? 'dub' : 'sub';
  try {
    const res = await fetch(`https://mapper.nekostream.site/api/mal/${encodeURIComponent(malId)}/${encodeURIComponent(ep)}/1`, {
      headers: {
        referer: 'https://anikoto.cz/',
        'user-agent': USER_AGENT,
      },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    if (!data || typeof data !== 'object') return [];

    const downloads = [];
    for (const [providerName, provData] of Object.entries(data)) {
      if (!provData || typeof provData !== 'object') continue;
      const langData = provData[cleanAudio] || (cleanAudio === 'dub' ? provData.sub : provData.dub);
      if (langData?.download && typeof langData.download === 'object') {
        for (const [quality, dlUrl] of Object.entries(langData.download)) {
          if (dlUrl && typeof dlUrl === 'string') {
            downloads.push({
              name: `AniKoto · ${providerName} (${quality.toUpperCase()})`,
              label: quality,
              quality,
              url: dlUrl,
              provider: 'anikoto',
              audio: cleanAudio,
              type: 'direct',
              format: 'MP4',
            });
          }
        }
      }
    }
    return downloads;
  } catch {
    return [];
  }
}

/**
 * Extract HiAnime multi-quality downloads from zokoanime.video API
 * @param {number} malId
 * @param {number} ep
 * @param {string} audio
 * @param {AbortSignal} [signal]
 */
async function extractHianimeDownloads(malId, ep, audio, signal) {
  if (!malId) return { downloads: [], downloadPage: null };
  const cleanTrack = audio === 'dub' ? 'dub' : 'sub';
  const path = `mal/${malId}/${ep}/${cleanTrack}`;
  const downloadPage = `https://zokoanime.video/download/${path}`;
  const referer = downloadPage;

  try {
    const tokenRes = await fetch(`https://zokoanime.video/api/downloads/token/${path}`, {
      headers: {
        referer,
        'user-agent': USER_AGENT,
      },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(4000)]) : AbortSignal.timeout(4000),
    });
    if (!tokenRes.ok) return { downloads: [], downloadPage };

    const tokenData = await tokenRes.json().catch(() => null);
    if (!tokenData?.token) return { downloads: [], downloadPage };

    const dlRes = await fetch(`https://zokoanime.video/api/downloads/${path}?t=${encodeURIComponent(tokenData.token)}`, {
      headers: {
        referer,
        'user-agent': USER_AGENT,
      },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000),
    });
    if (!dlRes.ok) return { downloads: [], downloadPage };

    const data = await dlRes.json().catch(() => null);
    if (!Array.isArray(data?.downloads)) return { downloads: [], downloadPage };

    const downloads = data.downloads.map((d) => ({
      name: `HiAnime · ${d.label || 'Direct'} (${(d.kind || cleanTrack).toUpperCase()})`,
      label: d.label || '1080p',
      quality: d.label || '1080p',
      url: d.url,
      provider: 'hianime',
      audio: d.kind || cleanTrack,
      type: 'direct',
      format: 'MP4',
    }));

    return { downloads, downloadPage };
  } catch {
    return { downloads: [], downloadPage };
  }
}

/**
 * Parses variant renditions from an HLS master playlist
 * @param {string} text
 * @param {string} baseUrl
 * @returns {Array<{ quality: string, bandwidth: number, url: string }>}
 */
function parseMasterVariants(text, baseUrl) {
  const lines = text.split(/\r?\n/);
  const renditions = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('#EXT-X-STREAM-INF:')) continue;

    const resMatch = line.match(/RESOLUTION=\d+x(\d+)/i);
    const bwMatch = line.match(/BANDWIDTH=(\d+)/i);
    const height = resMatch ? `${resMatch[1]}p` : 'unknown';
    const bandwidth = bwMatch ? Number(bwMatch[1]) : 0;

    let nextUrl = '';
    for (let j = i + 1; j < lines.length; j++) {
      const candidate = lines[j].trim();
      if (!candidate || candidate.startsWith('#')) continue;
      nextUrl = candidate;
      break;
    }

    if (nextUrl) {
      const fullUrl = nextUrl.startsWith('http') ? nextUrl : new URL(nextUrl, baseUrl).href;
      renditions.push({ quality: height, bandwidth, url: fullUrl });
    }
  }

  return renditions.sort((a, b) => {
    const numA = parseInt(a.quality, 10) || 0;
    const numB = parseInt(b.quality, 10) || 0;
    return numB - numA || b.bandwidth - a.bandwidth;
  });
}

/**
 * Parses media segments from a media playlist
 * @param {string} text
 * @param {string} baseUrl
 * @returns {string[]}
 */
function parseMediaSegments(text, baseUrl) {
  const lines = text.split(/\r?\n/);
  const segments = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;
    const absUrl = line.startsWith('http') ? line : new URL(line, baseUrl).href;
    segments.push(absUrl);
  }

  return segments;
}

/**
 * Streams media segments directly over HTTP with Content-Disposition
 * @param {string} masterUrl
 * @param {string} referer
 * @param {string} requestedQuality
 * @param {string} animeTitle
 * @param {number} ep
 * @param {Request} request
 */
export async function streamEpisodePipe(masterUrl, referer, requestedQuality, animeTitle, ep, request) {
  const masterRes = await fetch(masterUrl, {
    headers: { 'User-Agent': USER_AGENT, Referer: referer },
    signal: AbortSignal.timeout(10_000),
  });

  if (!masterRes.ok) {
    throw new HttpError(502, 'upstream_error', `Failed to load master playlist (${masterRes.status})`);
  }

  const masterText = await masterRes.text();
  let targetPlaylistUrl = masterUrl;
  let targetPlaylistText = masterText;

  if (masterText.includes('#EXT-X-STREAM-INF')) {
    const variants = parseMasterVariants(masterText, masterUrl);
    let chosen = variants[0];
    if (requestedQuality) {
      const match = variants.find((v) => v.quality.toLowerCase().includes(requestedQuality) || requestedQuality.includes(v.quality.toLowerCase()));
      if (match) chosen = match;
    }

    if (chosen) {
      targetPlaylistUrl = chosen.url;
      const renditionRes = await fetch(chosen.url, {
        headers: { 'User-Agent': USER_AGENT, Referer: referer },
        signal: AbortSignal.timeout(10_000),
      });

      if (renditionRes.ok) {
        targetPlaylistText = await renditionRes.text();
      }
    }
  }

  const segmentUrls = parseMediaSegments(targetPlaylistText, targetPlaylistUrl);
  if (!segmentUrls.length) {
    throw new HttpError(502, 'no_segments', 'No media segments found in stream playlist');
  }

  const safeTitle = animeTitle.replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = `${safeTitle}_EP${ep}_${requestedQuality || 'video'}.ts`;

  if (request.method === 'HEAD') {
    return new Response(null, {
      status: 200,
      headers: {
        'Content-Type': 'video/mp2t',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers': 'Content-Disposition',
      },
    });
  }

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

  (async () => {
    try {
      for (let i = 0; i < segmentUrls.length; i++) {
        if (request.signal?.aborted) break;

        const segUrl = segmentUrls[i];
        let retries = 2;
        let segRes = null;

        while (retries >= 0) {
          try {
            segRes = await fetch(segUrl, {
              headers: { 'User-Agent': USER_AGENT, Referer: referer },
              signal: AbortSignal.timeout(12_000),
            });
            if (segRes.ok) break;
          } catch (_) {
            retries--;
            if (retries < 0) break;
            await new Promise((r) => setTimeout(r, 250));
          }
        }

        if (!segRes || !segRes.ok || !segRes.body) continue;

        const reader = segRes.body.getReader();
        while (true) {
          if (request.signal?.aborted) {
            try { await reader.cancel(); } catch (_) {}
            break;
          }
          const { done, value } = await reader.read();
          if (done) break;
          if (value) await writer.write(value);
        }
      }
    } catch (_) {
    } finally {
      try {
        await writer.close();
      } catch (_) {}
    }
  })();

  return new Response(readable, {
    status: 200,
    headers: {
      'Content-Type': 'video/mp2t',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Expose-Headers': 'Content-Disposition',
    },
  });
}

/**
 * Unified Provider-Scoped Episode Download Endpoint
 *
 * GET /api/download?provider=:provider&id=:id&ep=:n&audio=:audio
 */
export const onRequestGet = async ({ request, env }) => {
  try {
    const url = new URL(request.url);
    const rawId = (url.searchParams.get('id') || url.searchParams.get('title') || '').trim();
    const ep = Math.max(1, Number(url.searchParams.get('ep')) || 1);
    const audio = url.searchParams.get('audio') === 'dub' ? 'dub' : 'sub';
    const isPipe = url.searchParams.get('mode') === 'pipe' || url.searchParams.get('pipe') === '1';
    const requestedQuality = (url.searchParams.get('quality') || '1080p').toLowerCase().trim();

    if (!rawId) {
      throw new HttpError(400, 'bad_request', 'id query parameter is required');
    }

    // Infer or clean provider parameter
    let provider = (url.searchParams.get('provider') || '').toLowerCase().trim();
    if (!provider) {
      if (rawId.startsWith('hianime:')) provider = 'hianime';
      else if (rawId.startsWith('anikoto:')) provider = 'anikoto';
      else if (rawId.startsWith('aniwatch:')) provider = 'aniwatch';
      else if (rawId.startsWith('watchanimeworld:')) provider = 'watchanimeworld';
      else provider = 'anikoto';
    }

    const cleanSlug = rawId.replace(/^[a-z0-9_-]+:/i, '').split('#')[0].trim();
    const cacheKey = `download:${provider}:${cleanSlug}:${ep}:${audio}`;

    // --- STEP 1: D1 Download Cache Check (skip for raw pipe stream) ---
    if (!isPipe && env.ANIHUB) {
      try {
        const cached = await env.ANIHUB.prepare(
          `SELECT data FROM stream_cache WHERE key = ?1 AND expires_at > ?2`
        ).bind(cacheKey, Date.now()).first();

        if (cached && typeof cached.data === 'string') {
          const parsed = JSON.parse(cached.data);
          return ok(parsed, { cache: 'public, max-age=300, s-maxage=600' });
        }
      } catch (_) {}
    }

    // --- STEP 2: D1 Metadata & MAL ID Lookup ---
    let malId = null;
    let animeTitle = cleanSlug;
    const availableProviders = new Set();

    if (env.ANIHUB) {
      try {
        const match = await env.ANIHUB.prepare(
          `SELECT a.id, a.title, a.skip_key_id, m.mal_id, m.anikoto_slug, m.hianime_slug, m.aniwatch_slug, m.waw_slug
           FROM anime a
           LEFT JOIN anime_id_map m ON a.id = m.anime_id
           WHERE a.id = ?1 OR m.anikoto_slug = ?1 OR m.hianime_slug = ?1 OR lower(a.title) = lower(?1)
           LIMIT 1`
        ).bind(cleanSlug).first();

        if (match) {
          malId = Number(match.mal_id || match.skip_key_id) || null;
          if (match.title) animeTitle = match.title;
          if (match.anikoto_slug) availableProviders.add('anikoto');
          if (match.hianime_slug) availableProviders.add('hianime');
          if (match.aniwatch_slug) availableProviders.add('aniwatch');
          if (match.waw_slug) availableProviders.add('watchanimeworld');
        } else {
          const provMatch = await env.ANIHUB.prepare(
            `SELECT a.id, a.title, a.skip_key_id, a.mal_id, m.provider_id
             FROM anime_provider_mapping m
             JOIN anime a ON a.id = m.anime_id
             WHERE m.provider_slug = ?1 LIMIT 1`
          ).bind(cleanSlug).first().catch(() => null);

          if (provMatch) {
            malId = Number(provMatch.mal_id || provMatch.skip_key_id) || null;
            if (provMatch.title) animeTitle = provMatch.title;
            if (provMatch.provider_id) availableProviders.add(provMatch.provider_id);
          }
        }

        const mapRows = await env.ANIHUB.prepare(
          `SELECT provider_id FROM anime_provider_mapping WHERE anime_id = ?1 OR provider_slug = ?1`
        ).bind(cleanSlug).all();

        if (mapRows?.results?.length) {
          for (const row of mapRows.results) {
            if (row.provider_id) availableProviders.add(row.provider_id);
          }
        }
      } catch (_) {}
    }

    if (availableProviders.size === 0) {
      availableProviders.add('anikoto');
      availableProviders.add('hianime');
    }

    let downloads = [];
    let downloadPage = null;
    let streamUrl = null;
    let masterUrlToPipe = null;
    let pipeReferer = 'https://megaplay.buzz/';

    // --- STEP 3: Provider-Specific Download Extraction ---
    if (provider === 'anikoto') {
      if (malId) {
        downloads = await extractAnikotoDownloads(malId, ep, audio);
      }
      // Resolve direct decrypted master playlist via MegaPlay
      const direct = malId ? await resolveMegaplayDirect({ malId, ep, audio }).catch(() => null) : null;
      if (direct?.streamUrl) {
        masterUrlToPipe = direct.streamUrl;
        pipeReferer = 'https://megaplay.buzz/';
        streamUrl = `${url.origin}/api/proxy?url=${encodeURIComponent(direct.streamUrl)}&referer=https://megaplay.buzz/`;
        // Prepend high-speed in-browser stream downloads
        downloads.unshift(
          {
            name: 'AniKoto · 1080p (Stream to Video)',
            label: '1080p',
            quality: '1080p',
            url: direct.streamUrl,
            proxiedUrl: streamUrl,
            pipeUrl: `${url.origin}/api/download?mode=pipe&id=${encodeURIComponent(cleanSlug)}&ep=${ep}&provider=anikoto&audio=${audio}&quality=1080p`,
            provider: 'anikoto',
            audio,
            type: 'stream-download',
            format: 'TS / MP4',
            referer: 'https://megaplay.buzz/',
          },
          {
            name: 'AniKoto · 720p (Stream to Video)',
            label: '720p',
            quality: '720p',
            url: direct.streamUrl,
            proxiedUrl: streamUrl,
            pipeUrl: `${url.origin}/api/download?mode=pipe&id=${encodeURIComponent(cleanSlug)}&ep=${ep}&provider=anikoto&audio=${audio}&quality=720p`,
            provider: 'anikoto',
            audio,
            type: 'stream-download',
            format: 'TS / MP4',
            referer: 'https://megaplay.buzz/',
          }
        );
      } else {
        streamUrl = `${url.origin}/api/proxy?url=${encodeURIComponent(`https://megaplay.buzz/stream/mal/${malId || cleanSlug}/${ep}/${audio}`)}&referer=https://megaplay.buzz/`;
      }
      downloadPage = `https://anikoto.cz/watch/${cleanSlug}`;

    } else if (provider === 'hianime') {
      // Resolve genuine HLS master stream from Zoko edge resolver
      const zokoRes = malId ? await resolveZokoEmbedEdge(`https://zokoanime.video/stream/mal/${malId}/${ep}/${audio}`).catch(() => null) : null;

      if (zokoRes?.masterUrl) {
        masterUrlToPipe = zokoRes.masterUrl;
        pipeReferer = 'https://zokoanime.video/';
        streamUrl = `${url.origin}/api/proxy?url=${encodeURIComponent(zokoRes.masterUrl)}&referer=https://zokoanime.video/`;
        downloads.push(
          {
            name: 'HiAnime · 1080p (Stream to Video)',
            label: '1080p',
            quality: '1080p',
            url: zokoRes.masterUrl,
            proxiedUrl: streamUrl,
            pipeUrl: `${url.origin}/api/download?mode=pipe&id=${encodeURIComponent(cleanSlug)}&ep=${ep}&provider=hianime&audio=${audio}&quality=1080p`,
            provider: 'hianime',
            audio,
            type: 'stream-download',
            format: 'TS / MP4',
            referer: 'https://zokoanime.video/',
          },
          {
            name: 'HiAnime · 720p (Stream to Video)',
            label: '720p',
            quality: '720p',
            url: zokoRes.masterUrl,
            proxiedUrl: streamUrl,
            pipeUrl: `${url.origin}/api/download?mode=pipe&id=${encodeURIComponent(cleanSlug)}&ep=${ep}&provider=hianime&audio=${audio}&quality=720p`,
            provider: 'hianime',
            audio,
            type: 'stream-download',
            format: 'TS / MP4',
            referer: 'https://zokoanime.video/',
          },
          {
            name: 'HiAnime · 360p (Stream to Video)',
            label: '360p',
            quality: '360p',
            url: zokoRes.masterUrl,
            proxiedUrl: streamUrl,
            pipeUrl: `${url.origin}/api/download?mode=pipe&id=${encodeURIComponent(cleanSlug)}&ep=${ep}&provider=hianime&audio=${audio}&quality=360p`,
            provider: 'hianime',
            audio,
            type: 'stream-download',
            format: 'TS / MP4',
            referer: 'https://zokoanime.video/',
          }
        );
      } else {
        const directFallback = malId ? await resolveMegaplayDirect({ malId, ep, audio }).catch(() => null) : null;
        if (directFallback?.streamUrl) {
          masterUrlToPipe = directFallback.streamUrl;
          pipeReferer = 'https://megaplay.buzz/';
          streamUrl = `${url.origin}/api/proxy?url=${encodeURIComponent(directFallback.streamUrl)}&referer=https://megaplay.buzz/`;
          downloads.push(
            {
              name: 'HiAnime · 1080p (Stream to Video)',
              label: '1080p',
              quality: '1080p',
              url: directFallback.streamUrl,
              proxiedUrl: streamUrl,
              pipeUrl: `${url.origin}/api/download?mode=pipe&id=${encodeURIComponent(cleanSlug)}&ep=${ep}&provider=hianime&audio=${audio}&quality=1080p`,
              provider: 'hianime',
              audio,
              type: 'stream-download',
              format: 'TS / MP4',
              referer: 'https://megaplay.buzz/',
            },
            {
              name: 'HiAnime · 720p (Stream to Video)',
              label: '720p',
              quality: '720p',
              url: directFallback.streamUrl,
              proxiedUrl: streamUrl,
              pipeUrl: `${url.origin}/api/download?mode=pipe&id=${encodeURIComponent(cleanSlug)}&ep=${ep}&provider=hianime&audio=${audio}&quality=720p`,
              provider: 'hianime',
              audio,
              type: 'stream-download',
              format: 'TS / MP4',
              referer: 'https://megaplay.buzz/',
            }
          );
        } else {
          streamUrl = `${url.origin}/api/proxy?url=${encodeURIComponent(`https://zokoanime.video/stream/mal/${malId || cleanSlug}/${ep}/${audio}`)}&referer=https://zokoanime.video/`;
        }
      }

      // Also query Pahe mirrors and add as external portal links
      if (malId) {
        const mirrorRes = await extractHianimeDownloads(malId, ep, audio);
        if (mirrorRes.downloads?.length) {
          for (const d of mirrorRes.downloads) {
            downloads.push({
              ...d,
              type: 'portal',
              format: 'Mirror',
              name: `HiAnime · External Mirror (${d.label})`,
            });
          }
        }
        if (mirrorRes.downloadPage) {
          downloadPage = mirrorRes.downloadPage;
        }
      }

      if (!downloadPage) {
        downloadPage = `https://animehot.cc/watch/${cleanSlug}?ep=${ep}`;
      }

    } else if (provider === 'aniwatch') {
      // Resolve genuine direct decrypted stream via MegaPlay
      const directRes = malId ? await resolveMegaplayDirect({ malId, ep, audio }).catch(() => null) : null;

      if (directRes?.streamUrl) {
        masterUrlToPipe = directRes.streamUrl;
        pipeReferer = 'https://megaplay.buzz/';
        streamUrl = `${url.origin}/api/proxy?url=${encodeURIComponent(directRes.streamUrl)}&referer=https://megaplay.buzz/`;
        downloads = [
          {
            name: 'AniWatch · 1080p (Stream to Video)',
            label: '1080p',
            quality: '1080p',
            url: directRes.streamUrl,
            proxiedUrl: streamUrl,
            pipeUrl: `${url.origin}/api/download?mode=pipe&id=${encodeURIComponent(cleanSlug)}&ep=${ep}&provider=aniwatch&audio=${audio}&quality=1080p`,
            provider: 'aniwatch',
            audio,
            type: 'stream-download',
            format: 'TS / MP4',
            referer: 'https://megaplay.buzz/',
          },
          {
            name: 'AniWatch · 720p (Stream to Video)',
            label: '720p',
            quality: '720p',
            url: directRes.streamUrl,
            proxiedUrl: streamUrl,
            pipeUrl: `${url.origin}/api/download?mode=pipe&id=${encodeURIComponent(cleanSlug)}&ep=${ep}&provider=aniwatch&audio=${audio}&quality=720p`,
            provider: 'aniwatch',
            audio,
            type: 'stream-download',
            format: 'TS / MP4',
            referer: 'https://megaplay.buzz/',
          },
          {
            name: 'AniWatch · 360p (Stream to Video)',
            label: '360p',
            quality: '360p',
            url: directRes.streamUrl,
            proxiedUrl: streamUrl,
            pipeUrl: `${url.origin}/api/download?mode=pipe&id=${encodeURIComponent(cleanSlug)}&ep=${ep}&provider=aniwatch&audio=${audio}&quality=360p`,
            provider: 'aniwatch',
            audio,
            type: 'stream-download',
            format: 'TS / MP4',
            referer: 'https://megaplay.buzz/',
          },
        ];
      } else {
        downloads = [];
        streamUrl = null;
      }
      downloadPage = `https://aniwatch.co.at/anime/${cleanSlug}/`;

    } else if (provider === 'watchanimeworld') {
      downloadPage = `https://watchanimeworld.in/watch/${cleanSlug}`;
      downloads = [];
      streamUrl = null;
    } else {
      downloadPage = `https://megaplay.buzz/stream/mal/${malId || cleanSlug}/${ep}/${audio}`;
      downloads = [];
      streamUrl = null;
    }

    if (isPipe) {
      if (!masterUrlToPipe) {
        throw new HttpError(404, 'not_found', `Could not resolve video stream to download for ${provider} episode ${ep}`);
      }
      return await streamEpisodePipe(masterUrlToPipe, pipeReferer, requestedQuality, animeTitle, ep, request);
    }

    const safeTitle = animeTitle.replace(/[^a-zA-Z0-9_-]/g, '_');
    const ytdlpCommand = streamUrl ? `yt-dlp "${streamUrl}" -o "${safeTitle}_EP${ep}.mp4"` : '';
    const isAvailable = downloads.length > 0;
    const errorMsg = isAvailable
      ? null
      : `Episode ${ep} of "${animeTitle}" is not currently available for download on ${provider.toUpperCase()}.`;

    const payload = {
      ok: true,
      data: {
        provider,
        title: animeTitle,
        episode: ep,
        audio,
        malId,
        available: isAvailable,
        error: errorMsg,
        downloads,
        downloadPage,
        streamUrl,
        command: isAvailable ? ytdlpCommand : '',
        availableProviders: Array.from(availableProviders),
      },
    };

    // --- STEP 4: Store in D1 Cache ---
    if (env.ANIHUB && downloads.length > 0) {
      try {
        env.ANIHUB.prepare(
          `INSERT OR REPLACE INTO stream_cache (key, data, expires_at) VALUES (?1, ?2, ?3)`
        ).bind(cacheKey, JSON.stringify(payload), Date.now() + CACHE_TTL_MS).run().catch(() => {});
      } catch (_) {}
    }

    return ok(payload, { cache: 'public, max-age=180, s-maxage=300' });
  } catch (err) {
    return errorResponse(err);
  }
};

export const onRequestHead = onRequestGet;
