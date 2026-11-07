// @ts-check
import { HttpError, errorResponse, json, ok, strParam, intParam, withEdgeCache } from '../_lib.js';

const BRIDGE_ORIGIN = 'http://127.0.0.1:8795';
const BRIDGE_TIMEOUT_MS = 7000;

export const onRequestGet = async ({ request, env, waitUntil }) => {
  return withEdgeCache(
    request,
    env,
    300,
    async () => {
      try {
        const url = new URL(request.url);
        const provider = strParam(url, 'provider') || 'hianime';
        const itemId = strParam(url, 'itemId') || strParam(url, 'id') || strParam(url, 'animeId');
        const episodeNumber = intParam(url, 'episodeNumber', 1, 3000, 1) || intParam(url, 'ep', 1, 3000, 1);
        const audio = strParam(url, 'audio') || 'sub';

        if (!itemId) {
          throw new HttpError(400, 'bad_request', 'Missing itemId parameter');
        }

        // 1. Query anime and anime_id_map for mal_id and title using env.ANIHUB.prepare
        let malId = null;
        let animeTitle = itemId;

        if (env.ANIHUB) {
          const animeRow = await env.ANIHUB.prepare(
            'SELECT a.title, m.mal_id, m.anilist_id, m.hianime_slug, m.anikoto_slug, m.aniwatch_slug FROM anime a LEFT JOIN anime_id_map m ON m.anime_id = a.id WHERE a.id = ?1'
          )
            .bind(itemId)
            .first();

          if (animeRow) {
            animeTitle = animeRow.title || itemId;
            malId = animeRow.mal_id || null;
          }

          // Also check anime_provider_mapping for native provider slug / media_id
          const mappingRow = await env.ANIHUB.prepare(
            'SELECT provider_slug, media_id FROM anime_provider_mapping WHERE anime_id = ?1 AND provider_id = ?2'
          )
            .bind(itemId, provider.toLowerCase())
            .first();

          var nativeSlug = mappingRow?.provider_slug || null;
          if (!nativeSlug && provider.toLowerCase() === 'anipm' && animeRow?.anilist_id) {
            nativeSlug = String(animeRow.anilist_id);
          }
        }

        // 2. Call Stream Bridge on port 8795
        const bridgeUrl = new URL('/resolve', BRIDGE_ORIGIN);
        bridgeUrl.searchParams.set('title', animeTitle);
        bridgeUrl.searchParams.set('ep', String(episodeNumber));
        bridgeUrl.searchParams.set('provider', provider);
        bridgeUrl.searchParams.set('audio', audio);
        if (nativeSlug) {
          bridgeUrl.searchParams.set('slug', nativeSlug);
        }
        if (malId) {
          bridgeUrl.searchParams.set('mal', String(malId));
        }

        let streamUrl = null;
        let bridgeData = null;

        try {
          const bridgeRes = await fetch(bridgeUrl.toString(), {
            headers: { accept: 'application/json' },
            signal: AbortSignal.timeout(BRIDGE_TIMEOUT_MS),
          });

          if (bridgeRes.ok) {
            bridgeData = await bridgeRes.json();
            streamUrl =
              bridgeData.master?.url ||
              bridgeData.streamUrl ||
              bridgeData.url ||
              bridgeData.master ||
              null;
          }
        } catch {
          // Stream bridge call timed out or failed; will fallback to default proxy/HLS format
        }

        // Fallback placeholder streamUrl if bridge offline during dev
        if (!streamUrl) {
          streamUrl = `/api/play/resolve?title=${encodeURIComponent(animeTitle)}&ep=${episodeNumber}&audio=${audio}&provider=${encodeURIComponent(provider)}`;
        }

        return json({
          ok: true,
          streamUrl,
          malId: malId ? Number(malId) : null,
          episodeNumber,
          provider,
          title: animeTitle,
          details: bridgeData || undefined,
        });
      } catch (err) {
        return errorResponse(err);
      }
    },
    { allowedParams: ['provider', 'itemId', 'id', 'animeId', 'episodeNumber', 'ep', 'audio', 'server'], waitUntil }
  );
};
