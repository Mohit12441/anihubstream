// @ts-check
import {
  HttpError,
  errorResponse,
  ok,
  resolveMalId,
  parseMasterVariants,
  parseMediaSegments,
  deriveSlugCandidates,
  findAnimeByCandidates,
} from './_lib.js';
import { resolveMegaplayDirect } from './_megaplay.js';
import { resolveZokoEmbedEdge } from './hianime/_zoko.js';
import { resolveHiAnimeV2Direct } from './hianime/_hianime_v2.js';
import { resolveAniPmBetaDirect } from './_anipm.js';
import { resolveAniWatchDirect } from './_aniwatch.js';
import { searchRezka, hdrezkaMeta } from '../_lib/hdrezka.js';
import { resolveHindiFlixStream } from '../_lib/hindiflix.js';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const CACHE_TTL_MS = 20 * 60 * 1000; // 20 minutes

/**
 * Extract AniKoto direct mirror downloads from mapper.nekostream.site
 * @param {number} malId
 * @param {number} ep
 * @param {string} audio
 * @param {AbortSignal} [signal]
 */
async function extractAnikotoDownloads(malId, ep, audio, signal) {
  if (!malId) return [];
  try {
    const res = await fetch(`https://mapper.nekostream.site/api/mal/${encodeURIComponent(malId)}/${encodeURIComponent(ep)}/1`, {
      headers: {
        referer: 'https://anikoto.cz/',
        'user-agent': USER_AGENT,
      },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    if (!data || typeof data !== 'object') return [];

    const downloads = [];
    const langs = audio === 'dub' ? ['dub', 'sub'] : ['sub', 'dub'];
    for (const [providerName, provData] of Object.entries(data)) {
      if (!provData || typeof provData !== 'object' || providerName === 'status') continue;
      const cleanProvName = providerName.toLowerCase() === 'kiwi' ? 'Kiwi' : providerName;
      for (const lang of langs) {
        const langData = provData[lang];
        if (langData?.download && typeof langData.download === 'object') {
          for (const [quality, dlUrl] of Object.entries(langData.download)) {
            if (dlUrl && typeof dlUrl === 'string') {
              downloads.push({
                name: `${cleanProvName} ${lang === 'dub' ? 'Dub' : 'Sub'} (${quality.toUpperCase()})`,
                label: `${cleanProvName} ${quality}`,
                quality,
                url: dlUrl,
                provider: 'anikoto',
                audio: lang,
                type: 'direct',
                format: 'MP4',
              });
            }
          }
        }
      }
    }
    return downloads;
  } catch {
    return [];
  }
}

/**
 * Extract HiAnime multi-quality downloads from zokoanime.video API
 * @param {number} malId
 * @param {number} ep
 * @param {string} audio
 * @param {AbortSignal} [signal]
 */
async function extractHianimeDownloads(malId, ep, audio, signal) {
  if (!malId) return { downloads: [], downloadPage: null };
  const cleanTrack = audio === 'dub' ? 'dub' : 'sub';
  const path = `mal/${malId}/${ep}/${cleanTrack}`;
  const downloadPage = `https://zokoanime.video/download/${path}`;
  const referer = downloadPage;

  try {
    const tokenRes = await fetch(`https://zokoanime.video/api/downloads/token/${path}`, {
      headers: {
        referer,
        'user-agent': USER_AGENT,
      },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(4000)]) : AbortSignal.timeout(4000),
    });
    if (!tokenRes.ok) return { downloads: [], downloadPage };

    const tokenData = await tokenRes.json().catch(() => null);
    if (!tokenData?.token) return { downloads: [], downloadPage };

    const dlRes = await fetch(`https://zokoanime.video/api/downloads/${path}?t=${encodeURIComponent(tokenData.token)}`, {
      headers: {
        referer,
        'user-agent': USER_AGENT,
      },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000),
    });
    if (!dlRes.ok) return { downloads: [], downloadPage };

    const data = await dlRes.json().catch(() => null);
    if (!Array.isArray(data?.downloads)) return { downloads: [], downloadPage };

    const downloads = data.downloads.map((d) => ({
      name: `HiAnime · ${d.label || 'Direct'} (${(d.kind || cleanTrack).toUpperCase()})`,
      label: d.label || '1080p',
      quality: d.label || '1080p',
      url: d.url,
      provider: 'hianime',
      audio: d.kind || cleanTrack,
      type: 'direct',
      format: 'MP4',
    }));

    return { downloads, downloadPage };
  } catch {
    return { downloads: [], downloadPage };
  }
}

