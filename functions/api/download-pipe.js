// @ts-check
import { HttpError, errorResponse } from './_lib.js';
import { resolveMegaplayDirect } from './_megaplay.js';
import { resolveZokoEmbedEdge } from './hianime/_zoko.js';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

/**
 * Parses variant renditions from an HLS master playlist
 * @param {string} text
 * @param {string} baseUrl
 * @returns {Array<{ quality: string, bandwidth: number, url: string }>}
 */
function parseMasterVariants(text, baseUrl) {
  const lines = text.split(/\r?\n/);
  const renditions = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('#EXT-X-STREAM-INF:')) continue;

    const resMatch = line.match(/RESOLUTION=\d+x(\d+)/i);
    const bwMatch = line.match(/BANDWIDTH=(\d+)/i);
    const height = resMatch ? `${resMatch[1]}p` : 'unknown';
    const bandwidth = bwMatch ? Number(bwMatch[1]) : 0;

    let nextUrl = '';
    for (let j = i + 1; j < lines.length; j++) {
      const candidate = lines[j].trim();
      if (!candidate || candidate.startsWith('#')) continue;
      nextUrl = candidate;
      break;
    }

    if (nextUrl) {
      const fullUrl = nextUrl.startsWith('http') ? nextUrl : new URL(nextUrl, baseUrl).href;
      renditions.push({ quality: height, bandwidth, url: fullUrl });
    }
  }

  return renditions.sort((a, b) => {
    const numA = parseInt(a.quality, 10) || 0;
    const numB = parseInt(b.quality, 10) || 0;
    return numB - numA || b.bandwidth - a.bandwidth;
  });
}

/**
 * Parses media segments from a media playlist
 * @param {string} text
 * @param {string} baseUrl
 * @returns {string[]}
 */
function parseMediaSegments(text, baseUrl) {
  const lines = text.split(/\r?\n/);
  const segments = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;
    const absUrl = line.startsWith('http') ? line : new URL(line, baseUrl).href;
    segments.push(absUrl);
  }

  return segments;
}

/**
 * Single-Stream Direct Video Download Pipe
 *
 * Streams concatenated media segments directly over HTTP with Content-Disposition
 * so native desktop and mobile browser downloaders save the full video at max line speed.
 *
 * GET /api/download-pipe?id=:id&ep=:ep&provider=:provider&audio=:audio&quality=:quality
 */
