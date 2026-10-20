// @ts-check
import { HttpError, errorResponse, ok } from '../_lib.js';
import { resolveMegaplayDirect } from '../_megaplay.js';

const BRIDGE_TIMEOUT_MS = 25_000;

function formatServerName(provider, serverId) {
  const provNames = {
    anikoto: 'AniKoto',
    hianime: 'HiAnime',
    aniwatch: 'AniWatch',
    animedubhindi: 'AnimeDubHindi',
    watchanimeworld: 'WatchAnimeWorld',
    animewave: 'AnimeWave',
    animekai: 'AnimeKai',
  };
  const base = provNames[provider?.toLowerCase()] || (provider ? provider.toUpperCase() : 'Server');
  return serverId && serverId !== 'default' ? `${base} · ${serverId}` : base;
}

function buildAudioTracks(audio) {
  if (audio === 'hindi') {
    return [
      { id: 'hin', language: 'hi', label: 'Hindi (Multi-Audio)', default: true },
      { id: 'ja', language: 'ja', label: 'Japanese (Original)', default: false },
    ];
  }
  if (audio === 'dub') {
    return [
      { id: 'en', language: 'en', label: 'English Dub', default: true },
      { id: 'ja', language: 'ja', label: 'Japanese (Original)', default: false },
    ];
  }
  return [
    { id: 'ja', language: 'ja', label: 'Japanese (Original)', default: true },
  ];
}

/**
 * Lazy Server Stream Resolution Endpoint
 * Resolves a specific secondary server on demand when requested by the frontend player.
 *
 * GET /api/play/resolve?title=<title>&ep=<ep>&audio=<audio>&provider=<prov>&server=<server>
 */
