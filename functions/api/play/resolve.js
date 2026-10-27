// @ts-check
import { HttpError, cleanDisplayTitle, errorResponse, ok, resolveMalId } from '../_lib.js';
import { resolveMegaplayDirect, isMegaplayTokenValid } from '../_megaplay.js';
import { resolveZokoEmbedEdge } from '../hianime/_zoko.js';

const BRIDGE_TIMEOUT_MS = 25_000;

function formatServerName(provider, serverId) {
  const provNames = {
    anikoto: 'AniKoto',
    hianime: 'HiAnime',
    aniwatch: 'AniWatch',
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
          `SELECT a.source_ids, a.skip_key_id, a.skip_key_space FROM anime_provider_mapping m JOIN anime a ON a.id = m.anime_id
           WHERE m.provider_slug = ?1 LIMIT 1`
        ).bind(title).first().catch(() => null);

        if (mapRow) {
          resolvedMalId = resolveMalId(mapRow.source_ids, mapRow.skip_key_id, mapRow.skip_key_space) || 0;
        }

        if (!resolvedMalId) {
          const idMapRow = await env.ANIHUB.prepare(
            `SELECT mal_id FROM anime_id_map
             WHERE anime_id = ?1 OR anikoto_slug = ?1 OR hianime_slug = ?1
             LIMIT 1`
          ).bind(title).first().catch(() => null);

          if (idMapRow?.mal_id) {
            resolvedMalId = Number(idMapRow.mal_id);
          }
        }

        if (!resolvedMalId) {
          const animeRow = await env.ANIHUB.prepare(
            `SELECT id, source_ids, skip_key_id, skip_key_space
             FROM anime
             WHERE id = ?1 OR title = ?1
             LIMIT 1`
          ).bind(title).first().catch(() => null);

          if (animeRow) {
            resolvedMalId = resolveMalId(animeRow.source_ids, animeRow.skip_key_id, animeRow.skip_key_space) || 0;
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
      provider === 'hianime' ||
      provider === 'aniwatch' ||
      serverParam.toLowerCase().includes('mega') ||
      serverParam.toLowerCase().includes('hd') ||
      serverParam.toLowerCase().includes('vidstream');

    if (resolvedMalId > 0 && canUseEdgeDirect) {
      try {
        const cacheKey = `stream:${provider === 'hianime' ? 'hianime' : 'anikoto'}:${resolvedMalId}:${ep}:${audio}`;
        let directRes = null;
        if (env.ANIHUB) {
          try {
            const cached = await env.ANIHUB.prepare(
              'SELECT data FROM stream_cache WHERE key = ?1 AND expires_at > ?2'
            ).bind(cacheKey, Date.now()).first();
            if (cached?.data) {
              const parsed = JSON.parse(cached.data);
              if (parsed?.streamUrl && isMegaplayTokenValid(parsed.streamUrl)) {
                directRes = parsed;
              }
            }
          } catch {}
        }
        if (!directRes) {
          if (provider === 'hianime') {
            const zokoDirectUrl = `https://zokoanime.video/stream/mal/${resolvedMalId}/${ep}/${audio}`;
            const zokoRes = await resolveZokoEmbedEdge(zokoDirectUrl, { signal: AbortSignal.timeout(3500) });
            if (zokoRes?.masterUrl) {
              directRes = {
                streamUrl: zokoRes.masterUrl,
                referer: 'https://zokoanime.video/',
                quality: zokoRes.defaultQuality || '1080p',
                subtitles: [],
                provider: 'hianime',
                skip: zokoRes.skip,
              };
            }
          }
          if (!directRes) {
            directRes = await resolveMegaplayDirect({ malId: resolvedMalId, ep, audio });
          }
          if (env.ANIHUB && directRes?.streamUrl) {
            const ttl = Date.now() + 20 * 60 * 1000;
            env.ANIHUB.prepare(
              'INSERT OR REPLACE INTO stream_cache (key, data, expires_at) VALUES (?1, ?2, ?3)'
            ).bind(cacheKey, JSON.stringify(directRes), ttl).run().catch(() => {});
          }
        }
        if (directRes?.streamUrl) {
          const proxyBase = `${url.origin}/api/proxy`;
          const activeReferer = directRes.referer || 'https://megaplay.buzz/';
          const proxiedStreamUrl = `${proxyBase}?url=${encodeURIComponent(directRes.streamUrl)}&referer=${encodeURIComponent(activeReferer)}`;

          const subtitles = (directRes.subtitles || []).map((sub) => ({
            ...sub,
            url: sub.url ? `${proxyBase}?url=${encodeURIComponent(sub.url)}&referer=${encodeURIComponent(activeReferer)}` : '',
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

    const bridgeBase = env.STREAM_BRIDGE_URL || '';

    let bridgeRes = null;
    if (bridgeBase) {
      const cleanTitle = cleanDisplayTitle(title);
      const resolveUrl = new URL(`${bridgeBase}/resolve`);
      resolveUrl.searchParams.set('title', cleanTitle || title);
      resolveUrl.searchParams.set('ep', String(ep));
      resolveUrl.searchParams.set('audio', audio);
      if (provider) resolveUrl.searchParams.set('provider', provider);
      if (serverParam) resolveUrl.searchParams.set('server', serverParam);
      if (resolvedMalId) resolveUrl.searchParams.set('mal', String(resolvedMalId));

      try {
        const res = await fetch(resolveUrl.toString(), {
          headers: { accept: 'application/json' },
          signal: AbortSignal.timeout(2000),
        });
        if (res.ok) {
          bridgeRes = await res.json();
        }
      } catch {}
    }

    if (!bridgeRes) {
      // If no bridge configured or bridge timed out: attempt title-to-MAL resolution via Jikan
      if (canUseEdgeDirect) {
        try {
          const cleanTitle = title
            .replace(/^(?:hianime|anikoto|aniwatch|watchanimeworld|animewave|animekai):/i, '')
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
                if (env.ANIHUB && foundMalId > 0) {
                  const animeSlug = title.replace(/^(?:hianime|anikoto|aniwatch|watchanimeworld|animewave|animekai):/i, '');
                  env.ANIHUB.prepare(
                    `INSERT INTO anime_id_map (anime_id, mal_id, confidence, updated_at)
                     VALUES (?1, ?2, 0.9, datetime('now'))
                     ON CONFLICT(anime_id) DO UPDATE SET
                       mal_id = coalesce(excluded.mal_id, anime_id_map.mal_id),
                       updated_at = datetime('now')`,
                  ).bind(animeSlug, foundMalId).run().catch(() => {});

                  env.ANIHUB.prepare(
                    `UPDATE anime SET
                       source_ids = json_patch(COALESCE(source_ids, '{}'), ?1)
                     WHERE id = ?2`,
                  ).bind(JSON.stringify({ mal: foundMalId }), animeSlug).run().catch(() => {});

                  env.ANIHUB.prepare(
                    `INSERT INTO anime_provider_mapping (anime_id, provider_id, provider_slug, confidence)
                     VALUES (?1, 'anikoto', ?2, 0.9)
                     ON CONFLICT(anime_id, provider_id) DO UPDATE SET
                       provider_slug = excluded.provider_slug,
                       confidence = excluded.confidence,
                       updated_at = unixepoch()`,
                  ).bind(animeSlug, animeSlug).run().catch(() => {});

                  const ttl = Date.now() + 20 * 60 * 1000;
                  const cacheKey = `stream:${directRes.provider || 'anikoto'}:${foundMalId}:${ep}:${audio}`;
                  env.ANIHUB.prepare(
                    'INSERT OR REPLACE INTO stream_cache (key, data, expires_at) VALUES (?1, ?2, ?3)',
                  ).bind(cacheKey, JSON.stringify(directRes), ttl).run().catch(() => {});
                }

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

      throw new HttpError(504, 'upstream_timeout', 'Stream bridge resolution timed out or unavailable');
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
