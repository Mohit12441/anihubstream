// @ts-check
import { HttpError, cleanDisplayTitle, deriveSlugCandidates, errorResponse, findAnimeByCandidates, json, ok } from './_lib.js';
import { resolveMegaplayDirect, isMegaplayTokenValid } from './_megaplay.js';
import { resolveZokoEmbedEdge } from './hianime/_zoko.js';

const BRIDGE_TIMEOUT_MS = 25_000;
const ANISKIP_TIMEOUT_MS = 1_200;
const ANISKIP_BASE = 'https://api.aniskip.com/v2';

function formatLanguageLabel(code) {
  if (!code) return 'English';
  const c = code.toLowerCase();
  if (c === 'ja' || c === 'jpn') return 'Japanese';
  if (c === 'en' || c === 'eng') return 'English';
  if (c === 'hi' || c === 'hin') return 'Hindi';
  if (c === 'es' || c === 'spa') return 'Spanish';
  if (c === 'fr' || c === 'fra') return 'French';
  if (c === 'de' || c === 'deu') return 'German';
  if (c === 'it' || c === 'ita') return 'Italian';
  if (c === 'pt' || c === 'por') return 'Portuguese';
  if (c === 'ru' || c === 'rus') return 'Russian';
  if (c === 'ar' || c === 'ara') return 'Arabic';
  return code.toUpperCase();
}

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
  if (!serverId) return base;
  const cleanServer = String(serverId).replace(/^.*?\s*·\s*/, '').trim();
  return `${base} · ${cleanServer}`;
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

async function fetchAniSkip(db, malId, ep, duration) {
  if (!malId || malId <= 0) return null;
  try {
    let targetMalId = malId;
    let targetEp = ep;

    // Check relation rules in D1 cache first
    const ruleCacheKey = `aniskip:rules:${malId}`;
    let rules = null;
    if (db) {
      try {
        const cached = await db.prepare(
          'SELECT data FROM stream_cache WHERE key = ?1 AND expires_at > ?2'
        ).bind(ruleCacheKey, Date.now()).first();
        if (cached?.data) rules = JSON.parse(cached.data);
      } catch {}
    }

    if (!rules) {
      try {
        const ruleRes = await fetch(`${ANISKIP_BASE}/relation-rules/${encodeURIComponent(malId)}`, {
          headers: { accept: 'application/json' },
          signal: AbortSignal.timeout(800),
        });
        if (ruleRes.ok) {
          const ruleData = await ruleRes.json().catch(() => null);
          rules = (ruleData?.found && Array.isArray(ruleData.rules)) ? ruleData.rules : [];
        } else {
          rules = [];
        }
        if (db) {
          const ruleTtl = Date.now() + 30 * 24 * 3600 * 1000;
          db.prepare(
            'INSERT OR REPLACE INTO stream_cache (key, data, expires_at) VALUES (?1, ?2, ?3)'
          ).bind(ruleCacheKey, JSON.stringify(rules), ruleTtl).run().catch(() => {});
        }
      } catch {
        // Continue with targetMalId
      }
    }

    if (Array.isArray(rules)) {
      for (const rule of rules) {
        const fromStart = Number(rule.from?.start ?? 1);
        const fromEnd = rule.from?.end !== undefined ? Number(rule.from.end) : Number.POSITIVE_INFINITY;
        if (ep >= fromStart && ep <= fromEnd) {
          const toMalId = Number(rule.to?.malId);
          const toStart = Number(rule.to?.start ?? 1);
          if (Number.isInteger(toMalId) && toMalId > 0) {
            targetMalId = toMalId;
            targetEp = toStart + (ep - fromStart);
            break;
          }
        }
      }
    }

    const queryUrl = new URL(`${ANISKIP_BASE}/skip-times/${encodeURIComponent(targetMalId)}/${encodeURIComponent(targetEp)}`);
    queryUrl.searchParams.append('types[]', 'op');
    queryUrl.searchParams.append('types[]', 'ed');
    queryUrl.searchParams.append('types[]', 'mixed-op');
    queryUrl.searchParams.append('types[]', 'mixed-ed');
    queryUrl.searchParams.append('types[]', 'recap');
    queryUrl.searchParams.set('episodeLength', String(duration > 0 ? duration : 0));

    const res = await fetch(queryUrl.toString(), {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(ANISKIP_TIMEOUT_MS),
    });

    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    if (!data?.found || !Array.isArray(data.results)) return null;

    let op = null;
    let ed = null;
    let recap = null;

    for (const r of data.results) {
      const type = r.skipType;
      const interval = r.interval;
      if (!interval || typeof interval.startTime !== 'number' || typeof interval.endTime !== 'number') continue;
      const formatted = {
        start: interval.startTime,
        end: interval.endTime,
        label: type === 'recap' ? 'Recap' : type.includes('op') ? 'Opening' : 'Ending',
      };
      if (type === 'op' || type === 'mixed-op') op ??= formatted;
      else if (type === 'ed' || type === 'mixed-ed') ed ??= formatted;
      else if (type === 'recap') recap ??= formatted;
    }

    return { op, ed, recap };
  } catch {
    return null;
  }
}

