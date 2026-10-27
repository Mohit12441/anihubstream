// @ts-check
import { HttpError, errorResponse, ok } from '../_lib.js';
import { resolveZokoEmbedEdge } from './_zoko.js';
import { isMegaplayTokenValid, resolveMegaplayEmbed } from '../_megaplay.js';

const HIANIME_MAIN = 'https://animehot.cc';
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
export const onRequestGet = async ({ request, env }) => {
  try {
    const url = new URL(request.url);
    const origin = url.origin;
    const rawId = (url.searchParams.get('id') || '').trim();
    const ep = Math.max(1, Number(url.searchParams.get('ep')) || 1);
    const audio = url.searchParams.get('audio') === 'dub' ? 'dub' : 'sub';
    const serverPref = (url.searchParams.get('server') || '').toLowerCase();

    if (!rawId) {
      throw new HttpError(400, 'bad_request', 'id query parameter is required');
    }

    const slug = rawId.replace(/^hianime:/i, '').split('#')[0].trim();
    const cacheKey = `hianime:${slug}:${ep}:${audio}`;

    // --- STEP 1: D1 Stream Cache Read (<15ms hit) ---
    if (env.ANIHUB) {
      try {
        const cached = await env.ANIHUB.prepare(
          `SELECT data, expires_at FROM stream_cache WHERE key = ?1 AND expires_at > ?2`
        ).bind(cacheKey, Date.now()).first();

        if (cached && typeof cached.data === 'string') {
          const parsed = JSON.parse(cached.data);
          const serverUrl = parsed?.data?.servers?.[0]?.streamUrl || '';
          if (serverUrl && isMegaplayTokenValid(serverUrl, 1200)) {
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
    let selectedServerName = 'HD-1';

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

    // --- STEP 3: Deterministic Embed Derivation & Concurrent Host Race ---
    if (malId && malId > 0) {
      const zokoDirectUrl = `https://zokoanime.video/stream/mal/${malId}/${ep}/${audio}`;
      const megaDirectUrl = `https://megaplay.buzz/stream/mal/${malId}/${ep}/${audio}`;

      // Race ZokoAnime and MegaPlay in parallel for minimum cold-start time
      const zokoRace = resolveZokoEmbedEdge(zokoDirectUrl, { signal: AbortSignal.timeout(3000) })
        .then((r) => (r?.masterUrl ? { type: 'zoko', res: r } : null))
        .catch(() => null);

      const megaRace = resolveMegaplayEmbed(megaDirectUrl)
        .then((r) => (r?.streamUrl ? { type: 'mega', res: r } : null))
        .catch(() => null);

      // Prioritize whichever responds successfully first
      const firstHit = await Promise.race([
        zokoRace.then((res) => (res ? res : megaRace)),
        megaRace.then((res) => (res ? res : zokoRace)),
      ]);

      if (firstHit && firstHit.res) {
        if (firstHit.type === 'zoko') {
          streamResult = {
            streamUrl: firstHit.res.masterUrl,
            referer: 'https://zokoanime.video/',
            quality: firstHit.res.defaultQuality || '1080p',
            subtitles: [],
            skip: firstHit.res.skip,
          };
          selectedServerName = 'HD-1';
        } else {
          streamResult = {
            streamUrl: firstHit.res.streamUrl,
            referer: 'https://megaplay.buzz/',
            quality: firstHit.res.quality || '1080p',
            subtitles: (firstHit.res.subtitles || []).map((sub) => ({
              ...sub,
              url: formatProxyUrl(sub.url, 'https://megaplay.buzz/', origin),
            })),
            skip: firstHit.res.intro || firstHit.res.outro ? { intro: firstHit.res.intro, outro: firstHit.res.outro } : null,
          };
          selectedServerName = 'HD-2';
        }
      }
    }

    // --- STEP 4: Upstream API Fallback (if deterministic derivation missed) ---
    if (!streamResult) {
      let animeId = '';

      if (/^[0-9a-f]{24}$/i.test(slug)) {
        animeId = slug;
      } else {
        const animeRes = await fetch(`${HIANIME_MAIN}/api/anime/${encodeURIComponent(slug).replace(/%3A/gi, ':')}`, {
          headers: { 'User-Agent': USER_AGENT, Referer: `${HIANIME_MAIN}/`, Accept: 'application/json' },
          signal: AbortSignal.timeout(3500),
        });

        if (animeRes.ok) {
          const aData = await animeRes.json();
          animeId = aData?.anime?._id || '';
          if (aData?.anime?.title) animeTitle = aData.anime.title;
          if (!malId && aData?.anime?.mal_id) malId = Number(aData.anime.mal_id) || null;
        }
      }

      if (!animeId) {
        throw new HttpError(404, 'not_found', `HiAnime could not find anime ID for "${slug}"`);
      }

      const epRes = await fetch(`${HIANIME_MAIN}/api/episodes/${animeId}?start=${ep}&end=${ep}`, {
        headers: { 'User-Agent': USER_AGENT, Referer: `${HIANIME_MAIN}/`, Accept: 'application/json' },
        signal: AbortSignal.timeout(3500),
      });

      if (!epRes.ok) {
        throw new HttpError(404, 'not_found', `HiAnime episode ${ep} not found for "${slug}"`);
      }

      const epData = await epRes.json();
      const epRow = (Array.isArray(epData?.episodes) ? epData.episodes : []).find(
        (r) => Number(r.episodeNumber) === ep
      ) || epData?.episodes?.[0];

      if (!epRow) {
        throw new HttpError(404, 'not_found', `HiAnime episode ${ep} has no available streams`);
      }

      const linkGroup = epRow.link || {};
      const wantedEmbeds = Array.isArray(linkGroup[audio]) && linkGroup[audio].length > 0
        ? linkGroup[audio]
        : (Array.isArray(linkGroup.sub) ? linkGroup.sub : []);

      if (wantedEmbeds.length === 0) {
        throw new HttpError(404, 'not_found', `No ${audio.toUpperCase()} embeds found for episode ${ep}`);
      }

      const zokoEmbed = wantedEmbeds.find((u) => /zokoanime/i.test(u));
      const megaEmbed = wantedEmbeds.find((u) => /megaplay/i.test(u));

      if (zokoEmbed && (!serverPref.includes('mega') || !megaEmbed)) {
        const zokoRes = await resolveZokoEmbedEdge(zokoEmbed, { signal: AbortSignal.timeout(3500) });
        if (zokoRes?.masterUrl) {
          streamResult = {
            streamUrl: zokoRes.masterUrl,
            referer: 'https://zokoanime.video/',
            quality: zokoRes.defaultQuality || '1080p',
            subtitles: [],
            skip: zokoRes.skip,
          };
          selectedServerName = 'HD-1';
        }
      }

      if (!streamResult && megaEmbed) {
        const megaRes = await resolveMegaplayEmbed(megaEmbed);
        if (megaRes?.streamUrl) {
          streamResult = {
            streamUrl: megaRes.streamUrl,
            referer: 'https://megaplay.buzz/',
            quality: megaRes.quality || '1080p',
            subtitles: (megaRes.subtitles || []).map((sub) => ({
              ...sub,
              url: formatProxyUrl(sub.url, 'https://megaplay.buzz/', origin),
            })),
            skip: megaRes.intro || megaRes.outro ? { intro: megaRes.intro, outro: megaRes.outro } : null,
          };
          selectedServerName = 'HD-2';
        }
      }
    }

    if (!streamResult) {
      throw new HttpError(502, 'stream_unavailable', `Failed to decrypt stream from HiAnime embed hosts`);
    }

    const proxiedStreamUrl = formatProxyUrl(streamResult.streamUrl, streamResult.referer, origin);

    const primaryServer = {
      id: `hianime:${selectedServerName}`,
      name: `HiAnime · ${selectedServerName}`,
      provider: 'hianime',
      status: 'ready',
      streamUrl: proxiedStreamUrl,
      type: 'hls',
      quality: streamResult.quality,
      audio,
      audioTracks: [{ id: 'ja', language: 'ja', label: 'Japanese (Original)', default: true }],
      subtitles: streamResult.subtitles || [],
      downloads: [],
    };

    const responsePayload = {
      ok: true,
      data: {
        title: animeTitle,
        episode: ep,
        malId,
        provider: 'hianime',
        servers: [primaryServer],
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
};
