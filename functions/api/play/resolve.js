// @ts-check
import { HttpError, errorResponse, ok } from '../_lib.js';

const BRIDGE_TIMEOUT_MS = 25_000;

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
  return serverId && serverId !== 'default' ? `${base} · ${serverId}` : base;
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

/**
 * Lazy Server Stream Resolution Endpoint
 * Resolves a specific secondary server on demand when requested by the frontend player.
 *
 * GET /api/play/resolve?title=<title>&ep=<ep>&audio=<audio>&provider=<prov>&server=<server>
 */
export const onRequestGet = async ({ request, env }) => {
  try {
    const url = new URL(request.url);
    const title = (url.searchParams.get('title') || url.searchParams.get('id') || url.searchParams.get('slug') || '').trim();
    const ep = Math.max(1, Number.parseInt(url.searchParams.get('ep') ?? '1', 10) || 1);
    const audio = url.searchParams.get('audio') === 'hindi' ? 'hindi' : url.searchParams.get('audio') === 'dub' ? 'dub' : 'sub';
    const provider = url.searchParams.get('provider') || 'auto';
    const serverParam = url.searchParams.get('server') || '';

    if (!title) {
      throw new HttpError(400, 'bad_request', 'title query parameter is required');
    }

    const bridgeBase = env.STREAM_BRIDGE_URL || 'https://bridge.anihubstream.com';

    const resolveUrl = new URL(`${bridgeBase}/resolve`);
    resolveUrl.searchParams.set('title', title);
    resolveUrl.searchParams.set('ep', String(ep));
    resolveUrl.searchParams.set('audio', audio);
    if (provider) resolveUrl.searchParams.set('provider', provider);
    if (serverParam) resolveUrl.searchParams.set('server', serverParam);

    let bridgeRes;
    try {
      const res = await fetch(resolveUrl.toString(), {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(BRIDGE_TIMEOUT_MS),
      });
      if (!res.ok) {
        throw new HttpError(res.status === 404 ? 404 : 502, 'provider_error', `Upstream bridge returned ${res.status}`);
      }
      bridgeRes = await res.json();
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(504, 'upstream_timeout', 'Stream bridge resolution timed out');
    }

    if (!bridgeRes || (!bridgeRes.master && !bridgeRes.streamUrl)) {
      throw new HttpError(502, 'provider_error', 'No playable stream returned by provider');
    }

    const meta = bridgeRes;
    const prov = meta.provider || provider;
    const masterPath = meta.master || meta.streamUrl || '';
    const streamUrl = masterPath.startsWith('http') ? masterPath : `${bridgeBase}${masterPath}`;

    const subtitles = (meta.subtitles || []).map((sub, idx) => ({
      id: `sub-${idx}`,
      language: sub.language || 'en',
      label: sub.name || sub.language?.toUpperCase() || 'English',
      url: sub.url?.startsWith('http') ? sub.url : `${bridgeBase}${sub.url}`,
      default: idx === 0,
    }));

    const downloads = (meta.downloads || []).map((dl) => ({
      name: dl.name || dl.quality || 'Download',
      quality: dl.quality || '1080p',
      url: dl.url?.startsWith('http') ? dl.url : `${bridgeBase}${dl.url}`,
    }));

    const resolvedServer = {
      id: `${prov}:${serverParam || 'HD-1'}`,
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

    return ok({ server: resolvedServer }, { cache: 'public, max-age=600, s-maxage=1800' });
  } catch (err) {
    return errorResponse(err);
  }
};