export const onRequestGet = async ({ request, env }) => {
  try {
    const url = new URL(request.url);
    const rawId = (url.searchParams.get('id') || url.searchParams.get('title') || '').trim();
    const ep = Math.max(1, Number(url.searchParams.get('ep')) || 1);
    const audio = url.searchParams.get('audio') === 'dub' ? 'dub' : 'sub';
    const requestedQuality = (url.searchParams.get('quality') || '1080p').toLowerCase().trim();

    if (!rawId) {
      throw new HttpError(400, 'bad_request', 'id query parameter is required');
    }

    let provider = (url.searchParams.get('provider') || '').toLowerCase().trim();
    if (!provider) {
      if (rawId.startsWith('hianime:')) provider = 'hianime';
      else if (rawId.startsWith('anikoto:')) provider = 'anikoto';
      else if (rawId.startsWith('aniwatch:')) provider = 'aniwatch';
      else provider = 'aniwatch';
    }

    const cleanSlug = rawId.replace(/^[a-z0-9_-]+:/i, '').split('#')[0].trim();

    // 1. D1 Metadata Lookup
    let malId = null;
    let animeTitle = cleanSlug;

    if (env.ANIHUB) {
      try {
        const match = await env.ANIHUB.prepare(
          `SELECT a.id, a.title, a.skip_key_id, m.mal_id
           FROM anime a
           LEFT JOIN anime_id_map m ON a.id = m.anime_id
           WHERE a.id = ?1 OR m.anikoto_slug = ?1 OR m.hianime_slug = ?1 OR lower(a.title) = lower(?1)
           LIMIT 1`
        ).bind(cleanSlug).first();

        if (match) {
          malId = Number(match.mal_id || match.skip_key_id) || null;
          if (match.title) animeTitle = match.title;
        } else {
          const provMatch = await env.ANIHUB.prepare(
            `SELECT a.id, a.title, a.skip_key_id, a.mal_id
             FROM anime_provider_mapping m
             JOIN anime a ON a.id = m.anime_id
             WHERE m.provider_slug = ?1 LIMIT 1`
          ).bind(cleanSlug).first().catch(() => null);

          if (provMatch) {
            malId = Number(provMatch.mal_id || provMatch.skip_key_id) || null;
            if (provMatch.title) animeTitle = provMatch.title;
          }
        }
      } catch (_) {}
    }

    // 2. Resolve Master Playlist
    let masterUrl = null;
    let referer = 'https://megaplay.buzz/';

    if (provider === 'hianime') {
      referer = 'https://zokoanime.video/';
      if (malId) {
        const zokoRes = await resolveZokoEmbedEdge(`https://zokoanime.video/stream/mal/${malId}/${ep}/${audio}`).catch(() => null);
        if (zokoRes?.masterUrl) {
          masterUrl = zokoRes.masterUrl;
        } else {
          const directRes = await resolveMegaplayDirect({ malId, ep, audio }).catch(() => null);
          if (directRes?.streamUrl) {
            masterUrl = directRes.streamUrl;
            referer = 'https://megaplay.buzz/';
          }
        }
      }
    } else {
      // aniwatch or anikoto
      referer = 'https://megaplay.buzz/';
      if (malId) {
        const directRes = await resolveMegaplayDirect({ malId, ep, audio }).catch(() => null);
        if (directRes?.streamUrl) {
          masterUrl = directRes.streamUrl;
        }
      }
    }

    if (!masterUrl) {
      throw new HttpError(404, 'not_found', `Could not resolve video stream for ${provider} episode ${ep}`);
    }

    // 3. Fetch Master Playlist
    const masterRes = await fetch(masterUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        Referer: referer,
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!masterRes.ok) {
      throw new HttpError(502, 'upstream_error', `Failed to load master playlist (${masterRes.status})`);
    }

    const masterText = await masterRes.text();
    let targetPlaylistUrl = masterUrl;
    let targetPlaylistText = masterText;

    // 4. Resolve Quality Rendition
    if (masterText.includes('#EXT-X-STREAM-INF')) {
      const variants = parseMasterVariants(masterText, masterUrl);
      let chosen = variants[0];
      if (requestedQuality) {
        const match = variants.find((v) => v.quality.toLowerCase().includes(requestedQuality) || requestedQuality.includes(v.quality.toLowerCase()));
        if (match) chosen = match;
      }

      if (chosen) {
        targetPlaylistUrl = chosen.url;
        const renditionRes = await fetch(chosen.url, {
          headers: {
            'User-Agent': USER_AGENT,
            Referer: referer,
          },
          signal: AbortSignal.timeout(10_000),
        });

        if (renditionRes.ok) {
          targetPlaylistText = await renditionRes.text();
        }
      }
    }

    // 5. Parse Segments
    const segmentUrls = parseMediaSegments(targetPlaylistText, targetPlaylistUrl);
    if (!segmentUrls.length) {
      throw new HttpError(502, 'no_segments', 'No media segments found in stream playlist');
    }

    const safeTitle = animeTitle.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `${safeTitle}_EP${ep}_${requestedQuality}.ts`;

    if (request.method === 'HEAD') {
      return new Response(null, {
        status: 200,
        headers: {
          'Content-Type': 'video/mp2t',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Expose-Headers': 'Content-Disposition',
        },
      });
    }

    // 6. Setup Direct Streaming Response
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();

    // Background streaming producer with client abort handling
    (async () => {
      try {
        for (let i = 0; i < segmentUrls.length; i++) {
          if (request.signal?.aborted) break;

          const segUrl = segmentUrls[i];
          let retries = 2;
          let segRes = null;

          while (retries >= 0) {
            try {
              segRes = await fetch(segUrl, {
                headers: {
                  'User-Agent': USER_AGENT,
                  Referer: referer,
                },
                signal: AbortSignal.timeout(12_000),
              });
              if (segRes.ok) break;
            } catch (fetchErr) {
              retries--;
              if (retries < 0) break;
              await new Promise((r) => setTimeout(r, 300));
            }
          }

          if (!segRes || !segRes.ok || !segRes.body) continue;

          // Pipe segment stream directly into output writer
          const reader = segRes.body.getReader();
          while (true) {
            if (request.signal?.aborted) {
              try { await reader.cancel(); } catch (_) {}
              break;
            }
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
              await writer.write(value);
            }
          }
        }
      } catch (pipeErr) {
        // Stream aborted by client or network drop
      } finally {
        try {
          await writer.close();
        } catch (_) {}
      }
    })();

    return new Response(readable, {
      status: 200,
      headers: {
        'Content-Type': 'video/mp2t',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers': 'Content-Disposition',
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
};

export const onRequestHead = onRequestGet;