async function resolveSkipTimes(db, malId, ep, duration, rawEpisodeMarkers, animeId = '') {
  // 1. Check local D1 episode markers (0ms)
  if (rawEpisodeMarkers) {
    try {
      const markers = typeof rawEpisodeMarkers === 'string' ? JSON.parse(rawEpisodeMarkers) : rawEpisodeMarkers;
      if (Array.isArray(markers) && markers.length > 0) {
        let op = null;
        let ed = null;
        let recap = null;
        for (const m of markers) {
          const formatted = {
            start: m.start,
            end: m.end,
            label: m.label || (m.kind === 'outro' ? 'Ending' : m.kind === 'recap' ? 'Recap' : 'Opening'),
          };
          if (m.kind === 'intro') op ??= formatted;
          else if (m.kind === 'outro') ed ??= formatted;
          else if (m.kind === 'recap') recap ??= formatted;
        }
        if (op || ed || recap) {
          return { op, ed, recap };
        }
      }
    } catch {
      // parse failed, continue
    }
  }

  if (!malId || malId <= 0) return null;

  // 2. Check stream_cache in D1 (1ms)
  const cacheKey = `aniskip:${malId}:${ep}`;
  if (db) {
    try {
      const cached = await db.prepare(
        'SELECT data FROM stream_cache WHERE key = ?1 AND expires_at > ?2'
      ).bind(cacheKey, Date.now()).first();
      if (cached?.data) {
        const parsed = JSON.parse(cached.data);
        return parsed.empty ? null : parsed;
      }
    } catch {
      // stream_cache may not exist or query error
    }
  }

  // 3. Fallback to AniSkip API with short 1200ms timeout
  const skip = await fetchAniSkip(db, malId, ep, duration);

  // 4. Cache result for 30 days in D1 asynchronously (7 days for empty)
  if (db) {
    const expiresAt = Date.now() + (skip ? 30 : 7) * 24 * 3600 * 1000;
    const toStore = skip || { empty: true };
    db.prepare(
      'INSERT OR REPLACE INTO stream_cache (key, data, expires_at) VALUES (?1, ?2, ?3)'
    ).bind(cacheKey, JSON.stringify(toStore), expiresAt).run().catch(() => {});
  }

  return skip;
}

/**
 * Universal Layer 1 Play Endpoint:
 * Resolves unified player payload containing multi-server candidate list,
 * direct streams, external subtitles, audio tracks, downloads, and AniSkip intervals.
 *
 * GET /api/play?id=<animeId>&ep=<ep>&audio=<sub|dub|hindi>&provider=<name>&server=<name>
 */
