// @ts-check
import { HttpError, errorResponse, ok } from '../_lib.js';
import { isMegaplayTokenValid, resolveMegaplayEmbed, resolveMegaplayDirect } from './_megaplay.js';

const ANIKOTO_MAIN = 'https://anikoto.cz';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const STREAM_CACHE_TTL_MS = 20 * 60 * 1000; // 20 minutes

function formatProxyUrl(rawUrl, referer, origin) {
  if (!rawUrl) return '';
  return `${origin}/api/proxy?url=${encodeURIComponent(rawUrl)}&referer=${encodeURIComponent(referer)}`;
}

/**
 * AniKoto Isolated Low-Latency Playback Edge Endpoint:
 * 1. D1 Stream Cache Check (<15ms on warmed hit).
 * 2. Deterministic Embed Derivation via D1 MAL ID (skips upstream scraping on cold start).
 * 3. Pure Edge WebCrypto MegaPlay Decryption & Token Signing.
 * 4. Fallback to anikoto.cz scraping when MAL ID is not in D1.
 *
 * GET /api/anikoto/play?id=:id&ep=:n&audio=:audio&server=:server
 */
export const onRequestGet = async ({ request, env }) => {
  try {
    const url = new URL(request.url);
    const origin = url.origin;
    const rawId = (url.searchParams.get('id') || '').trim();
    const ep = Math.max(1, Number(url.searchParams.get('ep')) || 1);
    const audio = url.searchParams.get('audio') === 'dub' ? 'dub' : 'sub';
    const serverPref = (url.searchParams.get('server') || 'HD-1').replace(/^anikoto:\s*/i, '');

    if (!rawId) {
      throw new HttpError(400, 'bad_request', 'id query parameter is required');
    }

    const slug = rawId.replace(/^anikoto:/i, '').split('#')[0].trim();
    const cacheKey = `anikoto:${slug}:${ep}:${audio}`;

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
    const selectedServerName = serverPref || 'HD-1';

    // --- STEP 2: Fast D1 MAL ID & Title Lookup ---
    if (env.ANIHUB) {
      try {
        const d1Match = await env.ANIHUB.prepare(
          `SELECT a.title, m.mal_id, a.skip_key_id, m.anikoto_slug
           FROM anime a
           LEFT JOIN anime_id_map m ON a.id = m.anime_id
           LEFT JOIN anime_provider_mapping pm ON a.id = pm.anime_id AND pm.provider_id = 'anikoto'
           WHERE a.id = ?1 OR m.anikoto_slug = ?1 OR pm.provider_slug = ?1 OR lower(a.title) = lower(?1)
           LIMIT 1`
        ).bind(slug).first();

        if (d1Match) {
          malId = Number(d1Match.mal_id || d1Match.skip_key_id) || null;
          if (d1Match.title) animeTitle = d1Match.title;
        }
      } catch (_) {}
    }

    // --- STEP 3: Deterministic MegaPlay WebCrypto Resolution via MAL ID ---
    if (malId && malId > 0) {
      try {
        const directRes = await resolveMegaplayDirect({ malId, ep, audio });
        if (directRes?.streamUrl) {
          streamResult = {
            streamUrl: directRes.streamUrl,
            referer: 'https://megaplay.buzz/',
            quality: directRes.quality || '1080p',
            subtitles: (directRes.subtitles || []).map((s) => ({
              ...s,
              url: formatProxyUrl(s.url, 'https://megaplay.buzz/', origin),
            })),
            skip: directRes.intro || directRes.outro ? { intro: directRes.intro, outro: directRes.outro } : null,
          };
        }
      } catch (_) {}
    }

    // --- STEP 4: Fallback to anikoto.cz watch scraping if cold start had no MAL ID ---
    if (!streamResult) {
      const watchUrl = `${ANIKOTO_MAIN}/watch/${encodeURIComponent(slug)}`;
      const watchRes = await fetch(watchUrl, {
        headers: {
          'User-Agent': USER_AGENT,
          Referer: `${ANIKOTO_MAIN}/`,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        signal: AbortSignal.timeout(4000),
      });

      if (watchRes.ok) {
        const html = await watchRes.text();
        const watchId = html.match(/id="watch-main"[^>]*data-id="([^"]*)"/i)?.[1] || '';

        if (watchId) {
          const epListRes = await fetch(`${ANIKOTO_MAIN}/ajax/episode/list/${watchId}?vrf=`, {
            headers: {
              'User-Agent': USER_AGENT,
              Referer: watchUrl,
              'X-Requested-With': 'XMLHttpRequest',
              Accept: 'application/json, text/javascript, */*; q=0.01',
            },
            signal: AbortSignal.timeout(4000),
          });

          if (epListRes.ok) {
            const epListPayload = await epListRes.json().catch(() => null);
            const epListHtml = epListPayload?.html || epListPayload?.result || '';
            const epMatches = [...epListHtml.matchAll(/<a\b[^>]*data-ids="([^"]*)"[^>]*data-num="(\d+)"[^>]*>/gi)];
            const targetEp = epMatches.find((m) => Number(m[2]) === ep) || epMatches[0];

            if (targetEp) {
              const serverIds = targetEp[1] || '';
              // Fetch servers for this episode
              const srvRes = await fetch(`${ANIKOTO_MAIN}/ajax/episode/servers?episodeId=${encodeURIComponent(serverIds)}`, {
                headers: {
                  'User-Agent': USER_AGENT,
                  Referer: watchUrl,
                  'X-Requested-With': 'XMLHttpRequest',
                  Accept: 'application/json, text/javascript, */*; q=0.01',
                },
                signal: AbortSignal.timeout(4000),
              });

              if (srvRes.ok) {
                const srvPayload = await srvRes.json().catch(() => null);
                const srvHtml = srvPayload?.html || srvPayload?.result || '';
                const embedMatch = srvHtml.match(/data-embed="([^"]*)"/i) || srvHtml.match(/src="([^"]*)"/i);
                const embedUrl = embedMatch?.[1] || '';

                if (embedUrl) {
                  const megaRes = await resolveMegaplayEmbed(embedUrl);
                  if (megaRes?.streamUrl) {
                    streamResult = {
                      streamUrl: megaRes.streamUrl,
                      referer: 'https://megaplay.buzz/',
                      quality: megaRes.quality || '1080p',
                      subtitles: (megaRes.subtitles || []).map((s) => ({
                        ...s,
                        url: formatProxyUrl(s.url, 'https://megaplay.buzz/', origin),
                      })),
                      skip: megaRes.intro || megaRes.outro ? { intro: megaRes.intro, outro: megaRes.outro } : null,
                    };
                  }
                }
              }
            }
          }
        }
      }
    }

    if (!streamResult) {
      throw new HttpError(502, 'stream_unavailable', `Failed to decrypt stream from AniKoto embed hosts for "${slug}"`);
    }

    const proxiedStreamUrl = formatProxyUrl(streamResult.streamUrl, streamResult.referer, origin);

    const primaryServer = {
      id: `anikoto:${selectedServerName}`,
      name: `AniKoto · ${selectedServerName}`,
      provider: 'anikoto',
      status: 'ready',
      streamUrl: proxiedStreamUrl,
      type: 'hls',
      quality: streamResult.quality,
      audio,
      audioTracks: audio === 'dub'
        ? [{ id: 'en', language: 'en', label: 'English Dub', default: true }]
        : [{ id: 'ja', language: 'ja', label: 'Japanese (Original)', default: true }],
      subtitles: streamResult.subtitles || [],
      downloads: [],
    };

    const responsePayload = {
      ok: true,
      data: {
        title: animeTitle,
        episode: ep,
        malId,
        provider: 'anikoto',
        servers: [primaryServer],
        source: {
          streamType: 'hls',
          url: proxiedStreamUrl,
          ready: true,
        },
      },
      source: 'upstream',
      provider: 'anikoto',
    };

    // --- STEP 5: Write to D1 Stream Cache ---
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