/**
 * Streams media segments or direct MP4 files over HTTP with Content-Disposition
 * @param {string} masterUrl
 * @param {string} referer
 * @param {string} requestedQuality
 * @param {string} animeTitle
 * @param {number} ep
 * @param {Request} request
 */
export async function streamEpisodePipe(masterUrl, referer, requestedQuality, animeTitle, ep, request) {
  const safeTitle = (animeTitle || 'anime').replace(/[^a-zA-Z0-9_-]/g, '_');

  // Direct MP4 handling: if target stream is an MP4 file, stream it directly with video/mp4 Content-Disposition
  const isDirectMp4 = masterUrl.toLowerCase().includes('.mp4') || (!masterUrl.toLowerCase().includes('.m3u8') && !masterUrl.toLowerCase().includes('master'));
  if (isDirectMp4) {
    const filename = `${safeTitle}_EP${ep}_${requestedQuality || '1080p'}.mp4`;
    if (request.method === 'HEAD') {
      return new Response(null, {
        status: 200,
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Expose-Headers': 'Content-Disposition',
        },
      });
    }

    const mp4Res = await fetch(masterUrl, {
      headers: { 'User-Agent': USER_AGENT, Referer: referer },
      signal: AbortSignal.timeout(25_000),
    });

    if (!mp4Res.ok) {
      throw new HttpError(502, 'upstream_error', `Failed to stream MP4 media (${mp4Res.status})`);
    }

    return new Response(mp4Res.body, {
      status: 200,
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers': 'Content-Disposition',
      },
    });
  }

  // HLS stream handling: fetch playlist, select variant, stitch .ts segments
  const masterRes = await fetch(masterUrl, {
    headers: { 'User-Agent': USER_AGENT, Referer: referer },
    signal: AbortSignal.timeout(10_000),
  });

  if (!masterRes.ok) {
    throw new HttpError(502, 'upstream_error', `Failed to load master playlist (${masterRes.status})`);
  }

  const masterText = await masterRes.text();
  let targetPlaylistUrl = masterUrl;
  let targetPlaylistText = masterText;

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
        headers: { 'User-Agent': USER_AGENT, Referer: referer },
        signal: AbortSignal.timeout(10_000),
      });

      if (renditionRes.ok) {
        targetPlaylistText = await renditionRes.text();
      }
    }
  }

  const segmentUrls = parseMediaSegments(targetPlaylistText, targetPlaylistUrl);
  if (!segmentUrls.length) {
    throw new HttpError(502, 'no_segments', 'No media segments found in stream playlist');
  }

  const filename = `${safeTitle}_EP${ep}_${requestedQuality || 'video'}.ts`;

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

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

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
              headers: { 'User-Agent': USER_AGENT, Referer: referer },
              signal: AbortSignal.timeout(12_000),
            });
            if (segRes.ok) break;
          } catch (_) {
            retries--;
            if (retries < 0) break;
            await new Promise((r) => setTimeout(r, 250));
          }
        }

        if (!segRes || !segRes.ok || !segRes.body) continue;

        const reader = segRes.body.getReader();
        while (true) {
          if (request.signal?.aborted) {
            try { await reader.cancel(); } catch (_) {}
            break;
          }
          const { done, value } = await reader.read();
          if (done) break;
          if (value) await writer.write(value);
        }
      }
    } catch (_) {
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
}

/**
 * Unified Provider-Scoped Episode Download Endpoint
 *
 * GET /api/download?provider=:provider&id=:id&ep=:n&audio=:audio
 */
