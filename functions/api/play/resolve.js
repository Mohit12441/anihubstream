// @ts-check
import { HttpError, buildAudioTracks, cleanDisplayTitle, deriveSlugCandidates, errorResponse, findAnimeByCandidates, formatServerName, ok, parseMaster, resolveBetaAudioTracks, withEdgeCache } from '../_lib.js';
import { resolveMegaplayDirect, isMegaplayTokenValid } from '../_megaplay.js';
import { resolveZokoEmbedEdge } from '../hianime/_zoko.js';

const BRIDGE_TIMEOUT_MS = 6_000;

/**
 * Lazy Server Stream Resolution Endpoint
 * Resolves a specific secondary server on demand when requested by the frontend player.
 *
 * GET /api/play/resolve?anime_id=<id>&ep=<ep>&audio=<audio>&provider=<prov>&server=<server>
 */
export const onRequestGet = async ({ request, env, waitUntil }) => {
  return withEdgeCache(
    request,
    env,
    600,
    async () => {
      try {
        const url = new URL(request.url);
        const animeIdParam = url.searchParams.get('anime_id') || url.searchParams.get('id') || '';
        const titleParam = url.searchParams.get('title') || '';
        const ep = Math.max(1, Number.parseInt(url.searchParams.get('ep') ?? '1', 10) || 1);
        const provider = url.searchParams.get('provider') || 'auto';
        const rawServerParam = url.searchParams.get('server') || '';
        let serverParam = rawServerParam;
        if (serverParam.toLowerCase() === 'mega') serverParam = 'MegaPlay';
        let audio = url.searchParams.get('audio') === 'hindi' ? 'hindi'
          : url.searchParams.get('audio') === 'dub' ? 'dub' : 'sub';
        if (serverParam.endsWith('-dub')) {
          audio = 'dub';
          serverParam = serverParam.replace(/-dub$/, '');
        }

        if (!animeIdParam && !titleParam) {
          throw new HttpError(400, 'bad_request', 'Missing anime_id or title parameter');
        }

        // Single canonical lookup: resolve anime_id → all identity dimensions
        let meta = null;
        let animeId = animeIdParam;

        if (animeIdParam && env.ANIHUB) {
          try {
            const redir = await env.ANIHUB.prepare('SELECT to_id FROM anime_redirect WHERE from_id = ?1').bind(animeIdParam).first();
            if (redir?.to_id) {
              animeId = redir.to_id;
            } else {
              const candidates = deriveSlugCandidates(animeIdParam);
              const found = await findAnimeByCandidates(env.ANIHUB, candidates);
              if (found?.id) animeId = found.id;
            }
          } catch {}

          meta = await env.ANIHUB.prepare(`
            SELECT a.id, a.title, a.status, a.source_ids, a.skip_key_id, a.skip_key_space,
                   m.mal_id, m.anilist_id, m.kitsu_id,
                   pm.provider_slug
            FROM anime a
            LEFT JOIN anime_id_map m ON m.anime_id = a.id
            LEFT JOIN anime_provider_mapping pm
              ON pm.anime_id = a.id AND pm.provider_id = ?2
            WHERE a.id = ?1
          `).bind(animeId, provider).first();
        }

        // Backward-compat: allow title-only lookups for legacy callers
        if (!meta && titleParam && env.ANIHUB) {
          meta = await env.ANIHUB.prepare(`
            SELECT a.id, a.title, a.status, a.source_ids, a.skip_key_id, a.skip_key_space,
                   m.mal_id, m.anilist_id, m.kitsu_id,
                   pm.provider_slug
            FROM anime a
            LEFT JOIN anime_id_map m ON m.anime_id = a.id
            LEFT JOIN anime_provider_mapping pm
              ON pm.anime_id = a.id AND pm.provider_id = ?2
            WHERE LOWER(a.title) = LOWER(?1)
            LIMIT 1
          `).bind(titleParam, provider).first();
          if (meta) animeId = meta.id;
        }

        // Fuzzy fallback in D1 before giving up
        if (!meta && animeIdParam && env.ANIHUB) {
          try {
            const cleanPattern = `%${animeIdParam.replace(/[-_]+/g, '%').slice(0, 30)}%`;
            meta = await env.ANIHUB.prepare(`
              SELECT a.id, a.title, a.status, a.source_ids, a.skip_key_id, a.skip_key_space,
                     m.mal_id, m.anilist_id, m.kitsu_id,
                     pm.provider_slug
              FROM anime a
              LEFT JOIN anime_id_map m ON m.anime_id = a.id
              LEFT JOIN anime_provider_mapping pm
                ON pm.anime_id = a.id AND pm.provider_id = ?2
              WHERE a.id LIKE ?1 OR LOWER(a.title) LIKE ?1
              LIMIT 1
            `).bind(cleanPattern, provider).first();
            if (meta) animeId = meta.id;
          } catch {}
        }

        if (!meta) {
          const fallbackTitle = cleanDisplayTitle(titleParam || animeIdParam);
          meta = { id: animeIdParam || titleParam, title: fallbackTitle || animeIdParam, status: 'Released', mal_id: 0 };
          animeId = meta.id;
        }

        const resolvedTitle = meta.title || animeId;
        let resolvedMalId = meta.mal_id || 0;
        const anilistParam = url.searchParams.get('anilist') || '';
        const anilistIdFromParam = /^\d+$/.test(anilistParam) ? Number.parseInt(anilistParam, 10) : 0;
        let resolvedAnilistId = meta?.anilist_id || anilistIdFromParam || (/^\d+$/.test(animeIdParam) ? Number.parseInt(animeIdParam, 10) : 0);
        let resolvedKitsuId = meta.kitsu_id || 0;

        if (!resolvedMalId && meta.skip_key_space === 'mal' && meta.skip_key_id) {
          resolvedMalId = meta.skip_key_id;
        }
        if (meta.source_ids) {
          try {
            const s = JSON.parse(meta.source_ids);
            if (!resolvedMalId && s.mal) resolvedMalId = Number(s.mal);
            if (!resolvedAnilistId && s.anilist) resolvedAnilistId = Number(s.anilist);
            if (!resolvedKitsuId && s.kitsu) resolvedKitsuId = Number(s.kitsu);
          } catch {}
        }
        const providerSlug = meta.provider_slug || '';

        if (meta.status === 'Upcoming' || meta.status === 'NOT_YET_RELEASED') {
          throw new HttpError(404, 'not_found', 'Anime not yet released');
        }

        // Direct Edge Resolution (Method C: Pure Edge Extractor)
        // Check AniPM Beta edge-native multi-audio first if AniPM or Beta server requested
        const shouldUseEdgeBeta =
          resolvedAnilistId > 0 &&
          (
            (provider === 'anipm' && (!serverParam || serverParam.toLowerCase() === 'beta')) ||
            (provider === 'auto' && serverParam && serverParam.toLowerCase() === 'beta')
          );

        if (shouldUseEdgeBeta) {
          try {
            const betaDirect = await resolveBetaAudioTracks(env, resolvedAnilistId, meta, ep, audio, request);
            if (betaDirect?.streamUrl) {
              const effectiveProvider = 'anipm';
              const cleanServerId = rawServerParam || 'beta';
              const resolvedServer = {
                id: `${effectiveProvider}:${cleanServerId}`,
                name: formatServerName(effectiveProvider, serverParam || 'Beta Master'),
                provider: effectiveProvider,
                status: 'ready',
                streamUrl: betaDirect.streamUrl,
                referrerPolicy: betaDirect.referrerPolicy || 'no-referrer',
                betaUrlCandidates: betaDirect.betaUrlCandidates,
                type: 'hls',
                quality: betaDirect.quality || '1080p',
                audio,
                audioTracks: [],
                subtitles: betaDirect.subtitles || [],
                downloads: [],
              };
              return ok({ server: resolvedServer }, { cache: 'public, max-age=600, s-maxage=1800' });
            }
          } catch {}
        }

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
            const cacheKey = `stream:${provider || 'auto'}:${resolvedMalId}:${ep}:${audio}`;
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
                const zokoRes = await resolveZokoEmbedEdge(zokoDirectUrl, { signal: AbortSignal.timeout(1200) });
                if (zokoRes?.masterUrl) {
                  directRes = {
                    streamUrl: zokoRes.masterUrl,
                    referer: 'https://zokoanime.video/',
                    quality: zokoRes.defaultQuality || '1080p',
                    subtitles: zokoRes.subtitles || [],
                    provider: 'hianime',
                    skip: zokoRes.skip,
                  };
                }
              }
              if (!directRes) {
                directRes = await resolveMegaplayDirect({ malId: resolvedMalId, ep, audio, server: serverParam, provider });
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
              const activeReferer = directRes.referer || (provider === 'hianime' ? 'https://zokoanime.video/' : 'https://megaplay.buzz/');
              const proxiedStreamUrl = `${proxyBase}?url=${encodeURIComponent(directRes.streamUrl)}&referer=${encodeURIComponent(activeReferer)}`;

              const subtitles = (directRes.subtitles || []).map((sub) => ({
                ...sub,
                language: sub.language || sub.lang || 'en',
                label: sub.label || sub.name || 'English',
                name: sub.name || sub.label || 'English',
                url: sub.url ? `${proxyBase}?url=${encodeURIComponent(sub.url)}&referer=${encodeURIComponent(activeReferer)}` : '',
              }));

              const effectiveProvider = directRes?.provider || 'fallback';
              const cleanServerId = rawServerParam || 'HD-1';
              const serverIdWithAudio = audio === 'dub' && !cleanServerId.includes('-dub') ? `${cleanServerId}-dub` : cleanServerId;
              const serverNameWithAudio = audio === 'dub' && !serverParam.includes('(DUB)') ? `${serverParam || 'HD-1'} (DUB)` : (serverParam || 'HD-1');
              const resolvedServer = {
                id: `${effectiveProvider}:${serverIdWithAudio}`,
                name: formatServerName(effectiveProvider, serverNameWithAudio),
                provider: effectiveProvider,
                status: 'ready',
                streamUrl: proxiedStreamUrl,
                type: audio === 'dub' ? 'dub' : 'hls',
                quality: directRes.quality || '1080p',
                audio,
                audioTracks: (Array.isArray(directRes?.audioTracks) && directRes.audioTracks.length > 0)
                  ? directRes.audioTracks
                  : (Array.isArray(directRes?.audio) && directRes.audio.length > 0)
                    ? directRes.audio
                    : buildAudioTracks(audio),
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

        const bridgeBase = env.STREAM_BRIDGE_URL || 'http://127.0.0.1:8795';

        let bridgeRes = null;
        if (bridgeBase) {
          const resolveUrl = new URL(`${bridgeBase}/resolve`);
          resolveUrl.searchParams.set('anime_id', animeId);
          resolveUrl.searchParams.set('title', resolvedTitle);
          resolveUrl.searchParams.set('ep', String(ep));
          resolveUrl.searchParams.set('audio', audio);
          if (provider) resolveUrl.searchParams.set('provider', provider);
          if (serverParam) resolveUrl.searchParams.set('server', serverParam);
          if (resolvedMalId) resolveUrl.searchParams.set('mal_id', String(resolvedMalId));
          if (resolvedAnilistId) resolveUrl.searchParams.set('anilist_id', String(resolvedAnilistId));
          if (resolvedKitsuId) resolveUrl.searchParams.set('kitsu_id', String(resolvedKitsuId));
          if (providerSlug) resolveUrl.searchParams.set('slug', providerSlug);
          if (url.searchParams.has('fallback')) resolveUrl.searchParams.set('fallback', url.searchParams.get('fallback'));

          try {
            const res = await fetch(resolveUrl.toString(), {
              headers: { accept: 'application/json' },
              signal: AbortSignal.timeout(BRIDGE_TIMEOUT_MS),
            });
            if (res.ok) {
              bridgeRes = await res.json();
            }
          } catch {}
        }

        if (!bridgeRes) {
          // If bridge unavailable, attempt edge direct fallback via known MAL ID or Jikan lookup
          try {
            let targetMalId = resolvedMalId || 0;
            if (!targetMalId && env.ANIHUB) {
              try {
                const row = await env.ANIHUB.prepare(
                  'SELECT mal_id FROM anime WHERE title = ?1 OR title_romaji = ?1 OR title_english = ?1 LIMIT 1'
                ).bind(resolvedTitle).first();
                if (row?.mal_id) targetMalId = Number(row.mal_id);
              } catch {}
            }
            if (!targetMalId) {
              const cleanTitle = cleanDisplayTitle(resolvedTitle);
              const jikanRes = await fetch(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(cleanTitle)}&limit=1`, {
                signal: AbortSignal.timeout(3000),
              });
              if (jikanRes.ok) {
                const jikanData = await jikanRes.json();
                targetMalId = jikanData?.data?.[0]?.mal_id || 0;
                if (targetMalId > 0 && animeId && env.ANIHUB) {
                  env.ANIHUB.prepare('UPDATE anime SET mal_id = ?1 WHERE id = ?2 AND mal_id IS NULL')
                    .bind(targetMalId, animeId).run().catch(() => {});
                }
              }
            }
            if (targetMalId > 0) {
              const directRes = await resolveMegaplayDirect({ malId: targetMalId, ep, audio });
              if (directRes?.streamUrl) {
                if (env.ANIHUB && targetMalId > 0) {
                  const ttl = Date.now() + 20 * 60 * 1000;
                  const cacheKey = `stream:${directRes.provider || 'anikoto'}:${targetMalId}:${ep}:${audio}`;
                  env.ANIHUB.prepare(
                    'INSERT OR REPLACE INTO stream_cache (key, data, expires_at) VALUES (?1, ?2, ?3)',
                  ).bind(cacheKey, JSON.stringify(directRes), ttl).run().catch(() => {});
                }

                    const proxyBase = `${url.origin}/api/proxy`;
                    const proxiedStreamUrl = `${proxyBase}?url=${encodeURIComponent(directRes.streamUrl)}&referer=https://megaplay.buzz/`;

                    const subtitles = (directRes.subtitles || []).map((sub) => ({
                      ...sub,
                      language: sub.language || sub.lang || 'en',
                      label: sub.label || sub.name || 'English',
                      name: sub.name || sub.label || 'English',
                      url: sub.url ? `${proxyBase}?url=${encodeURIComponent(sub.url)}&referer=https://megaplay.buzz/` : '',
                    }));

                    const cleanServerId = rawServerParam || 'HD-1';
                    const serverIdWithAudio = audio === 'dub' && !cleanServerId.includes('-dub') ? `${cleanServerId}-dub` : cleanServerId;
                    const serverNameWithAudio = audio === 'dub' && !serverParam.includes('(DUB)') ? `${serverParam || 'HD-1'} (DUB)` : (serverParam || 'HD-1');
                    const resolvedServer = {
                      id: `${directRes.provider}:${serverIdWithAudio}`,
                      name: formatServerName(directRes.provider, serverNameWithAudio),
                      provider: directRes.provider,
                      status: 'ready',
                      streamUrl: proxiedStreamUrl,
                      type: audio === 'dub' ? 'dub' : 'hls',
                      quality: directRes.quality || '1080p',
                      audio,
                      audioTracks: (Array.isArray(directRes?.audioTracks) && directRes.audioTracks.length > 0)
                        ? directRes.audioTracks
                        : (Array.isArray(directRes?.audio) && directRes.audio.length > 0)
                          ? directRes.audio
                          : buildAudioTracks(audio),
                      subtitles,
                      downloads: [],
                      intro: directRes.intro || null,
                      outro: directRes.outro || null,
                    };

                    return ok({ server: resolvedServer }, { cache: 'public, max-age=600, s-maxage=1800' });
                  }
                }
            } catch {
              // ignore fallback error
            }

          throw new HttpError(504, 'upstream_timeout', 'Stream bridge resolution timed out or unavailable');
        }

        if (!bridgeRes || (!bridgeRes.master && !bridgeRes.streamUrl)) {
          throw new HttpError(502, 'provider_error', 'No playable stream returned by provider');
        }

        const metaData = bridgeRes;
        const prov = metaData.provider || provider;
        const proxyBase = `${url.origin}/api/proxy`;
        const masterPath = metaData.master || metaData.streamUrl || '';
        const activeReferer = metaData.referer || (prov === 'hianime' ? 'https://zokoanime.video/' : (prov === 'aniwatch' || prov === 'anikoto' ? 'https://megaplay.buzz/' : ''));
        let streamUrl;
        if (masterPath.includes('/api/proxy')) {
          streamUrl = masterPath.startsWith('http') ? masterPath : `${url.origin}${masterPath}`;
        } else if (masterPath.startsWith('http')) {
          streamUrl = activeReferer
            ? `${proxyBase}?url=${encodeURIComponent(masterPath)}&referer=${encodeURIComponent(activeReferer)}`
            : `${proxyBase}?url=${encodeURIComponent(masterPath)}`;
        } else {
          streamUrl = `${bridgeBase}${masterPath}`;
        }

        if (metaData.kind === 'embed' || metaData.type === 'embed' || streamUrl.includes('morencius') || (!streamUrl.includes('.m3u8') && !streamUrl.includes('.mp4') && streamUrl.includes('/embed'))) {
          throw new HttpError(404, 'not_found', 'Direct stream not available; embeds disabled');
        }

        const subtitles = (metaData.subtitles || []).map((sub, idx) => {
          let subUrl = sub.url || sub.proxyUrl || sub.uri || '';
          if (subUrl.includes('/api/proxy') || subUrl.startsWith('/api/')) {
            subUrl = subUrl.startsWith('http') ? subUrl : `${url.origin}${subUrl}`;
          } else if (subUrl.startsWith('http')) {
            subUrl = activeReferer
              ? `${proxyBase}?url=${encodeURIComponent(subUrl)}&referer=${encodeURIComponent(activeReferer)}`
              : `${proxyBase}?url=${encodeURIComponent(subUrl)}`;
          } else if (subUrl && !subUrl.startsWith('http')) {
            subUrl = `${bridgeBase}${subUrl}`;
          }
          return {
            id: sub.id ? String(sub.id) : `sub-${idx}`,
            language: sub.language || sub.lang || 'en',
            label: sub.label || sub.name || sub.language?.toUpperCase() || 'English',
            name: sub.name || sub.label || sub.language?.toUpperCase() || 'English',
            url: subUrl,
            default: sub.default !== undefined ? Boolean(sub.default) : idx === 0,
          };
        });

        const downloads = (metaData.downloads || []).map((dl) => ({
          name: dl.name || dl.quality || 'Download',
          quality: dl.quality || '1080p',
          url: dl.url?.startsWith('http') ? dl.url : `${bridgeBase}${dl.url}`,
        }));

        const rawAudioMeta = (Array.isArray(metaData.audioTracks) && metaData.audioTracks.length > 0)
          ? metaData.audioTracks
          : (Array.isArray(metaData.audio) && metaData.audio.length > 0)
            ? metaData.audio
            : null;

        const resolvedAudio = typeof metaData.audio === 'string' ? metaData.audio : audio;
        let serverName = formatServerName(prov, serverParam || 'HD-1');
        if (audio === 'dub' && resolvedAudio === 'sub') {
          serverName += ' (Sub Only)';
        }

        const resolvedAudioTracks = rawAudioMeta
          ? rawAudioMeta.map((t, i) => ({
              id: t.id !== undefined ? String(t.id) : (t.language || t.lang || `audio-${i}`),
              language: t.language || t.lang || 'ja',
              label: t.label || t.name || t.language || 'Audio',
              default: t.default !== undefined ? Boolean(t.default) : i === 0,
            }))
          : buildAudioTracks(resolvedAudio);

        const resolvedServer = {
          id: `${prov}:${rawServerParam || 'HD-1'}`,
          name: serverName,
          provider: prov,
          status: 'ready',
          streamUrl,
          type: metaData.type || (resolvedAudio === 'dub' ? 'dub' : (metaData.kind === 'progressive' ? 'mp4' : 'hls')),
          quality: metaData.quality || '1080p',
          audio: resolvedAudio,
          audioTracks: resolvedAudioTracks,
          subtitles,
          downloads,
          intro: metaData.skip?.intro ? { start: metaData.skip.intro[0], end: metaData.skip.intro[1] } : undefined,
          outro: metaData.skip?.outro ? { start: metaData.skip.outro[0], end: metaData.skip.outro[1] } : undefined,
        };

        return ok({ server: resolvedServer }, { cache: 'public, max-age=600, s-maxage=1800' });
      } catch (err) {
        return errorResponse(err);
      }
    },
    { allowedParams: ['anime_id', 'id', 'title', 'ep', 'audio', 'provider', 'server', 'anilist'], waitUntil },
  );
};
