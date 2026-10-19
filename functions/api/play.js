// @ts-check
import { HttpError, errorResponse, json, ok } from './_lib.js';

const BRIDGE_TIMEOUT_MS = 25_000;
const ANISKIP_TIMEOUT_MS = 5_000;
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
    animedubhindi: 'AnimeDubHindi',
    watchanimeworld: 'WatchAnimeWorld',
    animewave: 'AnimeWave',
    animekai: 'AnimeKai',
  };
  const base = provNames[provider?.toLowerCase()] || (provider ? provider.toUpperCase() : 'Server');
  return serverId ? `${base} · ${serverId}` : base;
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

async function fetchAniSkip(malId, ep, duration) {
  if (!malId || malId <= 0) return null;
  try {
    let targetMalId = malId;
    let targetEp = ep;

    // Check relation rules
    try {
      const ruleRes = await fetch(`${ANISKIP_BASE}/relation-rules/${encodeURIComponent(malId)}`, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(2000),
      });
      if (ruleRes.ok) {
        const ruleData = await ruleRes.json().catch(() => null);
        if (ruleData?.found && Array.isArray(ruleData.rules)) {
          for (const rule of ruleData.rules) {
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
      }
    } catch {
      // Continue with targetMalId
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
    const id = url.searchParams.get('id') || url.searchParams.get('animeId') || '';
    const titleParam = url.searchParams.get('title') || '';
    const malIdParam = url.searchParams.get('malId') || '';
    const ep = Math.max(1, Number.parseInt(url.searchParams.get('ep') ?? '1', 10) || 1);
    const audio = url.searchParams.get('audio') === 'hindi' ? 'hindi' : url.searchParams.get('audio') === 'dub' ? 'dub' : 'sub';
    const provider = url.searchParams.get('provider') || 'auto';
    const serverParam = url.searchParams.get('server') || '';

    let resolvedTitle = titleParam;
    let resolvedMalId = malIdParam ? Number.parseInt(malIdParam, 10) : 0;
    let durationSeconds = 1440;

    // Look up anime metadata and ID mappings in D1
    if (env.ANIHUB) {
      if (id) {
        const animeRow = await env.ANIHUB.prepare(
          `SELECT a.id, a.title, a.source_ids, a.skip_key_id, a.skip_key_space,
                  e.runtime_seconds,
                  m.mal_id, m.kitsu_id, m.anilist_id
           FROM anime a
           LEFT JOIN episode e ON (e.anime_id = a.id AND e.n = ?2)
           LEFT JOIN anime_id_map m ON m.anime_id = a.id
           WHERE a.id = ?1`
        ).bind(id, ep).first();

        if (animeRow) {
          if (!resolvedTitle) resolvedTitle = animeRow.title;
          if (animeRow.runtime_seconds) durationSeconds = animeRow.runtime_seconds;

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

    if (!resolvedTitle) {
      throw new HttpError(400, 'bad_request', 'Could not determine anime title from id or title query parameter');
    }

    // Determine Stream Bridge base
    const bridgeBase = env.STREAM_BRIDGE_URL || 'http://127.0.0.1:8795';

    // Parallel fetch: AniSkip timestamps and Bridge Stream Resolution
    const [aniskipData, bridgeRes] = await Promise.all([
      fetchAniSkip(resolvedMalId, ep, durationSeconds),
      (async () => {
        const resolveUrl = new URL(`${bridgeBase}/resolve`);
        resolveUrl.searchParams.set('title', resolvedTitle);
        resolveUrl.searchParams.set('ep', String(ep));
        resolveUrl.searchParams.set('audio', audio);
        if (provider) resolveUrl.searchParams.set('provider', provider);
        if (serverParam) resolveUrl.searchParams.set('server', serverParam);

        try {
          const res = await fetch(resolveUrl.toString(), {
            headers: { accept: 'application/json' },
            signal: AbortSignal.timeout(BRIDGE_TIMEOUT_MS),
          });
          if (!res.ok) return null;
          return await res.json().catch(() => null);
        } catch {
          return null;
        }
      })(),
    ]);

    if (!bridgeRes || (!bridgeRes.master && !bridgeRes.streamUrl)) {
      throw new HttpError(502, 'provider_error', 'Stream bridge failed to resolve playable streams for this title and episode');
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
    const activeServerId = `${prov}:${serverParam || 'HD-1'}`;
    const primaryServer = {
      id: activeServerId,
      name: formatServerName(prov, serverParam || 'HD-1'),
      provider: prov,
      status: 'ready',
      streamUrl,
      type: meta.kind === 'progressive' ? 'mp4' : 'hls',
      quality: meta.quality || '1080p',
      audio: meta.audio || audio,
      audioTracks: buildAudioTracks(meta.audio || audio),
      subtitles,
      downloads,
    };

    const servers = [primaryServer];

    // If bridge supplied other server choices, add them as alternatives
    if (Array.isArray(meta.servers)) {
      for (const s of meta.servers) {
        const sId = `${prov}:${s.id || s.name}`;
        if (sId !== activeServerId && !servers.some((existing) => existing.id === sId)) {
          servers.push({
            id: sId,
            name: formatServerName(prov, s.name || s.id),
            provider: prov,
            status: 'ready',
            streamUrl: `${bridgeBase}/resolve?title=${encodeURIComponent(resolvedTitle)}&ep=${ep}&audio=${audio}&provider=${prov}&server=${encodeURIComponent(s.id || s.name)}`,
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

    // Merge AniSkip: Prefer AniSkip v2, fallback to provider-reported skip times (from AniKoto/HiAnime)
    let finalOp = aniskipData?.op || null;
    let finalEd = aniskipData?.ed || null;
    let finalRecap = aniskipData?.recap || null;

    if (!finalOp && meta.skip?.intro?.start !== undefined && meta.skip?.intro?.end !== undefined) {
      finalOp = {
        start: meta.skip.intro.start,
        end: meta.skip.intro.end,
        label: 'Opening',
      };
    }
    if (!finalEd && meta.skip?.outro?.start !== undefined && meta.skip?.outro?.end !== undefined) {
      finalEd = {
        start: meta.skip.outro.start,
        end: meta.skip.outro.end,
        label: 'Ending',
      };
    }

    return ok({
      title: resolvedTitle,
      episode: ep,
      malId: resolvedMalId || null,
      servers,
      aniskip: {
        op: finalOp,
        ed: finalEd,
        recap: finalRecap,
      },
    }, {
      cache: 'public, max-age=600, s-maxage=1800',
    });
  } catch (err) {
    return errorResponse(err);
  }
};