export const onRequestGet = async ({ request, env }) => {
  try {
    const url = new URL(request.url);
    let id = url.searchParams.get('id') || url.searchParams.get('animeId') || '';
    const titleParam = url.searchParams.get('title') || '';
    const malIdParam = url.searchParams.get('malId') || '';
    const ep = Math.max(1, Number.parseInt(url.searchParams.get('ep') ?? '1', 10) || 1);
    const audio = url.searchParams.get('audio') === 'hindi' ? 'hindi' : url.searchParams.get('audio') === 'dub' ? 'dub' : 'sub';
    const provider = url.searchParams.get('provider') || 'anikoto';
    let serverParam = url.searchParams.get('server') || '';
    if (serverParam.toLowerCase() === 'mega') serverParam = 'MegaPlay';

    let resolvedTitle = titleParam;
    let resolvedMalId = malIdParam ? Number.parseInt(malIdParam, 10) : 0;
    let durationSeconds = 1440;
    let rawEpisodeMarkers = null;
    let animeRow = null;

    // Look up anime metadata and ID mappings in D1
    if (env.ANIHUB) {
      if (id) {
        try {
          const r = await env.ANIHUB.prepare('SELECT to_id FROM anime_redirect WHERE from_id = ?1').bind(id).first();
          if (r?.to_id) {
            id = r.to_id;
          } else {
            const playCandidates = deriveSlugCandidates(id);
            const foundCard = await findAnimeByCandidates(env.ANIHUB, playCandidates);
            let m = foundCard ? { anime_id: foundCard.id } : null;

            if (m?.anime_id) {
              id = m.anime_id;
            } else {
              const p = await env.ANIHUB.prepare(
                `SELECT id FROM anime WHERE json_extract(source_ids, '$.hianime') = ?1 OR json_extract(source_ids, '$.anikoto') = ?1 LIMIT 1`
              ).bind(id).first().catch(() => null);
              if (p?.id) id = p.id;
            }
          }
        } catch {
          // anime_redirect table may not exist yet or no redirect
        }

        animeRow = null;
        try {
          animeRow = await env.ANIHUB.prepare(
            `SELECT a.id, a.title, a.source_ids, a.skip_key_id, a.skip_key_space,
                    e.runtime_seconds, e.markers,
                    m.mal_id, m.kitsu_id, m.anilist_id,
                    m.anikoto_slug, m.hianime_slug
             FROM anime a
             LEFT JOIN episode e ON (e.anime_id = a.id AND e.n = ?2)
             LEFT JOIN anime_id_map m ON m.anime_id = a.id
             WHERE a.id = ?1`
          ).bind(id, ep).first();
        } catch {
          // If anime_id_map table does not exist in production D1 yet, query anime directly
          animeRow = await env.ANIHUB.prepare(
            `SELECT a.id, a.title, a.source_ids, a.skip_key_id, a.skip_key_space,
                    e.runtime_seconds, e.markers
             FROM anime a
             LEFT JOIN episode e ON (e.anime_id = a.id AND e.n = ?2)
             WHERE a.id = ?1`
          ).bind(id, ep).first().catch(() => null);
        }

        if (animeRow) {
          if (!resolvedTitle) resolvedTitle = animeRow.title;
          if (animeRow.runtime_seconds) durationSeconds = animeRow.runtime_seconds;
          if (animeRow.markers) rawEpisodeMarkers = animeRow.markers;

          if (!resolvedMalId) {
            if (animeRow.mal_id) {
              resolvedMalId = animeRow.mal_id;
            } else if (animeRow.skip_key_space === 'mal' && animeRow.skip_key_id) {
              resolvedMalId = animeRow.skip_key_id;
            } else if (animeRow.source_ids) {
              try {
                const s = JSON.parse(animeRow.source_ids);
                if (s.mal) resolvedMalId = Number(s.mal);
              } catch {
                // ignore
              }
            }
          }
        }
      }
    }

    if (!resolvedTitle && id) {
      resolvedTitle = id
        .replace(/^(?:hianime|anikoto|aniwatch|watchanimeworld|animewave|animekai):/i, '')
        .replace(/-[a-z0-9]{5,8}$/i, '')
        .replace(/[-_:]+/g, ' ')
        .trim()
        .replace(/\b\w/g, (c) => c.toUpperCase());
    }

    if (resolvedTitle) {
      resolvedTitle = cleanDisplayTitle(resolvedTitle);
    }

    if (!resolvedTitle) {
      throw new HttpError(400, 'bad_request', 'Could not determine anime title from id or title query parameter');
    }

    // Determine Stream Bridge base (only queried if explicitly configured)
    const bridgeBase = env.STREAM_BRIDGE_URL || '';

    const canUseEdgeDirect =
      provider === 'auto' ||
      provider === 'anikoto' ||
      provider === 'hianime' ||
      provider === 'aniwatch' ||
      serverParam.toLowerCase().includes('mega') ||
      serverParam.toLowerCase().includes('hd') ||
      serverParam.toLowerCase().includes('vidstream');

    // Parallel fetch: AniSkip timestamps (D1 markers/cache/API), Direct Edge Resolution, and Bridge Stream Resolution
    const [aniskipData, directRes, bridgeRes] = await Promise.all([
      resolveSkipTimes(env.ANIHUB, resolvedMalId, ep, durationSeconds, rawEpisodeMarkers, id),
      (async () => {
        if (!resolvedMalId || !canUseEdgeDirect) return null;
        const cacheKey = `stream:${provider === 'hianime' ? 'hianime' : 'anikoto'}:${resolvedMalId}:${ep}:${audio}`;
        if (env.ANIHUB) {
          try {
            const cached = await env.ANIHUB.prepare(
              'SELECT data FROM stream_cache WHERE key = ?1 AND expires_at > ?2'
            ).bind(cacheKey, Date.now()).first();
            if (cached?.data) {
              const parsed = JSON.parse(cached.data);
              if (parsed?.streamUrl && isMegaplayTokenValid(parsed.streamUrl)) {
                return parsed;
              }
            }
          } catch {}
        }
        try {
          let direct = null;
          if (provider === 'hianime') {
            const zokoDirectUrl = `https://zokoanime.video/stream/mal/${resolvedMalId}/${ep}/${audio}`;
            const zokoRes = await resolveZokoEmbedEdge(zokoDirectUrl, { signal: AbortSignal.timeout(3500) });
            if (zokoRes?.masterUrl) {
              direct = {
                streamUrl: zokoRes.masterUrl,
                referer: 'https://zokoanime.video/',
                quality: zokoRes.defaultQuality || '1080p',
                subtitles: [],
                provider: 'hianime',
                skip: zokoRes.skip,
              };
            }
          }
          if (!direct) {
            direct = await resolveMegaplayDirect({ malId: resolvedMalId, ep, audio });
          }
          if (env.ANIHUB && direct?.streamUrl) {
            const ttl = Date.now() + 20 * 60 * 1000;
            env.ANIHUB.prepare(
              'INSERT OR REPLACE INTO stream_cache (key, data, expires_at) VALUES (?1, ?2, ?3)'
            ).bind(cacheKey, JSON.stringify(direct), ttl).run().catch(() => {});
          }
          return direct;
        } catch {
          return null;
        }
      })(),
      (async () => {
        if (!bridgeBase) return null;
        try {
          const resolveBridgeUrl = new URL(`${bridgeBase}/resolve`);
          resolveBridgeUrl.searchParams.set('title', resolvedTitle);
          resolveBridgeUrl.searchParams.set('ep', String(ep));
          resolveBridgeUrl.searchParams.set('audio', audio);
          if (provider) resolveBridgeUrl.searchParams.set('provider', provider);
          if (serverParam) resolveBridgeUrl.searchParams.set('server', serverParam);
          if (resolvedMalId) resolveBridgeUrl.searchParams.set('mal', String(resolvedMalId));

          const res = await fetch(resolveBridgeUrl.toString(), {
            headers: { accept: 'application/json' },
            signal: AbortSignal.timeout(1200),
          });
          if (!res.ok) return null;
          return await res.json().catch(() => null);
        } catch {
          return null;
        }
      })(),
    ]);

    const resolveUrl = (extra) => {
      const p = new URLSearchParams({ title: resolvedTitle, ep: String(ep), ...extra });
      if (resolvedMalId) p.set('mal', String(resolvedMalId));
      return `/api/play/resolve?${p}`;
    };

    const requested = (url.searchParams.get('provider') || 'anikoto').toLowerCase();
    const isScoped = true;

    const defaultServers = [
      {
        id: 'anikoto:HD-1',
        name: 'AniKoto · HD-1',
        provider: 'anikoto',
        status: 'ready',
        streamUrl: resolveUrl({ audio: 'sub', provider: 'anikoto', server: 'HD-1' }),
        type: 'hls',
        quality: '1080',
        audio: 'sub',
        audioTracks: [{ id: 'audio-0', language: 'ja', label: 'Japanese (Original)', default: true }],
        subtitles: [],
        downloads: [],
      },
      {
        id: 'anikoto:Vidstream-1',
        name: 'AniKoto · Vidstream-1',
        provider: 'anikoto',
        status: 'ready',
        streamUrl: resolveUrl({ audio: 'sub', provider: 'anikoto', server: 'Vidstream-1' }),
        type: 'hls',
        quality: '1080',
        audio: 'sub',
        audioTracks: [{ id: 'audio-0', language: 'ja', label: 'Japanese (Original)', default: true }],
        subtitles: [],
        downloads: [],
      },
      {
        id: 'anikoto:Vidstream-2',
        name: 'AniKoto · Vidstream-2',
        provider: 'anikoto',
        status: 'ready',
        streamUrl: resolveUrl({ audio: 'sub', provider: 'anikoto', server: 'Vidstream-2' }),
        type: 'hls',
        quality: '1080',
        audio: 'sub',
        audioTracks: [{ id: 'audio-0', language: 'ja', label: 'Japanese (Original)', default: true }],
        subtitles: [],
        downloads: [],
      },
      {
        id: 'anikoto:HD-2',
        name: 'AniKoto · HD-2',
        provider: 'anikoto',
        status: 'ready',
        streamUrl: resolveUrl({ audio: 'dub', provider: 'anikoto', server: 'HD-2' }),
        type: 'dub',
        quality: '1080p',
        audio: 'dub',
        audioTracks: [{ id: 'audio-1', language: 'en', label: 'English Dub', default: true }],
        subtitles: [],
        downloads: [],
      },
      {
        id: 'hianime:HD',
        name: 'HiAnime · HD',
        provider: 'hianime',
        status: 'ready',
        streamUrl: resolveUrl({ audio: 'sub', provider: 'hianime', server: 'HD' }),
        type: 'hls',
        quality: '1080p',
        audio: 'sub',
        audioTracks: [{ id: 'audio-0', language: 'ja', label: 'Japanese (Original)', default: true }],
        subtitles: [],
        downloads: [],
      },
      {
        id: 'hianime:HD-1',
        name: 'HiAnime · HD-1',
        provider: 'hianime',
        status: 'ready',
        streamUrl: resolveUrl({ audio: 'sub', provider: 'hianime', server: 'HD-1' }),
        type: 'hls',
        quality: '1080p',
        audio: 'sub',
        audioTracks: [{ id: 'audio-0', language: 'ja', label: 'Japanese (Original)', default: true }],
        subtitles: [],
        downloads: [],
      },
      {
        id: 'hianime:HD-2',
        name: 'HiAnime · HD-2',
        provider: 'hianime',
        status: 'ready',
        streamUrl: resolveUrl({ audio: 'sub', provider: 'hianime', server: 'HD-2' }),
        type: 'hls',
        quality: '1080p',
        audio: 'sub',
        audioTracks: [{ id: 'audio-0', language: 'ja', label: 'Japanese (Original)', default: true }],
        subtitles: [],
        downloads: [],
      },
      {
        id: 'hianime:mega',
        name: 'HiAnime · mega',
        provider: 'hianime',
        status: 'ready',
        streamUrl: resolveUrl({ audio: 'sub', provider: 'hianime', server: 'mega' }),
        type: 'hls',
        quality: '1080p',
        audio: 'sub',
        audioTracks: [{ id: 'audio-0', language: 'ja', label: 'Japanese (Original)', default: true }],
        subtitles: [],
        downloads: [],
      },
      {
        id: 'hianime:Fast',
        name: 'HiAnime · Fast',
        provider: 'hianime',
        status: 'ready',
        streamUrl: resolveUrl({ audio: 'sub', provider: 'hianime', server: 'Fast' }),
        type: 'mp4',
        quality: '720p',
        audio: 'sub',
        audioTracks: [{ id: 'audio-0', language: 'ja', label: 'Japanese (Original)', default: true }],
        subtitles: [],
        downloads: [],
      },
      {
        id: 'hianime:HD-dub',
        name: 'HiAnime · HD',
        provider: 'hianime',
        status: 'ready',
        streamUrl: resolveUrl({ audio: 'dub', provider: 'hianime', server: 'HD' }),
        type: 'dub',
        quality: '1080p',
        audio: 'dub',
        audioTracks: [{ id: 'audio-1', language: 'en', label: 'English Dub', default: true }],
        subtitles: [],
        downloads: [],
      },
      {
        id: 'hianime:HD-1-dub',
        name: 'HiAnime · HD-1',
        provider: 'hianime',
        status: 'ready',
        streamUrl: resolveUrl({ audio: 'dub', provider: 'hianime', server: 'HD-1' }),
        type: 'dub',
        quality: '1080p',
        audio: 'dub',
        audioTracks: [{ id: 'audio-1', language: 'en', label: 'English Dub', default: true }],
        subtitles: [],
        downloads: [],
      },
      {
        id: 'hianime:HD-2-dub',
        name: 'HiAnime · HD-2',
        provider: 'hianime',
        status: 'ready',
        streamUrl: resolveUrl({ audio: 'dub', provider: 'hianime', server: 'HD-2' }),
        type: 'dub',
        quality: '1080p',
        audio: 'dub',
        audioTracks: [{ id: 'audio-1', language: 'en', label: 'English Dub', default: true }],
        subtitles: [],
        downloads: [],
      },
      {
        id: 'aniwatch:HD-1',
        name: 'AniWatch · HD-1',
        provider: 'aniwatch',
        status: 'ready',
        streamUrl: resolveUrl({ audio: 'sub', provider: 'aniwatch', server: 'HD-1' }),
        type: 'hls',
        quality: '1080p',
        audio: 'sub',
        audioTracks: [{ id: 'audio-0', language: 'ja', label: 'Japanese (Original)', default: true }],
        subtitles: [],
        downloads: [],
      },
      {
        id: 'aniwatch:HD-2',
        name: 'AniWatch · HD-2',
        provider: 'aniwatch',
        status: 'ready',
        streamUrl: resolveUrl({ audio: 'sub', provider: 'aniwatch', server: 'HD-2' }),
        type: 'hls',
        quality: '1080p',
        audio: 'sub',
        audioTracks: [{ id: 'audio-0', language: 'ja', label: 'Japanese (Original)', default: true }],
        subtitles: [],
        downloads: [],
      },
      {
        id: 'aniwatch:HD-1-dub',
        name: 'AniWatch · HD-1',
        provider: 'aniwatch',
        status: 'ready',
        streamUrl: resolveUrl({ audio: 'dub', provider: 'aniwatch', server: 'HD-1' }),
        type: 'dub',
        quality: '1080p',
        audio: 'dub',
        audioTracks: [{ id: 'audio-1', language: 'en', label: 'English Dub', default: true }],
        subtitles: [],
        downloads: [],
      },
      {
        id: 'aniwatch:HD-2-dub',
        name: 'AniWatch · HD-2',
        provider: 'aniwatch',
        status: 'ready',
        streamUrl: resolveUrl({ audio: 'dub', provider: 'aniwatch', server: 'HD-2' }),
        type: 'dub',
        quality: '1080p',
        audio: 'dub',
        audioTracks: [{ id: 'audio-1', language: 'en', label: 'English Dub', default: true }],
        subtitles: [],
        downloads: [],
      },
    ];

    // If stream bridge is cold or external to Cloudflare edge, check if Direct Edge Extractor resolved
    if (!bridgeRes || (!bridgeRes.master && !bridgeRes.streamUrl)) {
      if (directRes?.streamUrl) {
        const proxyBase = `${url.origin}/api/proxy`;
        const activeReferer = directRes.referer || 'https://megaplay.buzz/';
        const proxiedStreamUrl = `${proxyBase}?url=${encodeURIComponent(directRes.streamUrl)}&referer=${encodeURIComponent(activeReferer)}`;

        const subtitles = (directRes.subtitles || []).map((sub) => ({
          ...sub,
          url: sub.url ? `${proxyBase}?url=${encodeURIComponent(sub.url)}&referer=${encodeURIComponent(activeReferer)}` : '',
        }));

        const primaryServer = {
          id: `${directRes.provider}:${serverParam || 'HD-1'}`,
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
        };

        return ok({
          title: resolvedTitle,
          episode: ep,
          malId: resolvedMalId || null,
          scopedProvider: requested,
          scopedProviderUnavailable: false,
          servers: [primaryServer],
          aniskip: aniskipData || null,
        }, {
          cache: 'public, max-age=300, s-maxage=600',
        });
      }

      const scoped = defaultServers.filter((s) => s.provider === requested);
      const isScopedUnavailable = animeRow && !animeRow[`${requested}_slug`];

      return ok({
        title: resolvedTitle,
        episode: ep,
        malId: resolvedMalId || null,
        scopedProvider: requested,
        scopedProviderUnavailable: Boolean(isScopedUnavailable),
        servers: scoped,
        aniskip: aniskipData || null,
      }, {
        cache: 'no-store, no-cache, must-revalidate',
      });
    }

    const meta = bridgeRes;
    const session = meta.session || '';
    const prov = meta.provider || (provider !== 'auto' ? provider : 'aniwatch');
    const masterPath = meta.master || meta.streamUrl || '';
    const streamUrl = masterPath.startsWith('http') ? masterPath : `${bridgeBase}${masterPath}`;

    // Subtitles format
    const subtitles = (meta.subtitles || []).map((sub, idx) => ({
      id: `sub-${idx}`,
      language: sub.language || 'en',
      label: sub.name || formatLanguageLabel(sub.language),
      url: sub.url?.startsWith('http') ? sub.url : `${bridgeBase}${sub.url}`,
      default: idx === 0,
    }));

    // Downloads format
    const downloads = (meta.downloads || []).map((dl) => ({
      name: dl.name || dl.quality || 'Download',
      quality: dl.quality || '1080p',
      url: dl.url?.startsWith('http') ? dl.url : `${bridgeBase}${dl.url}`,
    }));

    // Construct primary server entry
    const cleanPrimaryServer = String(serverParam || 'HD-1').replace(/^.*?\s*·\s*/, '').trim();
    const activeServerId = `${prov}:${cleanPrimaryServer}`;
    const resolvedAudio = meta.audio || audio;
    let primaryServerName = formatServerName(prov, cleanPrimaryServer);
    if (audio === 'dub' && resolvedAudio === 'sub') {
      primaryServerName += ' (Sub Only)';
    }

    const primaryServer = {
      id: activeServerId,
      name: primaryServerName,
      provider: prov,
      status: 'ready',
      streamUrl,
      type: meta.kind === 'progressive' ? 'mp4' : 'hls',
      quality: meta.quality || '1080p',
      audio: resolvedAudio,
      audioTracks: buildAudioTracks(resolvedAudio),
      subtitles,
      downloads,
    };

    const servers = [primaryServer];

    // If bridge supplied other server choices, add them as alternatives
    if (Array.isArray(meta.servers)) {
      for (const s of meta.servers) {
        const rawServerId = s.id || s.name;
        const cleanServerId = String(rawServerId).replace(/^.*?\s*·\s*/, '').trim();
        const sId = `${prov}:${cleanServerId}`;
        if (sId !== activeServerId && !servers.some((existing) => existing.id === sId)) {
          servers.push({
            id: sId,
            name: formatServerName(prov, cleanServerId),
            provider: prov,
            status: 'ready',
            streamUrl: resolveUrl({ audio, provider: prov, server: cleanServerId }),
            type: s.type || 'hls',
            quality: '1080p',
            audio,
            audioTracks: buildAudioTracks(audio),
            subtitles,
            downloads: [],
          });
        }
      }
    }

    // Only add default fallback servers if no primary server was resolved
    if (servers.length === 0) {
      for (const def of defaultServers) {
        if (def.provider === requested && !servers.some((s) => s.id === def.id)) {
          servers.push(def);
        }
      }
    }

    // Merge AniSkip: Prefer AniSkip v2, fallback to provider-reported skip times (from AniKoto/HiAnime)
    let finalOp = aniskipData?.op || null;
    let finalEd = aniskipData?.ed || null;
    let finalRecap = aniskipData?.recap || null;

    if (!finalOp && meta.skip?.intro) {
      const s = meta.skip.intro;
      const start = Array.isArray(s) ? s[0] : s.start;
      const end = Array.isArray(s) ? s[1] : s.end;
      if (start !== undefined && end !== undefined && (start > 0 || end > 0)) {
        finalOp = { start, end, label: 'Opening' };
      }
    }
    if (!finalEd && meta.skip?.outro) {
      const s = meta.skip.outro;
      const start = Array.isArray(s) ? s[0] : s.start;
      const end = Array.isArray(s) ? s[1] : s.end;
      if (start !== undefined && end !== undefined && (start > 0 || end > 0)) {
        finalEd = { start, end, label: 'Ending' };
      }
    }

    const scoped = servers.filter((s) => s.provider === requested);
    const finalServers = scoped.length ? scoped : defaultServers.filter((s) => s.provider === requested);

    return ok({
      title: resolvedTitle,
      episode: ep,
      malId: resolvedMalId || null,
      scopedProvider: requested,
      servers: finalServers,
      aniskip: {
        op: finalOp,
        ed: finalEd,
        recap: finalRecap,
      },
    }, {
      cache: 'no-store, no-cache, must-revalidate',
    });
  } catch (err) {
    return errorResponse(err);
  }
};
