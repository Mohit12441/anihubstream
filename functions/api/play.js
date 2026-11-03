// @ts-check
import { HttpError, cleanDisplayTitle, deriveSlugCandidates, errorResponse, findAnimeByCandidates, json, ok, withEdgeCache } from './_lib.js';
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
            source: 'aniskip',
            confidence: 1.0,
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

  // 2. Check stream_cache in D1 (1ms)
  if (malId && malId > 0 && db) {
    const cacheKey = `aniskip:${malId}:${ep}`;
    try {
      const cached = await db.prepare(
        'SELECT data FROM stream_cache WHERE key = ?1 AND expires_at > ?2'
      ).bind(cacheKey, Date.now()).first();
      if (cached?.data) {
        const parsed = JSON.parse(cached.data);
        if (!parsed.empty) {
          return {
            op: parsed.op ? { ...parsed.op, source: 'aniskip', confidence: 1.0 } : null,
            ed: parsed.ed ? { ...parsed.ed, source: 'aniskip', confidence: 1.0 } : null,
            recap: parsed.recap ? { ...parsed.recap, source: 'aniskip', confidence: 1.0 } : null,
          };
        }
      }
    } catch {}

    // 3. Fallback to AniSkip API with short 1200ms timeout
    const skip = await fetchAniSkip(db, malId, ep, duration);
    if (skip && (skip.op || skip.ed || skip.recap)) {
      const expiresAt = Date.now() + 30 * 24 * 3600 * 1000;
      db.prepare(
        'INSERT OR REPLACE INTO stream_cache (key, data, expires_at) VALUES (?1, ?2, ?3)'
      ).bind(cacheKey, JSON.stringify(skip), expiresAt).run().catch(() => {});
      return {
        op: skip.op ? { ...skip.op, source: 'aniskip', confidence: 1.0 } : null,
        ed: skip.ed ? { ...skip.ed, source: 'aniskip', confidence: 1.0 } : null,
        recap: skip.recap ? { ...skip.recap, source: 'aniskip', confidence: 1.0 } : null,
      };
    } else {
      const expiresAt = Date.now() + 7 * 24 * 3600 * 1000;
      db.prepare(
        'INSERT OR REPLACE INTO stream_cache (key, data, expires_at) VALUES (?1, ?2, ?3)'
      ).bind(cacheKey, JSON.stringify({ empty: true }), expiresAt).run().catch(() => {});
    }
  }

  // 4. Sibling Episode Learned Template (Cour pattern heuristic)
  if (db && animeId && ep > 1) {
    try {
      const { results: siblings } = await db.prepare(
        `SELECT markers FROM episode WHERE anime_id = ?1 AND markers IS NOT NULL AND markers != '[]' LIMIT 4`
      ).bind(animeId).all().catch(() => ({ results: [] }));

      if (Array.isArray(siblings) && siblings.length > 0) {
        for (const sib of siblings) {
          try {
            const sibMarkers = typeof sib.markers === 'string' ? JSON.parse(sib.markers) : sib.markers;
            const sibIntro = sibMarkers?.find((m) => m.kind === 'intro');
            const sibOutro = sibMarkers?.find((m) => m.kind === 'outro');

            // Standard TV OP is between 75s and 105s in length
            if (sibIntro && (sibIntro.end - sibIntro.start) >= 75 && (sibIntro.end - sibIntro.start) <= 105) {
              const op = {
                start: sibIntro.start,
                end: sibIntro.end,
                label: 'Opening',
                source: 'learned_template',
                confidence: 0.85,
              };
              let ed = null;
              if (sibOutro && duration > 600) {
                ed = {
                  start: Math.min(sibOutro.start, duration - 100),
                  end: Math.min(sibOutro.end, duration - 10),
                  label: 'Ending',
                  source: 'learned_template',
                  confidence: 0.85,
                };
              }
              return { op, ed, recap: null };
            }
          } catch {}
        }
      }
    } catch {}
  }

  // 5. Structural TV Anime Estimator (Standard 90-second TV window)
  if (duration >= 1000 && duration <= 1800 && ep > 1) {
    return {
      op: {
        start: 90,
        end: 180,
        label: 'Opening',
        source: 'estimated',
        confidence: 0.65,
      },
      ed: {
        start: Math.max(duration - 120, 0),
        end: Math.max(duration - 30, 0),
        label: 'Ending',
        source: 'estimated',
        confidence: 0.65,
      },
      recap: null,
    };
  }

  return null;
}