export const onRequestGet = async ({ request, env }) => {
  try {
    const url = new URL(request.url);
    const title = (url.searchParams.get('title') || url.searchParams.get('id') || url.searchParams.get('slug') || '').trim();
    const mal = url.searchParams.get('mal') || '';
    const ep = Math.max(1, Number.parseInt(url.searchParams.get('ep') ?? '1', 10) || 1);
    const rawServerParam = url.searchParams.get('server') || '';
    let serverParam = rawServerParam;
    if (serverParam.toLowerCase() === 'mega') serverParam = 'MegaPlay';
    let audio = url.searchParams.get('audio') === 'hindi' ? 'hindi' : url.searchParams.get('audio') === 'dub' ? 'dub' : 'sub';
    if (serverParam.endsWith('-dub')) {
      audio = 'dub';
      serverParam = serverParam.replace(/-dub$/, '');
    }
    const provider = url.searchParams.get('provider') || 'auto';

    if (!title) {
      throw new HttpError(400, 'bad_request', 'title query parameter is required');
    }

    let resolvedMalId = mal ? Number.parseInt(mal, 10) : 0;
    if (!resolvedMalId && env.ANIHUB) {
      try {
        const mapRow = await env.ANIHUB.prepare(
          `SELECT mal_id FROM anime_id_map
           WHERE anime_id = ?1 OR anikoto_slug = ?1 OR hianime_slug = ?1
           LIMIT 1`
        ).bind(title).first().catch(() => null);

        if (mapRow?.mal_id) {
          resolvedMalId = Number(mapRow.mal_id);
        }

        if (!resolvedMalId) {
          const animeRow = await env.ANIHUB.prepare(
            `SELECT id, source_ids, skip_key_id, skip_key_space
             FROM anime
             WHERE id = ?1 OR title = ?1
             LIMIT 1`
          ).bind(title).first().catch(() => null);

          if (animeRow) {
            if (animeRow.skip_key_space === 'mal' && animeRow.skip_key_id) {
              resolvedMalId = Number(animeRow.skip_key_id);
            } else if (animeRow.source_ids) {
              try {
                const s = JSON.parse(animeRow.source_ids);
                if (s.mal) resolvedMalId = Number(s.mal);
              } catch {}
            }
          }
        }
      } catch {
        // Ignore D1 lookup error
      }
    }

    // Direct Edge Resolution (Method C: Pure Edge Extractor)
    // Megaplay powers AniKoto, MegaPlay, and HD-1 / Vidstream servers directly
    const canUseEdgeDirect =
      provider === 'auto' ||
      provider === 'anikoto' ||
      provider === 'aniwatch' ||
      serverParam.toLowerCase().includes('mega') ||
      serverParam.toLowerCase().includes('hd') ||
      serverParam.toLowerCase().includes('vidstream');

    if (resolvedMalId > 0 && canUseEdgeDirect) {
      try {
        const directRes = await resolveMegaplayDirect({ malId: resolvedMalId, ep, audio });
        if (directRes?.streamUrl) {
          const proxyBase = `${url.origin}/api/proxy`;
          const proxiedStreamUrl = `${proxyBase}?url=${encodeURIComponent(directRes.streamUrl)}&referer=https://megaplay.buzz/`;

          const subtitles = (directRes.subtitles || []).map((sub) => ({
            ...sub,
            url: sub.url ? `${proxyBase}?url=${encodeURIComponent(sub.url)}&referer=https://megaplay.buzz/` : '',
          }));

          const resolvedServer = {
            id: `${directRes.provider}:${rawServerParam || 'HD-1'}`,
            name: formatServerName(directRes.provider, serverParam || 'HD-1'),
            provider: directRes.provider,
            status: 'ready',
            streamUrl: proxiedStreamUrl,
            type: audio === 'dub' ? 'dub' : 'hls',
            quality: directRes.quality || '1080p',
            audio,
            audioTracks: buildAudioTracks(audio),
            subtitles,
            downloads: [],
            intro: directRes.intro || null,
            outro: directRes.outro || null,
          };

          return ok({ server: resolvedServer }, { cache: 'public, max-age=600, s-maxage=1800' });
        }
      } catch {
        // Fall back to external stream bridge
      }
    }

    const bridgeBase = env.STREAM_BRIDGE_URL || 'https://bridge.anihubstream.com';

    const resolveUrl = new URL(`${bridgeBase}/resolve`);
    resolveUrl.searchParams.set('title', title);
    resolveUrl.searchParams.set('ep', String(ep));
    resolveUrl.searchParams.set('audio', audio);
    if (provider) resolveUrl.searchParams.set('provider', provider);
    if (serverParam) resolveUrl.searchParams.set('server', serverParam);
    if (resolvedMalId) resolveUrl.searchParams.set('mal', String(resolvedMalId));

    let bridgeRes;
    try {
      const res = await fetch(resolveUrl.toString(), {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(BRIDGE_TIMEOUT_MS),
      });
      if (!res.ok) {
        throw new HttpError(res.status === 404 ? 404 : 502, 'provider_error', `Upstream bridge returned ${res.status}`);
      }
      bridgeRes = await res.json();
    } catch (err) {
      // If external bridge threw 530, timed out, or crashed: attempt title-to-MAL resolution via Jikan
      if (canUseEdgeDirect) {
        try {
          const cleanTitle = title
            .replace(/^[a-z0-9_-]+:/i, '')
            .replace(/-[a-z0-9]{5,8}$/i, '')
            .replace(/[-_:]+/g, ' ')
            .trim();
          const jikanRes = await fetch(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(cleanTitle)}&limit=1`, {
            signal: AbortSignal.timeout(4000),
          });
          if (jikanRes.ok) {
            const jikanData = await jikanRes.json();
            const foundMalId = jikanData?.data?.[0]?.mal_id;
            if (foundMalId) {
              const directRes = await resolveMegaplayDirect({ malId: foundMalId, ep, audio });
              if (directRes?.streamUrl) {
                const proxyBase = `${url.origin}/api/proxy`;
                const proxiedStreamUrl = `${proxyBase}?url=${encodeURIComponent(directRes.streamUrl)}&referer=https://megaplay.buzz/`;

                const subtitles = (directRes.subtitles || []).map((sub) => ({
                  ...sub,
                  url: sub.url ? `${proxyBase}?url=${encodeURIComponent(sub.url)}&referer=https://megaplay.buzz/` : '',
                }));

                const resolvedServer = {
                  id: `${directRes.provider}:${rawServerParam || 'HD-1'}`,
                  name: formatServerName(directRes.provider, serverParam || 'HD-1'),
                  provider: directRes.provider,
                  status: 'ready',
                  streamUrl: proxiedStreamUrl,
                  type: audio === 'dub' ? 'dub' : 'hls',
                  quality: directRes.quality || '1080p',
                  audio,
                  audioTracks: buildAudioTracks(audio),
                  subtitles,
                  downloads: [],
                  intro: directRes.intro || null,
                  outro: directRes.outro || null,
                };

                return ok({ server: resolvedServer }, { cache: 'public, max-age=600, s-maxage=1800' });
              }
            }
          }
        } catch {
          // ignore fallback error
        }
      }

      if (err instanceof HttpError) throw err;
      throw new HttpError(504, 'upstream_timeout', 'Stream bridge resolution timed out');
    }

    if (!bridgeRes || (!bridgeRes.master && !bridgeRes.streamUrl)) {
      throw new HttpError(502, 'provider_error', 'No playable stream returned by provider');
    }

    const meta = bridgeRes;
    const prov = meta.provider || provider;
    const masterPath = meta.master || meta.streamUrl || '';
    const streamUrl = masterPath.startsWith('http') ? masterPath : `${bridgeBase}${masterPath}`;

    const subtitles = (meta.subtitles || []).map((sub, idx) => ({
      id: `sub-${idx}`,
      language: sub.language || 'en',
      label: sub.name || sub.language?.toUpperCase() || 'English',
      url: sub.url?.startsWith('http') ? sub.url : `${bridgeBase}${sub.url}`,
      default: idx === 0,
    }));

    const downloads = (meta.downloads || []).map((dl) => ({
      name: dl.name || dl.quality || 'Download',
      quality: dl.quality || '1080p',
      url: dl.url?.startsWith('http') ? dl.url : `${bridgeBase}${dl.url}`,
    }));

    const resolvedAudio = meta.audio || audio;
    let serverName = formatServerName(prov, serverParam || 'HD-1');
    if (audio === 'dub' && resolvedAudio === 'sub') {
      serverName += ' (Sub Only)';
    }

    const resolvedServer = {
      id: `${prov}:${rawServerParam || 'HD-1'}`,
      name: serverName,
      provider: prov,
      status: 'ready',
      streamUrl,
      type: resolvedAudio === 'dub' ? 'dub' : (meta.kind === 'progressive' ? 'mp4' : 'hls'),
      quality: meta.quality || '1080p',
      audio: resolvedAudio,
      audioTracks: buildAudioTracks(resolvedAudio),
      subtitles,
      downloads,
    };

    return ok({ server: resolvedServer }, { cache: 'public, max-age=600, s-maxage=1800' });
  } catch (err) {
    return errorResponse(err);
  }
};
