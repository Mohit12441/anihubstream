// @ts-check
import { HttpError, buildAudioTracks, errorResponse, ok, withEdgeCache } from '../_lib.js';
import { resolveZokoEmbedEdge } from './_zoko.js';
import { resolveHiAnimeV2Direct } from './_hianime_v2.js';

const HIANIME_MAIN = 'https://hianimex.com.in';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const STREAM_CACHE_TTL_MS = 20 * 60 * 1000; // 20 minutes

function formatProxyUrl(rawUrl, referer, origin) {
  if (!rawUrl) return '';
  return `${origin}/api/proxy?url=${encodeURIComponent(rawUrl)}&referer=${encodeURIComponent(referer)}`;
}

/**
 * HiAnime Ultra-Low-Latency Playback Edge Endpoint:
 * 1. D1 Stream Cache Check (<15ms on warmed hit).
 * 2. Deterministic Embed Derivation via D1 MAL ID (skips Hops 1 & 2 on cold start).
 * 3. Concurrent Dual-Host Race (Zoko vs MegaPlay).
 * 4. Fallback to upstream API if needed.
 *
 * GET /api/hianime/play?id=:id&ep=:n&audio=:audio&server=:server
 */
export const onRequestGet = async ({ request, env, waitUntil }) => {
  return withEdgeCache(
    request,
    env,
    300,
    async () => {
      try {
        const url = new URL(request.url);
    const origin = url.origin;
    const rawId = (url.searchParams.get('id') || '').trim();
    const ep = Math.max(1, Number(url.searchParams.get('ep')) || 1);
    const audio = url.searchParams.get('audio') === 'dub' ? 'dub' : 'sub';
    const rawServerPref = (url.searchParams.get('server') || 'HD-3').replace(/-dub$/i, '').replace(/\[.*?\]/g, '').trim().toUpperCase();
    const serverPref = rawServerPref || 'HD-3';

    if (!rawId) {
      throw new HttpError(400, 'bad_request', 'id query parameter is required');
    }

    const slug = rawId.replace(/^hianime:/i, '').split('#')[0].trim();
    const cacheKey = `hianime:${slug}:${ep}:${audio}:${serverPref}`;

    // --- STEP 1: D1 Stream Cache Read (<15ms hit) ---
    if (env.ANIHUB) {
      try {
        const cached = await env.ANIHUB.prepare(
          `SELECT data, expires_at FROM stream_cache WHERE key = ?1 AND expires_at > ?2`
        ).bind(cacheKey, Date.now()).first();

        if (cached && typeof cached.data === 'string') {
          const parsed = JSON.parse(cached.data);
          const serverUrl = parsed?.data?.servers?.[0]?.streamUrl || '';
          if (serverUrl) {
            return ok({
              ...parsed,
              source: 'cache',
            }, { cache: 'public, max-age=300, s-maxage=600' });
          }
        }
      } catch (_) {
        // Proceed on cache miss or error
      }
    }

    let malId = null;
    let animeTitle = slug;
    let streamResult = null;
    let selectedServerName = serverPref;

    // --- STEP 2: Fast D1 MAL ID Lookup (Enables Deterministic Cold Start) ---
    if (env.ANIHUB) {
      try {
        const d1Match = await env.ANIHUB.prepare(
          `SELECT a.title, m.mal_id, a.skip_key_id
           FROM anime a
           LEFT JOIN anime_id_map m ON a.id = m.anime_id
           LEFT JOIN anime_provider_mapping pm ON a.id = pm.anime_id AND pm.provider_id = 'hianime'
           WHERE a.id = ?1 OR pm.provider_slug = ?1 OR lower(a.title) = lower(?1)
           LIMIT 1`
        ).bind(slug).first();

        if (d1Match) {
          malId = Number(d1Match.mal_id || d1Match.skip_key_id) || null;
          if (d1Match.title) animeTitle = d1Match.title;
        }
      } catch (_) {}
    }

    // --- STEP 3: Deterministic Embed Derivation & Server Targeting ---
    if (malId && malId > 0 && serverPref === 'HD-3') {
      const zokoDirectUrl = `https://zokoanime.video/stream/mal/${malId}/${ep}/${audio}`;
      const zokoRes = await resolveZokoEmbedEdge(zokoDirectUrl, { signal: AbortSignal.timeout(3500) }).catch(() => null);
      if (zokoRes?.masterUrl) {
        streamResult = {
          streamUrl: zokoRes.masterUrl,
          referer: 'https://zokoanime.video/',
          quality: zokoRes.defaultQuality || '1080p',
          subtitles: (zokoRes.subtitles || []).map((sub) => ({
            ...sub,
            url: formatProxyUrl(sub.url, 'https://zokoanime.video/', origin),
          })),
          skip: zokoRes.skip,
        };
        selectedServerName = 'HD-3';
      }
    }

    // --- STEP 4: Upstream HiAnime v2 Ajax Fallback (if deterministic derivation missed) ---
    if (!streamResult) {
      const v2Res = await resolveHiAnimeV2Direct({
        slug,
        animeId: malId,
        ep,
        audio,
        server: serverPref || 'HD-3',
      });

      if (v2Res?.streamUrl) {
        streamResult = {
          streamUrl: v2Res.streamUrl,
          referer: v2Res.referer,
          quality: v2Res.quality || '1080p',
          subtitles: (v2Res.subtitles || []).map((sub) => ({
            ...sub,
            url: formatProxyUrl(sub.url, v2Res.referer, origin),
          })),
          skip: v2Res.skip,
        };
        selectedServerName = v2Res.serverName || serverPref || 'HD-3';
      }
    }

    if (!streamResult) {
      throw new HttpError(502, 'stream_unavailable', `Failed to decrypt stream from HiAnime embed hosts`);
    }

    const proxiedStreamUrl = formatProxyUrl(streamResult.streamUrl, streamResult.referer, origin);

    const serverDefinitions = [
      { id: 'HD-3', name: 'HD-3 [Zoko]' },
      { id: 'HD-2', name: 'HD-2 [MegaVid]' },
    ];

    const allServers = serverDefinitions.map((def) => {
      const isSelected = def.id === selectedServerName;
      const srvStreamUrl = isSelected
        ? proxiedStreamUrl
        : `${origin}/api/play/resolve?id=${encodeURIComponent(slug)}&ep=${ep}&audio=${audio}&provider=hianime&server=${def.id}`;
      return {
        id: `hianime:${def.id}${audio === 'dub' ? '-dub' : ''}`,
        name: `HiAnime · ${def.name}${audio === 'dub' ? ' (DUB)' : ''}`,
        provider: 'hianime',
        status: 'ready',
        streamUrl: srvStreamUrl,
        type: audio === 'dub' ? 'dub' : 'hls',
        quality: isSelected ? streamResult.quality : '1080p',
        audio,
        audioTracks: buildAudioTracks(audio),
        subtitles: isSelected ? (streamResult.subtitles || []) : [],
        downloads: [],
      };
    });

    const primaryServer = allServers.find((s) => s.id.includes(selectedServerName)) || allServers[0];

    const responsePayload = {
      ok: true,
      data: {
        title: animeTitle,
        episode: ep,
        malId,
        provider: 'hianime',
        servers: allServers,
        source: {
          streamType: 'hls',
          url: proxiedStreamUrl,
          ready: true,
        },
      },
      source: 'upstream',
      provider: 'hianime',
    };

    // --- STEP 5: Write to D1 Stream Cache for instant repeat reads ---
    if (env.ANIHUB && primaryServer.streamUrl) {
      try {
        env.ANIHUB.prepare(
          `INSERT OR REPLACE INTO stream_cache (key, data, expires_at) VALUES (?1, ?2, ?3)`
        ).bind(cacheKey, JSON.stringify(responsePayload), Date.now() + STREAM_CACHE_TTL_MS).run().catch(() => {});
      } catch (_) {}
    }

    return ok(responsePayload, { cache: 'public, max-age=180, s-maxage=300' });
  } catch (err) {
        return errorResponse(err);
      }
    },
    { allowedParams: ['id', 'ep', 'audio', 'server'], waitUntil },
  );
};
