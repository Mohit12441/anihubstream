// @ts-check
import { HttpError, buildAudioTracks, cleanDisplayTitle, deriveSlugCandidates, errorResponse, findAnimeByCandidates, formatServerName, ok, withEdgeCache } from '../_lib.js';
import { resolveMegaplayDirect, isMegaplayTokenValid } from '../_megaplay.js';
import { resolveZokoEmbedEdge } from '../hianime/_zoko.js';
import { resolveHiAnimeV2Direct } from '../hianime/_hianime_v2.js';
import { resolveAniPmBetaDirect } from '../_anipm.js';
import { resolveAniWatchDirect } from '../_aniwatch.js';
import { hdrezkaMeta, rezkaFetch, parseStreams, searchRezka } from '../../_lib/hdrezka.js';
import { resolveHindiFlixStream } from '../../_lib/hindiflix.js';

const BRIDGE_TIMEOUT_MS = 15_000;

/**
 * Lazy Server Stream Resolution Endpoint
 * Resolves a specific secondary server on demand when requested by the frontend player.
 *
 * GET /api/play/resolve?anime_id=<id>&ep=<ep>&audio=<audio>&provider=<prov>&server=<server>
 */
export const onRequestGet = async ({ request, env, waitUntil }) => {
  try {
    const url = new URL(request.url);
        const animeIdParam = url.searchParams.get('anime_id') || url.searchParams.get('id') || '';
        const titleParam = url.searchParams.get('title') || '';
        const malIdParam = url.searchParams.get('malId') || url.searchParams.get('mal_id') || url.searchParams.get('mal') || '';
        const ep = Math.max(1, Number.parseInt(url.searchParams.get('ep') ?? '1', 10) || 1);
        let season = Math.max(1, Number.parseInt(url.searchParams.get('season') ?? '1', 10) || 1);
        if (!url.searchParams.has('season')) {
          const sMatch = (animeIdParam || titleParam || '').match(/(?:season|part|s)[-_ ]*(\d+)/i);
          if (sMatch) season = Math.max(1, Number.parseInt(sMatch[1], 10) || 1);
        }
        const provider = url.searchParams.get('provider') || 'auto';
        const rawServerParam = url.searchParams.get('server') || '';
        let serverParam = rawServerParam;
        if (serverParam.toLowerCase() === 'mega') serverParam = 'MegaPlay';
        const rawAudio = (url.searchParams.get('audio') || '').toLowerCase();
        let audio = ['hindi', 'russian', 'spanish', 'dub'].includes(rawAudio) ? rawAudio : 'sub';
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
        let resolvedMalId = meta.mal_id || (Number.parseInt(malIdParam, 10) || 0);
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

        if (provider === 'anipm' && (!serverParam || serverParam.toLowerCase() === 'beta' || serverParam.toLowerCase() === 'beta-dub')) {
          const targetAnilist = resolvedAnilistId || meta?.anilist_id || (Number(animeIdParam) ? Number(animeIdParam) : 0);
          const isDub = audio === 'dub' || serverParam?.toLowerCase().includes('dub');
          const serverId = isDub ? 'anipm:beta-dub' : 'anipm:beta';
          const serverName = isDub ? 'AniPM · Beta (DUB)' : 'AniPM · Beta';
          const betaRes = await resolveAniPmBetaDirect({
            anilistId: targetAnilist,
            ep,
            title: resolvedTitle || meta?.title,
            slug: meta?.provider_slug || animeIdParam,
          });
          if (betaRes?.status === 'ready' && betaRes?.streamUrl) {
            return ok({
              server: {
                id: serverId,
                provider: 'anipm',
                name: serverName,
                status: 'ready',
                streamUrl: betaRes.streamUrl,
                audio: isDub ? 'dub' : 'sub',
                audioTracks: betaRes.audioTracks || [],
                subtitles: betaRes.subtitles || [],
                quality: '1080p',
              }
            });
          }
          return ok({
            server: {
              id: serverId,
              provider: 'anipm',
              name: serverName,
              status: 'unavailable',
              unavailableReason: betaRes?.unavailableReason || 'Could not resolve AniPM Beta stream for this episode.',
              streamUrl: null,
              audio: isDub ? 'dub' : 'sub',
              audioTracks: [],
              subtitles: [],
              quality: '1080p',
            }
          });
        }

        if (provider === 'hdrezka') {
          let rezkaId = meta?.provider_slug || null;
          if (!rezkaId && env.ANIHUB) {
            try {
              const row = await env.ANIHUB.prepare(
                "SELECT provider_slug FROM anime_provider_mapping WHERE anime_id = ?1 AND provider_id = 'hdrezka' LIMIT 1"
              ).bind(animeId).first();
              if (row?.provider_slug) rezkaId = row.provider_slug;
            } catch {}
          }
          if (!rezkaId) {
            rezkaId = await searchRezka(env, resolvedTitle || animeId);
            if (rezkaId && env.ANIHUB) {
              try {
                await env.ANIHUB.prepare(
                  "INSERT OR IGNORE INTO anime_provider_mapping (anime_id, provider_id, provider_slug) VALUES (?1, 'hdrezka', ?2)"
                ).bind(animeId, rezkaId).run();
              } catch {}
            }
          }
          let rawPayload = null;
          let subtitleRaw = null;
          let resolvedTid = null;
          if (rezkaId) {
            // Translator selection: map studio subservers to their upstream translator_ids
            const srvLower = String(rawServerParam || serverParam || '').toLowerCase();
            let targetTr = null;
            if (srvLower.includes('anilibria') || srvLower.includes('19')) targetTr = '19';
            else if (srvLower.includes('tvshows') || srvLower.includes('565')) targetTr = '565';
            else if (srvLower.includes('studioband') || srvLower.includes('105')) targetTr = '105';
            else if (srvLower.includes('original') || srvLower.includes('238') || srvLower.includes('1080p')) targetTr = '238';

            const isDubAudio = audio === 'dub' || audio === 'russian' || (targetTr && targetTr !== '238') || srvLower.includes('dub');
            const TRANSLATORS = targetTr
              ? [targetTr]
              : (isDubAudio ? ['105', '19', '565'] : ['238', '105']);
            const sCandidates = [String(season)];
            if (season > 1) sCandidates.push('1');
            for (const sNum of sCandidates) {
              for (const tid of TRANSLATORS) {
                const { res } = await rezkaFetch(env, '/ajax/get_cdn_series/', {
                  method: 'POST',
                  headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-requested-with': 'XMLHttpRequest' },
                  body: new URLSearchParams({
                    id: String(rezkaId),
                    translator_id: tid,
                    season: sNum,
                    episode: String(ep || 1),
                    action: 'get_stream',
                  }).toString(),
                });
                if (res) {
                  const text = await res.text().catch(() => '');
                  let data = null;
                  try { data = JSON.parse(text); } catch {}
                  if (data?.success && data?.url) {
                    rawPayload = data.url;
                    subtitleRaw = data.subtitle;
                    resolvedTid = tid;
                    break;
                  }
                }
              }
              if (rawPayload) break;
            }
            if (rawPayload) {
              const streams = parseStreams(rawPayload);
              const validStreams = streams.filter((s) => !s.quality.toLowerCase().includes('ultra'));
              const pool = validStreams.length > 0 ? validStreams : streams;
              const chosen = pool.find((s) => s.quality.includes('1080')) || pool.find((s) => s.quality.includes('720')) || pool[0];
              if (chosen?.url) {
                const rezkaSubs = [];
                if (typeof subtitleRaw === 'string' && subtitleRaw.includes('http')) {
                  const subRegex = /\[([^\]]+)\](https?:\/\/[^\s,]+)/g;
                  let sm;
                  while ((sm = subRegex.exec(subtitleRaw)) !== null) {
                    rezkaSubs.push({
                      id: `rezka-sub-${rezkaSubs.length}`,
                      language: sm[1].toLowerCase().includes('рус') ? 'ru' : 'en',
                      label: sm[1],
                      name: sm[1],
                      url: sm[2],
                      default: rezkaSubs.length === 0,
                    });
                  }
                }
                const isRezkaDub = resolvedTid !== '238' && (audio === 'dub' || isDubAudio);
                let rezkaSuffix = 'studioband-dub';
                let rezkaStudioName = 'Studio Band';
                if (resolvedTid === '19' || srvLower.includes('anilibria')) {
                  rezkaSuffix = 'anilibria-dub';
                  rezkaStudioName = 'AniLibria';
                } else if (resolvedTid === '565' || srvLower.includes('tvshows')) {
                  rezkaSuffix = 'tvshows-dub';
                  rezkaStudioName = 'TVShows';
                } else if (!isRezkaDub || resolvedTid === '238') {
                  rezkaSuffix = '1080p';
                  rezkaStudioName = 'Original';
                }

                return ok({
                  server: {
                    id: isRezkaDub ? `hdrezka:${rezkaSuffix}` : 'hdrezka:1080p',
                    name: isRezkaDub ? `HDRezka · ${rezkaStudioName} (RU Dub)` : 'HDRezka · Original (Japanese)',
                    provider: 'hdrezka',
                    status: 'ready',
                    streamUrl: chosen.url,
                    type: 'mp4',
                    quality: chosen.quality || '1080p',
                    audio: isRezkaDub ? 'dub' : 'sub',
                    audioTracks: isRezkaDub
                      ? [{ id: 'audio-ru', language: 'ru', label: `${rezkaStudioName} Dub`, default: true }]
                      : [{ id: 'audio-ja', language: 'ja', label: 'Japanese (Original)', default: true }],
                    subtitles: rezkaSubs,
                  }
                }, { cache: 'no-store, no-cache, must-revalidate' });
              }
            }
          }
          // Fall through to stream bridge resolution if edge direct rezkaFetch did not resolve
        }

        if (provider === 'hindiflix' || (audio === 'hindi' && provider === 'auto')) {
          try {
            const hfRes = await resolveHindiFlixStream(resolvedTitle || animeId, ep || 1);
            if (hfRes?.streamUrl) {
              return ok({
                server: {
                  id: 'hindiflix:hindi-dub',
                  name: 'HindiFlix · Hindi Dub (Direct MP4)',
                  provider: 'hindiflix',
                  status: 'ready',
                  streamUrl: hfRes.streamUrl,
                  type: 'mp4',
                  quality: hfRes.quality || '1080p',
                  audio: 'dub',
                  audioTracks: [{ id: 'audio-hi', language: 'hi', label: 'Hindi Dub', default: true }],
                  subtitles: [],
                }
              }, { cache: 'public, max-age=300, s-maxage=600' });
            }
          } catch {}
          if (provider === 'hindiflix') {
            return ok({
              server: {
                id: 'hindiflix:hindi-dub',
                provider: 'hindiflix',
                name: 'HindiFlix · Hindi Dub',
                status: 'unavailable',
                unavailableReason: 'Hindi dub not found on HindiFlix for this title or episode.',
                streamUrl: null,
                audio: 'dub',
                audioTracks: [],
                subtitles: [],
                quality: '1080p',
              }
            });
          }
        }

        // Megaplay powers AniKoto, MegaPlay, and HD-1 / Vidstream servers directly
        const canUseEdgeDirect =
          provider === 'auto' ||
          provider === 'anikoto' ||
          provider === 'hianime' ||
          provider === 'aniwatch' ||
          serverParam.toLowerCase().includes('mega') ||
          serverParam.toLowerCase().includes('hd') ||
          serverParam.toLowerCase().includes('vidstream') ||
          serverParam.toLowerCase().includes('mgcld') ||
          serverParam.toLowerCase().includes('byfms') ||
          serverParam.toLowerCase().includes('dghg');

        if ((resolvedMalId > 0 || provider === 'hianime') && canUseEdgeDirect) {
          try {
            const defaultSrv = provider === 'aniwatch' ? 'MGCLD' : (provider === 'hianime' ? 'HD-3' : 'HD-1');
            const srvKey = (serverParam || defaultSrv).replace(/-dub$/i, '').toUpperCase();
            const cacheKey = `stream:${provider || 'auto'}:${srvKey}:${resolvedMalId || animeId}:${ep}:${audio}`;
            let directRes = null;
            if (env.ANIHUB) {
              try {
                const cached = await env.ANIHUB.prepare(
                  'SELECT data FROM stream_cache WHERE key = ?1 AND expires_at > ?2'
                ).bind(cacheKey, Date.now()).first();
                if (cached?.data) {
                  const parsed = JSON.parse(cached.data);
                  if (parsed?.streamUrl && !parsed.streamUrl.includes('s-90.megavid.se') && !parsed.streamUrl.includes('playmogo.com') && isMegaplayTokenValid(parsed.streamUrl)) {
                    directRes = parsed;
                  }
                }
              } catch {}
            }
            if (!directRes) {
              if (provider === 'hianime') {
                const srvTarget = (serverParam || 'HD-3').replace(/-dub$/i, '').replace(/\[.*?\]/g, '').trim().toUpperCase();
                if (srvTarget === 'HD-3' && resolvedMalId > 0) {
                  const zokoDirectUrl = `https://zokoanime.video/stream/mal/${resolvedMalId}/${ep}/${audio}?color=ffbade`;
                  const zokoRes = await resolveZokoEmbedEdge(zokoDirectUrl, { signal: AbortSignal.timeout(3500) }).catch(() => null);
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
                  const numericHiAnimeId = (providerSlug && /-([0-9]+)$/.test(providerSlug))
                    ? /-([0-9]+)$/.exec(providerSlug)[1]
                    : '';
                  const v2Res = await resolveHiAnimeV2Direct({
                    slug: providerSlug || animeIdParam || animeId || titleParam,
                    animeId: numericHiAnimeId,
                    ep,
                    audio,
                    server: srvTarget,
                    malId: resolvedMalId,
                  });
                  if (v2Res?.streamUrl) {
                    directRes = {
                      streamUrl: v2Res.streamUrl,
                      referer: v2Res.referer || (srvTarget === 'HD-3' ? 'https://zokoanime.video/' : (srvTarget === 'HD-2' ? 'https://megavid.buzz/' : 'https://megaplay.buzz/')),
                      quality: v2Res.quality || '1080p',
                      subtitles: v2Res.subtitles || [],
                      provider: 'hianime',
                      skip: v2Res.skip,
                    };
                  }
                }
              }
              if (provider === 'aniwatch') {
                directRes = await resolveAniWatchDirect({
                  slug: providerSlug || animeIdParam || animeId || titleParam,
                  title: resolvedTitle || titleParam,
                  ep,
                  audio,
                  server: serverParam || 'MGCLD',
                });
              } else if (!directRes && resolvedMalId > 0) {
                if (provider === 'hianime') {
                  const zokoDirectUrl = `https://zokoanime.video/stream/mal/${resolvedMalId}/${ep}/${audio}?color=ffbade`;
                  const zokoRes = await resolveZokoEmbedEdge(zokoDirectUrl, { signal: AbortSignal.timeout(3500) }).catch(() => null);
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
                } else {
                  directRes = await resolveMegaplayDirect({ malId: resolvedMalId, ep, audio, server: serverParam, provider });
                }
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
              const subserverName = directRes?.serverName || rawServerParam || serverParam || 'MGCLD';
              const nativeExtract = /^(MGCLD|BYFMS|DGHG)$/i.test(String(subserverName)) && (() => {
                try {
                  return /(^|\.)mfw09\.org$/.test(new URL(directRes.streamUrl).hostname);
                } catch {
                  return false;
                }
              })();
              const isEmbedDirect = nativeExtract || directRes.type === 'embed' || directRes.kind === 'embed';
              const activeReferer = directRes.referer || (provider === 'hianime' ? 'https://zokoanime.video/' : 'https://megaplay.buzz/');
              const proxiedStreamUrl = isEmbedDirect
                ? directRes.streamUrl
                : `${proxyBase}?url=${encodeURIComponent(directRes.streamUrl)}&referer=${encodeURIComponent(activeReferer)}`;

              const subtitles = (directRes.subtitles || []).map((sub) => ({
                ...sub,
                language: sub.language || sub.lang || 'en',
                label: sub.label || sub.name || 'English',
                name: sub.name || sub.label || 'English',
                url: sub.url ? `${proxyBase}?url=${encodeURIComponent(sub.url)}&referer=${encodeURIComponent(activeReferer)}` : '',
              }));

              const effectiveProvider = directRes?.provider || (provider && provider !== 'auto' ? provider : 'fallback');
              const defaultTarget = effectiveProvider === 'aniwatch' ? 'MGCLD' : (effectiveProvider === 'hianime' ? 'HD-3' : 'HD-1');
              const cleanServerId = (rawServerParam || defaultTarget).replace(/-dub$/i, '').replace(/\[.*?\]/g, '').trim();
              const serverIdWithAudio = audio === 'dub' ? `${cleanServerId}-dub` : cleanServerId;
              const serverNameWithAudio = `${cleanServerId}${audio === 'dub' ? ' (DUB)' : ''}`;
              const resolvedServer = {
                id: `${effectiveProvider}:${serverIdWithAudio}`,
                name: formatServerName(effectiveProvider, serverNameWithAudio),
                provider: effectiveProvider,
                status: 'ready',
                streamUrl: proxiedStreamUrl,
                type: nativeExtract ? 'native-extract' : (isEmbedDirect ? 'embed' : (audio === 'dub' ? 'dub' : 'hls')),
                kind: nativeExtract ? 'hls' : (isEmbedDirect ? 'embed' : 'hls'),
                quality: directRes.quality || '1080p',
                audio: audio === 'dub' ? 'dub' : 'sub',
                hardcodedSubs: Boolean(directRes.hardcodedSubs),
                audioTracks: (Array.isArray(directRes?.audioTracks) && directRes.audioTracks.length > 0)
                  ? directRes.audioTracks
                  : (Array.isArray(directRes?.audio) && directRes.audio.length > 0)
                    ? directRes.audio
                    : buildAudioTracks(audio),
                subtitles,
                thumbnails: directRes.thumbnails?.url ? {
                  url: `${proxyBase}?url=${encodeURIComponent(directRes.thumbnails.url)}&referer=${encodeURIComponent(activeReferer)}`
                } : null,
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

        if (provider === 'aniwatch') {
          throw new HttpError(404, 'not_found', 'AniWatch mirrors currently unavailable for this episode');
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
                      thumbnails: directRes.thumbnails?.url ? {
                        url: `${proxyBase}?url=${encodeURIComponent(directRes.thumbnails.url)}&referer=https://megaplay.buzz/`
                      } : null,
                      downloads: [],
                      intro: directRes.intro || null,
                      outro: directRes.outro || null,
                    };

                    return ok({ server: resolvedServer }, { cache: 'no-store, no-cache, must-revalidate' });
                  }
                }
            } catch {
              // ignore fallback error
            }

          const isOngoing = meta?.status === 'Ongoing' || meta?.sched_day != null;
          if (isOngoing) {
            throw new HttpError(404, 'episode_not_yet_available', 'Episode not yet available on streaming servers. It may still be processing or awaiting upload after broadcast.');
          }
          throw new HttpError(504, 'upstream_timeout', 'Stream bridge resolution timed out or unavailable');
        }

        if (!bridgeRes || (!bridgeRes.master && !bridgeRes.streamUrl)) {
          const isOngoing = meta?.status === 'Ongoing' || meta?.sched_day != null;
          if (isOngoing) {
            throw new HttpError(404, 'episode_not_yet_available', 'Episode not yet available on streaming servers. It may still be processing or awaiting upload after broadcast.');
          }
          throw new HttpError(502, 'provider_error', 'No playable stream returned by provider');
        }

        const metaData = bridgeRes;
        const prov = metaData.provider || provider;
        const proxyBase = `${url.origin}/api/proxy`;
        const masterPath = metaData.master || metaData.streamUrl || '';
        const isDirectVoidboost = prov === 'hdrezka' || masterPath.includes('voidboost');
        const activeReferer = isDirectVoidboost ? '' : (metaData.referer || (prov === 'hianime' ? (masterPath.includes('zoko') ? 'https://zokoanime.video/' : 'https://megaplay.buzz/') : (prov === 'aniwatch' ? 'https://aniwatch.one/' : (prov === 'anikoto' ? 'https://megaplay.buzz/' : ''))));
        let streamUrl;
        if (isDirectVoidboost && masterPath.startsWith('http')) {
          streamUrl = masterPath;
        } else if (masterPath.includes('/api/proxy')) {
          streamUrl = masterPath.startsWith('http') ? masterPath : `${url.origin}${masterPath}`;
        } else if (masterPath.startsWith('http')) {
          streamUrl = activeReferer
            ? `${proxyBase}?url=${encodeURIComponent(masterPath)}&referer=${encodeURIComponent(activeReferer)}`
            : `${proxyBase}?url=${encodeURIComponent(masterPath)}`;
        } else {
          streamUrl = `${bridgeBase}${masterPath}`;
        }

        const isAllowedEmbed = (prov === 'aniwatch') && (masterPath.includes('mfw09.org') || masterPath.includes('playmogo.com'));
        if (!isAllowedEmbed && (metaData.kind === 'embed' || metaData.type === 'embed' || streamUrl.includes('morencius') || (!streamUrl.includes('.m3u8') && !streamUrl.includes('.mp4') && streamUrl.includes('/embed')))) {
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
        const srvParamLower = String(rawServerParam || serverParam || '').toLowerCase();
        const isRezkaDub = prov === 'hdrezka' && (audio === 'dub' || srvParamLower.includes('dub') || resolvedAudio === 'russian');
        let rezkaSuffix = 'studioband-dub';
        let rezkaStudioName = 'Studio Band';
        if (srvParamLower.includes('anilibria') || metaData.audioTracks?.[0]?.label?.includes('AniLibria')) {
          rezkaSuffix = 'anilibria-dub';
          rezkaStudioName = 'AniLibria';
        } else if (srvParamLower.includes('tvshows') || metaData.audioTracks?.[0]?.label?.includes('TVShows')) {
          rezkaSuffix = 'tvshows-dub';
          rezkaStudioName = 'TVShows';
        } else if (!isRezkaDub) {
          rezkaSuffix = '1080p';
          rezkaStudioName = 'Original';
        }

        const isDub = audio === 'dub' || resolvedAudio === 'dub';
        const defaultSrv = prov === 'hianime' ? 'HD-3' : 'HD-1';
        const cleanServerId = prov === 'hdrezka'
          ? rezkaSuffix
          : `${(rawServerParam || defaultSrv).replace(/-dub$/i, '').replace(/\[.*?\]/g, '').trim()}${isDub ? '-dub' : ''}`;
        let serverName = prov === 'hdrezka'
          ? (isRezkaDub ? `HDRezka · ${rezkaStudioName} (RU Dub)` : 'HDRezka · Original (Japanese)')
          : formatServerName(prov, `${(serverParam || defaultSrv).replace(/-dub$/i, '').replace(/\[.*?\]/g, '').trim()}${isDub ? ' (DUB)' : ''}`);
        if (audio === 'dub' && resolvedAudio === 'sub') {
          serverName += ' (Sub Only)';
        }

        const resolvedAudioTracks = prov === 'hdrezka'
          ? (isRezkaDub
            ? [{ id: 'audio-ru', language: 'ru', label: `${rezkaStudioName} Dub`, default: true }]
            : [{ id: 'audio-ja', language: 'ja', label: 'Japanese (Original)', default: true }])
          : (rawAudioMeta
            ? rawAudioMeta.map((t, i) => ({
                id: t.id !== undefined ? String(t.id) : (t.language || t.lang || `audio-${i}`),
                language: t.language || t.lang || 'ja',
                label: t.label || t.name || t.language || 'Audio',
                default: t.default !== undefined ? Boolean(t.default) : i === 0,
              }))
            : buildAudioTracks(resolvedAudio));

        const resolvedServer = {
          id: `${prov}:${cleanServerId}`,
          name: serverName,
          provider: prov,
          status: 'ready',
          streamUrl,
          referrerPolicy: isDirectVoidboost ? 'no-referrer' : undefined,
          type: metaData.type || (isDub || isRezkaDub ? 'dub' : (metaData.kind === 'progressive' || isDirectVoidboost ? 'mp4' : 'hls')),
          quality: metaData.quality || '1080p',
          audio: prov === 'hdrezka' ? (isRezkaDub ? 'dub' : 'sub') : (isDub ? 'dub' : 'sub'),
          audioTracks: resolvedAudioTracks,
          subtitles,
          downloads,
          intro: metaData.skip?.intro ? { start: metaData.skip.intro[0], end: metaData.skip.intro[1] } : undefined,
          outro: metaData.skip?.outro ? { start: metaData.skip.outro[0], end: metaData.skip.outro[1] } : undefined,
        };

        return ok({ server: resolvedServer }, { cache: 'no-store' });
      } catch (err) {
        return errorResponse(err);
      }
};