/**
 * Universal Layer 1 Play Endpoint:
 * Resolves unified player payload containing multi-server candidate list,
 * direct streams, external subtitles, audio tracks, downloads, and AniSkip intervals.
 *
 * GET /api/play?id=<animeId>&ep=<ep>&audio=<sub|dub|hindi>&provider=<name>&server=<name>
 */
export const onRequestGet = async ({ request, env, waitUntil }) => {
  return withEdgeCache(
    request,
    env,
    300,
    async () => {
      try {
        const url = new URL(request.url);
    let id = url.searchParams.get('id') || url.searchParams.get('animeId') || '';
    const titleParam = url.searchParams.get('title') || '';
    const malIdParam = url.searchParams.get('malId') || '';
    const ep = Math.max(1, Number.parseInt(url.searchParams.get('ep') ?? '1', 10) || 1);
    const audio = url.searchParams.get('audio') === 'hindi' ? 'hindi' : url.searchParams.get('audio') === 'dub' ? 'dub' : 'sub';
    const rawProvider = url.searchParams.get('provider') || '';
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
            `SELECT a.id, a.title, a.status, a.source_ids, a.skip_key_id, a.skip_key_space,
                    e.runtime_seconds, e.markers,
                    m.mal_id, m.kitsu_id, m.anilist_id,
                    m.anikoto_slug, m.hianime_slug, m.aniwatch_slug
             FROM anime a
             LEFT JOIN episode e ON (e.anime_id = a.id AND e.n = ?2)
             LEFT JOIN anime_id_map m ON m.anime_id = a.id
             WHERE a.id = ?1`
          ).bind(id, ep).first();
        } catch {
          // If anime_id_map table does not exist in production D1 yet, query anime directly
          animeRow = await env.ANIHUB.prepare(
            `SELECT a.id, a.title, a.status, a.source_ids, a.skip_key_id, a.skip_key_space,
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

          if (animeRow.status === 'Upcoming' || animeRow.status === 'NOT_YET_RELEASED') {
            return ok({
              title: resolvedTitle,
              episode: ep,
              status: 'unreleased',
              error: 'This anime has not yet been released.',
              servers: [],
              subtitles: [],
              audioTracks: buildAudioTracks(audio),
              aniskip: null,
              downloads: [],
            });
          }

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

    let pmRows = [];
    let providerHealth = {
      anikoto: { status: 'healthy', latencyMs: 85 },
      hianime: { status: 'healthy', latencyMs: 140 },
      aniwatch: { status: 'healthy', latencyMs: 210 },
      watchanimeworld: { status: 'healthy', latencyMs: 120 },
      animewave: { status: 'healthy', latencyMs: 110 },
      animekai: { status: 'healthy', latencyMs: 130 },
      torrent: { status: 'healthy', latencyMs: 45, peers: 12 },
    };

    if (env.ANIHUB) {
      if (id) {
        try {
          const pmRes = await env.ANIHUB.prepare(
            'SELECT provider_id, provider_slug FROM anime_provider_mapping WHERE anime_id = ?1'
          ).bind(id).all();
          pmRows = pmRes?.results || [];
        } catch {}
      }

      try {
        const healthRow = await env.ANIHUB.prepare(
          "SELECT value FROM sync_meta WHERE key = 'stream_health'"
        ).first();
        if (healthRow?.value) {
          const parsedHealth = JSON.parse(healthRow.value);
          if (parsedHealth?.providerStats) {
            providerHealth = { ...providerHealth, ...parsedHealth.providerStats };
          }
        }
      } catch {}
    }

    const availableSlugs = {
      anikoto: animeRow?.anikoto_slug || pmRows.find((p) => p.provider_id === 'anikoto')?.provider_slug || null,
      hianime: animeRow?.hianime_slug || pmRows.find((p) => p.provider_id === 'hianime')?.provider_slug || null,
      aniwatch: animeRow?.aniwatch_slug || pmRows.find((p) => p.provider_id === 'aniwatch')?.provider_slug || null,
      watchanimeworld: animeRow?.waw_slug || animeRow?.watchanimeworld_slug || pmRows.find((p) => p.provider_id === 'watchanimeworld')?.provider_slug || null,
      animewave: animeRow?.animewave_slug || pmRows.find((p) => p.provider_id === 'animewave')?.provider_slug || null,
      animekai: animeRow?.animekai_slug || pmRows.find((p) => p.provider_id === 'animekai')?.provider_slug || null,
    };

    const rawRequested = (url.searchParams.get('provider') || '').toLowerCase().trim();
    let requested = rawRequested;

    const getAvailableProvidersList = () => [
      { id: 'anikoto', name: 'AniKoto', available: Boolean(availableSlugs.anikoto), ...(providerHealth.anikoto || {}) },
      { id: 'hianime', name: 'HiAnime', available: Boolean(availableSlugs.hianime), ...(providerHealth.hianime || {}) },
      { id: 'aniwatch', name: 'AniWatch', available: Boolean(availableSlugs.aniwatch), ...(providerHealth.aniwatch || {}) },
      { id: 'watchanimeworld', name: 'WatchAnimeWorld', available: Boolean(availableSlugs.watchanimeworld), ...(providerHealth.watchanimeworld || {}) },
      { id: 'animewave', name: 'AnimeWave', available: Boolean(availableSlugs.animewave), ...(providerHealth.animewave || {}) },
      { id: 'animekai', name: 'AnimeKai', available: Boolean(availableSlugs.animekai), ...(providerHealth.animekai || {}) },
      { id: 'torrent', name: 'P2P Swarm', available: true, ...(providerHealth.torrent || {}) },
    ];

    // Dynamic Provider Priority: If not explicitly requested or is 'auto', select the fastest healthy provider
    if (!requested || requested === 'auto') {
      const candidates = ['anikoto', 'hianime', 'aniwatch', 'watchanimeworld', 'animewave', 'animekai'].filter((p) => availableSlugs[p]);
      if (candidates.length > 0) {
        candidates.sort((a, b) => {
          const healthA = providerHealth[a]?.status === 'healthy' ? 0 : 1;
          const healthB = providerHealth[b]?.status === 'healthy' ? 0 : 1;
          if (healthA !== healthB) return healthA - healthB;
          return (providerHealth[a]?.latencyMs || 999) - (providerHealth[b]?.latencyMs || 999);
        });
        requested = candidates[0];
      } else {
        requested = 'anikoto';
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
      requested === 'anikoto' ||
      requested === 'hianime' ||
      requested === 'aniwatch' ||
      serverParam.toLowerCase().includes('mega') ||
      serverParam.toLowerCase().includes('hd') ||
      serverParam.toLowerCase().includes('vidstream');

    // Parallel fetch: AniSkip timestamps (D1 markers/cache/API), Direct Edge Resolution, and Bridge Stream Resolution
    const [aniskipData, directRes, bridgeRes] = await Promise.all([
      resolveSkipTimes(env.ANIHUB, resolvedMalId, ep, durationSeconds, rawEpisodeMarkers, id),
      (async () => {
        if (!resolvedMalId || !canUseEdgeDirect) return null;
        const cacheKey = `stream:${requested === 'hianime' ? 'hianime' : 'anikoto'}:${resolvedMalId}:${ep}:${audio}`;
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
          if (requested === 'hianime') {
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
          if (requested) resolveBridgeUrl.searchParams.set('provider', requested);
          if (serverParam) resolveBridgeUrl.searchParams.set('server', serverParam);
          if (resolvedMalId) resolveBridgeUrl.searchParams.set('mal', String(resolvedMalId));
          const provSlug = (requested && availableSlugs[requested]) || availableSlugs.anikoto || availableSlugs.hianime || availableSlugs.aniwatch || null;
          if (provSlug) resolveBridgeUrl.searchParams.set('slug', provSlug);

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

    const isScoped = true;

    const defaultServers = [
      {
        id: 'anikoto:HD-1',
        name: 'AniKoto · HD-1',
        provider: 'anikoto',
        status: 'ready',
        streamUrl: resolveUrl({ audio: 'sub', provider: 'anikoto', server: 'HD-1' }),
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
        id: 'torrent:P2P-1',
        name: 'P2P Swarm · WebTorrent',
        provider: 'torrent',
        status: 'ready',
        streamUrl: resolveUrl({ audio: 'sub', provider: 'torrent', server: 'P2P-1' }),
        type: 'torrent',
        quality: '1080p',
        audio: 'sub',
        audioTracks: [{ id: 'audio-0', language: 'ja', label: 'Japanese (Original)', default: true }],
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
          thumbnails: directRes.thumbnails?.url ? { url: `${proxyBase}?url=${encodeURIComponent(directRes.thumbnails.url)}&referer=${encodeURIComponent(activeReferer)}` } : null,
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
          providerHealth,
          availableProviders: getAvailableProvidersList(),
        }, {
          cache: 'public, max-age=300, s-maxage=600',
        });
      }

      const scoped = defaultServers.filter((s) => s.provider === requested);
      const isScopedUnavailable = !availableSlugs[requested];

      return ok({
        title: resolvedTitle,
        episode: ep,
        malId: resolvedMalId || null,
        scopedProvider: requested,
        scopedProviderUnavailable: Boolean(isScopedUnavailable),
        servers: scoped,
        aniskip: aniskipData || null,
        providerHealth,
        availableProviders: getAvailableProvidersList(),
      }, {
        cache: 'no-store, no-cache, must-revalidate',
      });
    }

    const meta = bridgeRes;
    const session = meta.session || '';
    const prov = meta.provider || (requested !== 'auto' ? requested : 'aniwatch');
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
      thumbnails: meta.thumbnails?.url ? { url: `${proxyBase}?url=${encodeURIComponent(meta.thumbnails.url)}` } : null,
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

    // Merge AniSkip: Prefer AniSkip v2 / learned template, fallback to provider-reported skip times (from AniKoto/HiAnime)
    let finalOp = aniskipData?.op || null;
    let finalEd = aniskipData?.ed || null;
    let finalRecap = aniskipData?.recap || null;

    if ((!finalOp || (finalOp.confidence && finalOp.confidence < 0.8)) && meta.skip?.intro) {
      const s = meta.skip.intro;
      const start = Array.isArray(s) ? s[0] : s.start;
      const end = Array.isArray(s) ? s[1] : s.end;
      if (start !== undefined && end !== undefined && (start > 0 || end > 0)) {
        finalOp = { start, end, label: 'Opening', source: 'provider', confidence: 0.9 };
      }
    }
    if ((!finalEd || (finalEd.confidence && finalEd.confidence < 0.8)) && meta.skip?.outro) {
      const s = meta.skip.outro;
      const start = Array.isArray(s) ? s[0] : s.start;
      const end = Array.isArray(s) ? s[1] : s.end;
      if (start !== undefined && end !== undefined && (start > 0 || end > 0)) {
        finalEd = { start, end, label: 'Ending', source: 'provider', confidence: 0.9 };
      }
    }

    const scoped = servers.filter((s) => s.provider === requested);
    const finalServers = scoped.length ? scoped : defaultServers.filter((s) => s.provider === requested);
    const isScopedUnavailable = !availableSlugs[requested];

    return ok({
      title: resolvedTitle,
      episode: ep,
      malId: resolvedMalId || null,
      scopedProvider: requested,
      scopedProviderUnavailable: Boolean(isScopedUnavailable),
      servers: finalServers,
      aniskip: {
        op: finalOp,
        ed: finalEd,
        recap: finalRecap,
      },
      providerHealth,
      availableProviders: getAvailableProvidersList(),
    }, {
      cache: 'no-store, no-cache, must-revalidate',
    });
  } catch (err) {
        return errorResponse(err);
      }
    },
    { allowedParams: ['id', 'animeId', 'title', 'malId', 'ep', 'audio', 'provider', 'server'], waitUntil },
  );
};