export const onRequestGet = async ({ request, env }) => {
  try {
    const url = new URL(request.url);
    const rawId = (url.searchParams.get('id') || url.searchParams.get('title') || '').trim();
    const ep = Math.max(1, Number(url.searchParams.get('ep')) || 1);
    const audio = url.searchParams.get('audio') === 'dub' ? 'dub' : 'sub';
    const isPipe = url.searchParams.get('mode') === 'pipe' || url.searchParams.get('pipe') === '1';
    const requestedQuality = (url.searchParams.get('quality') || '1080p').toLowerCase().trim();

    if (!rawId) {
      throw new HttpError(400, 'bad_request', 'id query parameter is required');
    }

    // Infer or clean provider parameter
    let provider = (url.searchParams.get('provider') || '').toLowerCase().trim();
    if (!provider) {
      if (rawId.startsWith('hianime:')) provider = 'hianime';
      else if (rawId.startsWith('anikoto:')) provider = 'anikoto';
      else if (rawId.startsWith('aniwatch:')) provider = 'aniwatch';
      else if (rawId.startsWith('anipm:')) provider = 'anipm';
      else if (rawId.startsWith('hdrezka:')) provider = 'hdrezka';
      else if (rawId.startsWith('hindiflix:')) provider = 'hindiflix';
      else provider = 'anikoto';
    }

    const cleanSlug = rawId.replace(/^[a-z0-9_-]+:/i, '').split('#')[0].trim();
    const cacheKey = `download:${provider}:${cleanSlug}:${ep}:${audio}`;

    // --- STEP 1: D1 Download Cache Check (skip for raw pipe stream) ---
    if (!isPipe && env.ANIHUB) {
      try {
        const cached = await env.ANIHUB.prepare(
          `SELECT data FROM stream_cache WHERE key = ?1 AND expires_at > ?2`
        ).bind(cacheKey, Date.now()).first();

        if (cached && typeof cached.data === 'string') {
          const parsed = JSON.parse(cached.data);
          return ok(parsed, { cache: 'public, max-age=300, s-maxage=600' });
        }
      } catch (_) {}
    }

    // --- STEP 2: D1 Metadata & MAL / AniList ID Lookup ---
    let malId = null;
    let anilistId = null;
    let animeTitle = cleanSlug.replace(/[-_]+/g, ' ');
    let resolvedId = cleanSlug;
    const availableProviders = new Set([
      'anikoto',
      'aniwatch',
      'hianime',
      'anipm',
      'hdrezka',
      'hindiflix',
    ]);
    let match = null;

    if (env.ANIHUB) {
      try {
        const redir = await env.ANIHUB.prepare(
          'SELECT to_id FROM anime_redirect WHERE from_id = ?1'
        ).bind(resolvedId).first();
        if (redir?.to_id) resolvedId = redir.to_id;
      } catch {}

      try {
        match = await env.ANIHUB.prepare(`
          SELECT a.id, a.title, a.skip_key_id, a.skip_key_space, a.source_ids,
                 m.mal_id, m.anilist_id, m.kitsu_id,
                 m.anikoto_slug, m.hianime_slug, m.aniwatch_slug
          FROM anime a
          LEFT JOIN anime_id_map m ON a.id = m.anime_id
          WHERE a.id = ?1 OR m.anikoto_slug = ?1 OR m.hianime_slug = ?1 OR lower(a.title) = lower(?1)
          LIMIT 1
        `).bind(resolvedId).first();
      } catch {}

      if (!match) {
        try {
          const candidates = deriveSlugCandidates(resolvedId);
          const found = await findAnimeByCandidates(env.ANIHUB, candidates);
          if (found?.id) {
            resolvedId = found.id;
            match = await env.ANIHUB.prepare(`
              SELECT a.id, a.title, a.skip_key_id, a.skip_key_space, a.source_ids,
                     m.mal_id, m.anilist_id, m.kitsu_id,
                     m.anikoto_slug, m.hianime_slug, m.aniwatch_slug
              FROM anime a
              LEFT JOIN anime_id_map m ON a.id = m.anime_id
              WHERE a.id = ?1
              LIMIT 1
            `).bind(resolvedId).first();
          }
        } catch {}
      }

      if (!match) {
        try {
          const cleanPattern = `%${resolvedId.replace(/[-_]+/g, '%').slice(0, 30)}%`;
          match = await env.ANIHUB.prepare(`
            SELECT a.id, a.title, a.skip_key_id, a.skip_key_space, a.source_ids,
                   m.mal_id, m.anilist_id, m.kitsu_id,
                   m.anikoto_slug, m.hianime_slug, m.aniwatch_slug
            FROM anime a
            LEFT JOIN anime_id_map m ON a.id = m.anime_id
            WHERE a.id LIKE ?1 OR LOWER(a.title) LIKE ?1
            LIMIT 1
          `).bind(cleanPattern).first();
        } catch {}
      }

      if (match) {
        malId = Number(match.mal_id) || resolveMalId(match.source_ids, match.skip_key_id, match.skip_key_space);
        if (match.source_ids) {
          try {
            const parsed = typeof match.source_ids === 'string' ? JSON.parse(match.source_ids) : match.source_ids;
            if (parsed?.anilist) anilistId = Number(parsed.anilist);
            if (!malId && parsed?.mal) malId = Number(parsed.mal);
          } catch {}
        }
        if (!anilistId && match.anilist_id) anilistId = Number(match.anilist_id);
        if (match.title) animeTitle = match.title;
      }
    }

    let downloads = [];
    let downloadPage = null;
    let streamUrl = null;
    let masterUrlToPipe = null;
    let pipeReferer = 'https://megaplay.buzz/';

    // --- STEP 3: Provider-Specific Download Extraction ---
    if (provider === 'anipm') {
      const betaRes = await resolveAniPmBetaDirect({
        anilistId: anilistId || 0,
        ep,
        title: animeTitle,
        slug: cleanSlug,
      }).catch(() => null);

      if (betaRes?.streamUrl) {
        masterUrlToPipe = betaRes.masterUrl || betaRes.streamUrl;
        pipeReferer = 'https://beta.cno.to/';
        streamUrl = betaRes.streamUrl;
        downloads = [
          {
            name: 'AniPM · 1080p (Stream to Video)',
            label: '1080p',
            quality: '1080p',
            url: betaRes.streamUrl,
            proxiedUrl: betaRes.streamUrl,
            pipeUrl: `${url.origin}/api/download?mode=pipe&id=${encodeURIComponent(cleanSlug)}&ep=${ep}&provider=anipm&audio=${audio}&quality=1080p`,
            provider: 'anipm',
            audio,
            type: 'stream-download',
            format: 'TS / MP4',
            referer: 'https://beta.cno.to/',
          },
          {
            name: 'AniPM · 720p (Stream to Video)',
            label: '720p',
            quality: '720p',
            url: betaRes.streamUrl,
            proxiedUrl: betaRes.streamUrl,
            pipeUrl: `${url.origin}/api/download?mode=pipe&id=${encodeURIComponent(cleanSlug)}&ep=${ep}&provider=anipm&audio=${audio}&quality=720p`,
            provider: 'anipm',
            audio,
            type: 'stream-download',
            format: 'TS / MP4',
            referer: 'https://beta.cno.to/',
          },
        ];
      }
      downloadPage = 'https://ani.pm/';

    } else if (provider === 'aniwatch') {
      const aniwatchRes = await resolveAniWatchDirect({
        slug: match?.aniwatch_slug || cleanSlug,
        title: animeTitle,
        ep,
        audio,
        server: 'MGCLD',
      }).catch(() => null);

      if (aniwatchRes?.streamUrl) {
        masterUrlToPipe = aniwatchRes.streamUrl;
        pipeReferer = aniwatchRes.referer || 'https://aniwatch.one/';
        streamUrl = `${url.origin}/api/proxy?url=${encodeURIComponent(aniwatchRes.streamUrl)}&referer=${encodeURIComponent(pipeReferer)}`;
        downloads = [
          {
            name: 'AniWatch · 1080p (Stream to Video)',
            label: '1080p',
            quality: '1080p',
            url: aniwatchRes.streamUrl,
            proxiedUrl: streamUrl,
            pipeUrl: `${url.origin}/api/download?mode=pipe&id=${encodeURIComponent(cleanSlug)}&ep=${ep}&provider=aniwatch&audio=${audio}&quality=1080p`,
            provider: 'aniwatch',
            audio,
            type: 'stream-download',
            format: 'TS / MP4',
            referer: pipeReferer,
          },
          {
            name: 'AniWatch · 720p (Stream to Video)',
            label: '720p',
            quality: '720p',
            url: aniwatchRes.streamUrl,
            proxiedUrl: streamUrl,
            pipeUrl: `${url.origin}/api/download?mode=pipe&id=${encodeURIComponent(cleanSlug)}&ep=${ep}&provider=aniwatch&audio=${audio}&quality=720p`,
            provider: 'aniwatch',
            audio,
            type: 'stream-download',
            format: 'TS / MP4',
            referer: pipeReferer,
          },
        ];
      }

      if (downloads.length === 0 && malId) {
        const directRes = await resolveMegaplayDirect({ malId, ep, audio }).catch(() => null);
        if (directRes?.streamUrl) {
          masterUrlToPipe = directRes.streamUrl;
          pipeReferer = 'https://megaplay.buzz/';
          streamUrl = `${url.origin}/api/proxy?url=${encodeURIComponent(directRes.streamUrl)}&referer=https://megaplay.buzz/`;
          downloads = [
            {
              name: 'AniWatch · 1080p (Stream to Video)',
              label: '1080p',
              quality: '1080p',
              url: directRes.streamUrl,
              proxiedUrl: streamUrl,
              pipeUrl: `${url.origin}/api/download?mode=pipe&id=${encodeURIComponent(cleanSlug)}&ep=${ep}&provider=aniwatch&audio=${audio}&quality=1080p`,
              provider: 'aniwatch',
              audio,
              type: 'stream-download',
              format: 'TS / MP4',
              referer: 'https://megaplay.buzz/',
            },
            {
              name: 'AniWatch · 720p (Stream to Video)',
              label: '720p',
              quality: '720p',
              url: directRes.streamUrl,
              proxiedUrl: streamUrl,
              pipeUrl: `${url.origin}/api/download?mode=pipe&id=${encodeURIComponent(cleanSlug)}&ep=${ep}&provider=aniwatch&audio=${audio}&quality=720p`,
              provider: 'aniwatch',
              audio,
              type: 'stream-download',
              format: 'TS / MP4',
              referer: 'https://megaplay.buzz/',
            },
          ];
        }
      }
      downloadPage = `https://aniwatch.one/watch/${match?.aniwatch_slug || cleanSlug}/episode/${ep}`;

    } else if (provider === 'anikoto') {
      if (malId) {
        downloads = await extractAnikotoDownloads(malId, ep, audio);
      }
      const direct = malId ? await resolveMegaplayDirect({ malId, ep, audio }).catch(() => null) : null;
      if (direct?.streamUrl) {
        masterUrlToPipe = direct.streamUrl;
        pipeReferer = 'https://megaplay.buzz/';
        streamUrl = `${url.origin}/api/proxy?url=${encodeURIComponent(direct.streamUrl)}&referer=https://megaplay.buzz/`;
        if (downloads.length === 0) {
          downloads.push(
            {
              name: 'AniKoto · 1080p (Stream to Video)',
              label: '1080p',
              quality: '1080p',
              url: direct.streamUrl,
              proxiedUrl: streamUrl,
              pipeUrl: `${url.origin}/api/download?mode=pipe&id=${encodeURIComponent(cleanSlug)}&ep=${ep}&provider=anikoto&audio=${audio}&quality=1080p`,
              provider: 'anikoto',
              audio,
              type: 'stream-download',
              format: 'TS / MP4',
              referer: 'https://megaplay.buzz/',
            },
            {
              name: 'AniKoto · 720p (Stream to Video)',
              label: '720p',
              quality: '720p',
              url: direct.streamUrl,
              proxiedUrl: streamUrl,
              pipeUrl: `${url.origin}/api/download?mode=pipe&id=${encodeURIComponent(cleanSlug)}&ep=${ep}&provider=anikoto&audio=${audio}&quality=720p`,
              provider: 'anikoto',
              audio,
              type: 'stream-download',
              format: 'TS / MP4',
              referer: 'https://megaplay.buzz/',
            }
          );
        }
      } else if (!streamUrl) {
        streamUrl = `${url.origin}/api/proxy?url=${encodeURIComponent(`https://megaplay.buzz/stream/mal/${malId || cleanSlug}/${ep}/${audio}`)}&referer=https://megaplay.buzz/`;
      }
      downloadPage = `https://anikoto.cz/watch/${cleanSlug}`;

    } else if (provider === 'hianime') {
      const zokoRes = malId ? await resolveZokoEmbedEdge(`https://zokoanime.video/stream/mal/${malId}/${ep}/${audio}`).catch(() => null) : null;

      if (zokoRes?.masterUrl) {
        masterUrlToPipe = zokoRes.masterUrl;
        pipeReferer = 'https://zokoanime.video/';
        streamUrl = `${url.origin}/api/proxy?url=${encodeURIComponent(zokoRes.masterUrl)}&referer=https://zokoanime.video/`;
        downloads.push(
          {
            name: 'HiAnime · 1080p (Stream to Video)',
            label: '1080p',
            quality: '1080p',
            url: zokoRes.masterUrl,
            proxiedUrl: streamUrl,
            pipeUrl: `${url.origin}/api/download?mode=pipe&id=${encodeURIComponent(cleanSlug)}&ep=${ep}&provider=hianime&audio=${audio}&quality=1080p`,
            provider: 'hianime',
            audio,
            type: 'stream-download',
            format: 'TS / MP4',
            referer: 'https://zokoanime.video/',
          },
          {
            name: 'HiAnime · 720p (Stream to Video)',
            label: '720p',
            quality: '720p',
            url: zokoRes.masterUrl,
            proxiedUrl: streamUrl,
            pipeUrl: `${url.origin}/api/download?mode=pipe&id=${encodeURIComponent(cleanSlug)}&ep=${ep}&provider=hianime&audio=${audio}&quality=720p`,
            provider: 'hianime',
            audio,
            type: 'stream-download',
            format: 'TS / MP4',
            referer: 'https://zokoanime.video/',
          }
        );
      } else {
        const v2Res = await resolveHiAnimeV2Direct({
          slug: match?.hianime_slug || cleanSlug,
          ep,
          audio,
          malId: malId || 0,
        }).catch(() => null);

        if (v2Res?.streamUrl) {
          masterUrlToPipe = v2Res.streamUrl;
          pipeReferer = 'https://megaplay.buzz/';
          streamUrl = `${url.origin}/api/proxy?url=${encodeURIComponent(v2Res.streamUrl)}&referer=https://megaplay.buzz/`;
          downloads.push({
            name: 'HiAnime · 1080p (Stream to Video)',
            label: '1080p',
            quality: '1080p',
            url: v2Res.streamUrl,
            proxiedUrl: streamUrl,
            pipeUrl: `${url.origin}/api/download?mode=pipe&id=${encodeURIComponent(cleanSlug)}&ep=${ep}&provider=hianime&audio=${audio}&quality=1080p`,
            provider: 'hianime',
            audio,
            type: 'stream-download',
            format: 'TS / MP4',
            referer: 'https://megaplay.buzz/',
          });
        } else if (malId) {
          const directFallback = await resolveMegaplayDirect({ malId, ep, audio }).catch(() => null);
          if (directFallback?.streamUrl) {
            masterUrlToPipe = directFallback.streamUrl;
            pipeReferer = 'https://megaplay.buzz/';
            streamUrl = `${url.origin}/api/proxy?url=${encodeURIComponent(directFallback.streamUrl)}&referer=https://megaplay.buzz/`;
            downloads.push({
              name: 'HiAnime · 1080p (Stream to Video)',
              label: '1080p',
              quality: '1080p',
              url: directFallback.streamUrl,
              proxiedUrl: streamUrl,
              pipeUrl: `${url.origin}/api/download?mode=pipe&id=${encodeURIComponent(cleanSlug)}&ep=${ep}&provider=hianime&audio=${audio}&quality=1080p`,
              provider: 'hianime',
              audio,
              type: 'stream-download',
              format: 'TS / MP4',
              referer: 'https://megaplay.buzz/',
            });
          }
        }
      }

      if (malId) {
        const mirrorRes = await extractHianimeDownloads(malId, ep, audio);
        if (mirrorRes.downloads?.length) {
          for (const d of mirrorRes.downloads) {
            downloads.push({
              ...d,
              type: 'portal',
              format: 'Mirror',
              name: `HiAnime · External Mirror (${d.label})`,
            });
          }
        }
        if (mirrorRes.downloadPage) downloadPage = mirrorRes.downloadPage;
      }

      if (!downloadPage) {
        downloadPage = `https://animehot.cc/watch/${cleanSlug}?ep=${ep}`;
      }

    } else if (provider === 'hdrezka') {
      try {
        const tid = await searchRezka(env, animeTitle);
        if (tid) {
          const rezkaData = await hdrezkaMeta(env, tid, 1, ep);
          if (rezkaData?.streams?.length) {
            for (const s of rezkaData.streams) {
              downloads.push({
                name: `HDRezka · ${s.quality} (Direct MP4)`,
                label: s.quality,
                quality: s.quality,
                url: s.url,
                proxiedUrl: `${url.origin}/api/proxy?url=${encodeURIComponent(s.url)}&p=hdrezka`,
                pipeUrl: `${url.origin}/api/download?mode=pipe&id=${encodeURIComponent(cleanSlug)}&ep=${ep}&provider=hdrezka&audio=${audio}&quality=${encodeURIComponent(s.quality)}`,
                provider: 'hdrezka',
                audio,
                type: 'direct',
                format: 'MP4',
              });
            }
            if (downloads[0]) {
              masterUrlToPipe = downloads[0].url;
              streamUrl = downloads[0].proxiedUrl;
            }
          }
        }
      } catch {}
      downloadPage = `https://hdrezka-home.tv/search/?q=${encodeURIComponent(animeTitle)}`;

    } else if (provider === 'hindiflix') {
      try {
        const hfRes = await resolveHindiFlixStream(animeTitle, ep);
        if (hfRes?.streamUrl) {
          masterUrlToPipe = hfRes.streamUrl;
          pipeReferer = 'https://hindiflix.cc/';
          streamUrl = `${url.origin}/api/proxy?url=${encodeURIComponent(hfRes.streamUrl)}&referer=https://hindiflix.cc/`;
          downloads.push({
            name: `HindiFlix · ${hfRes.quality || '1080p'} Hindi Dub (Direct MP4)`,
            label: hfRes.quality || '1080p',
            quality: hfRes.quality || '1080p',
            url: hfRes.streamUrl,
            proxiedUrl: streamUrl,
            pipeUrl: `${url.origin}/api/download?mode=pipe&id=${encodeURIComponent(cleanSlug)}&ep=${ep}&provider=hindiflix&audio=hindi&quality=1080p`,
            provider: 'hindiflix',
            audio: 'hindi',
            type: 'direct',
            format: 'MP4',
            referer: 'https://hindiflix.cc/',
          });
        }
      } catch {}
      downloadPage = `https://hindiflix.cc/?s=${encodeURIComponent(animeTitle)}`;

    } else {
      downloadPage = `https://megaplay.buzz/stream/mal/${malId || cleanSlug}/${ep}/${audio}`;
    }

    // --- Resilient Multi-Provider Fallback Cascade ---
    // If the requested provider produced 0 downloads, check AniPM or MegaPlay so the user gets valid download options
    if (downloads.length === 0) {
      // Fallback attempt A: AniPM Beta
      try {
        const betaFallback = await resolveAniPmBetaDirect({
          anilistId: anilistId || 0,
          ep,
          title: animeTitle,
          slug: cleanSlug,
        });
        if (betaFallback?.streamUrl) {
          if (!masterUrlToPipe) {
            masterUrlToPipe = betaFallback.masterUrl || betaFallback.streamUrl;
            pipeReferer = 'https://beta.cno.to/';
          }
          if (!streamUrl) streamUrl = betaFallback.streamUrl;
          downloads.push({
            name: 'AniPM Mirror · 1080p (Stream to Video)',
            label: '1080p',
            quality: '1080p',
            url: betaFallback.streamUrl,
            proxiedUrl: betaRes?.streamUrl || betaFallback.streamUrl,
            pipeUrl: `${url.origin}/api/download?mode=pipe&id=${encodeURIComponent(cleanSlug)}&ep=${ep}&provider=anipm&audio=${audio}&quality=1080p`,
            provider: 'anipm',
            audio,
            type: 'stream-download',
            format: 'TS / MP4',
            referer: 'https://beta.cno.to/',
          });
        }
      } catch {}

      // Fallback attempt B: MegaPlay
      if (downloads.length === 0 && malId) {
        try {
          const directFallback = await resolveMegaplayDirect({ malId, ep, audio });
          if (directFallback?.streamUrl) {
            if (!masterUrlToPipe) {
              masterUrlToPipe = directFallback.streamUrl;
              pipeReferer = 'https://megaplay.buzz/';
            }
            if (!streamUrl) {
              streamUrl = `${url.origin}/api/proxy?url=${encodeURIComponent(directFallback.streamUrl)}&referer=https://megaplay.buzz/`;
            }
            downloads.push({
              name: 'Fast Mirror · 1080p (Stream to Video)',
              label: '1080p',
              quality: '1080p',
              url: directFallback.streamUrl,
              proxiedUrl: streamUrl,
              pipeUrl: `${url.origin}/api/download?mode=pipe&id=${encodeURIComponent(cleanSlug)}&ep=${ep}&provider=anikoto&audio=${audio}&quality=1080p`,
              provider: 'anikoto',
              audio,
              type: 'stream-download',
              format: 'TS / MP4',
              referer: 'https://megaplay.buzz/',
            });
          }
        } catch {}
      }
    }

    const bridgeBase = env.STREAM_BRIDGE_URL || '';
    if (downloads.length === 0 && bridgeBase) {
      try {
        const bRes = await fetch(`${bridgeBase}/downloads?title=${encodeURIComponent(animeTitle)}&ep=${ep}`);
        if (bRes.ok) {
          const bData = await bRes.json();
          if (Array.isArray(bData?.options)) {
            for (const opt of bData.options) {
              if (opt.provider === provider || !provider) {
                downloads.push({
                  name: opt.name,
                  label: opt.quality || '1080p',
                  quality: opt.quality || '1080p',
                  url: `${url.origin}/api/download?mode=pipe&id=${encodeURIComponent(cleanSlug)}&ep=${ep}&provider=${opt.provider}&audio=${opt.audio || audio}`,
                  proxiedUrl: `${url.origin}/api/download?mode=pipe&id=${encodeURIComponent(cleanSlug)}&ep=${ep}&provider=${opt.provider}&audio=${opt.audio || audio}`,
                  pipeUrl: `${url.origin}/api/download?mode=pipe&id=${encodeURIComponent(cleanSlug)}&ep=${ep}&provider=${opt.provider}&audio=${opt.audio || audio}`,
                  provider: opt.provider,
                  audio: opt.audio || audio,
                  type: 'stream-download',
                  format: opt.format || 'MP4',
                });
              }
            }
          }
        }
      } catch (_) {}
    }

    if (isPipe) {
      if (!masterUrlToPipe && bridgeBase) {
        try {
          const bResolveUrl = `${bridgeBase}/resolve?title=${encodeURIComponent(animeTitle)}&ep=${ep}&provider=${provider}&audio=${audio}`;
          const bRes = await fetch(bResolveUrl, { signal: AbortSignal.timeout(6000) });
          if (bRes.ok) {
            const bData = await bRes.json();
            masterUrlToPipe = bData?.master?.url || bData?.master || bData?.streamUrl;
            if (bData?.referer) pipeReferer = bData.referer;
          }
        } catch (_) {}
      }
      if (!masterUrlToPipe) {
        throw new HttpError(404, 'not_found', `Could not resolve video stream to download for ${provider} episode ${ep}`);
      }
      return await streamEpisodePipe(masterUrlToPipe, pipeReferer, requestedQuality, animeTitle, ep, request);
    }

    const safeTitle = animeTitle.replace(/[^a-zA-Z0-9_-]/g, '_');
    const ytdlpCommand = streamUrl ? `yt-dlp "${streamUrl}" -o "${safeTitle}_EP${ep}.mp4"` : '';
    const isAvailable = downloads.length > 0;
    const errorMsg = isAvailable
      ? null
      : `Episode ${ep} of "${animeTitle}" is not currently available for download on ${provider.toUpperCase()}.`;

    const payload = {
      ok: true,
      data: {
        provider,
        title: animeTitle,
        episode: ep,
        audio,
        malId,
        available: isAvailable,
        error: errorMsg,
        downloads,
        downloadPage,
        streamUrl,
        command: isAvailable ? ytdlpCommand : '',
        availableProviders: Array.from(availableProviders),
      },
    };

    // --- STEP 4: Store in D1 Cache ---
    if (env.ANIHUB && downloads.length > 0) {
      try {
        env.ANIHUB.prepare(
          `INSERT OR REPLACE INTO stream_cache (key, data, expires_at) VALUES (?1, ?2, ?3)`
        ).bind(cacheKey, JSON.stringify(payload), Date.now() + CACHE_TTL_MS).run().catch(() => {});
      } catch (_) {}
    }

    return ok(payload, { cache: 'public, max-age=180, s-maxage=300' });
  } catch (err) {
    return errorResponse(err);
  }
};

export const onRequestHead = onRequestGet;
