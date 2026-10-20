/* ============================================================
   Stream server registry.

   Multi-provider integration with real-time latency racing:
   Auto (Fastest) concurrently races AniWatch, HiAnime, AniKoto,
   and AnimeDubHindi, connecting to whichever proves a playable
   stream fastest. Specific servers can also be selected manually.
   ============================================================ */

import type { QualityId } from '../lib/playerPrefs';

export type ServerStatus = 'online' | 'degraded' | 'unavailable';

export interface ServerCapabilities {
  qualities: QualityId[];
  subtitleLanguages: string[];
  /** hardsubbed = captions burned into the picture, not selectable */
  subtitleType: 'selectable' | 'hardsub' | 'none';
  audioLanguages: string[];
}

export interface StreamServer {
  id: string;
  name: string;
  region: string;
  status: ServerStatus;
  capabilities: ServerCapabilities;
  /** Real playback source; null until a provider is integrated. */
  sourceUrl: string | null;
  /** Illustrative latency for the prototype — not a measured network value. */
  responseMs: number;
  note: string;
}

export const AUTO_SERVER: StreamServer = {
  id: 'auto-fastest',
  name: 'Auto (Fastest)',
  region: 'Smart Edge Race (Lowest Latency)',
  status: 'online',
  capabilities: {
    qualities: ['auto', '1080p', '720p', '480p', '360p'],
    subtitleLanguages: [],
    subtitleType: 'selectable',
    audioLanguages: ['Auto (Sub, Dub & Multi-Audio)'],
  },
  sourceUrl: 'http://127.0.0.1:8795',
  responseMs: 0,
  note: 'Races all streaming providers concurrently and automatically connects to whichever resolves and streams fastest.',
};

export const ANIWATCH_SERVER: StreamServer = {
  id: 'aniwatch-live',
  name: 'AniWatch',
  region: 'Global CDN (Ultra-Fast)',
  status: 'online',
  capabilities: {
    qualities: ['auto', '1080p'],
    subtitleLanguages: [],
    subtitleType: 'selectable',
    audioLanguages: ['Japanese (original)', 'English (dub)'],
  },
  sourceUrl: 'http://127.0.0.1:8795',
  responseMs: 0,
  note: 'Fastest Megaplay CDN with direct REST endpoints and multi-language subtitle tracks.',
};

export const HIANIME_SERVER: StreamServer = {
  id: 'hianime-live',
  name: 'HiAnime',
  region: 'Multi-Quality (1080p / 360p)',
  status: 'online',
  capabilities: {
    qualities: ['auto', '1080p', '360p'],
    subtitleLanguages: [],
    subtitleType: 'selectable',
    audioLanguages: ['Japanese (original)', 'English (dub)'],
  },
  sourceUrl: 'http://127.0.0.1:8795',
  responseMs: 0,
  note: 'High-speed JSON API with selectable quality rungs (1080p and 360p) and multi-audio support.',
};

export const LIVE_SERVER: StreamServer = {
  id: 'anikoto-live',
  name: 'AniKoto',
  region: 'Subtitles & Intro Skip',
  status: 'online',
  capabilities: {
    qualities: ['auto', '1080p'],
    subtitleLanguages: [],
    subtitleType: 'selectable',
    audioLanguages: ['Japanese (original)', 'English (dub)'],
  },
  sourceUrl: 'http://127.0.0.1:8795',
  responseMs: 0,
  note: 'Full-featured AniKoto integration with intro/outro timestamps and 9 subtitle tracks.',
};

export const ANIMEDUBHINDI_SERVER: StreamServer = {
  id: 'animedubhindi-live',
  name: 'AnimeDubHindi',
  region: 'Hindi Dub (Multi-Audio)',
  status: 'online',
  capabilities: {
    qualities: ['auto', '1080p', '720p', '480p'],
    subtitleLanguages: [],
    subtitleType: 'none',
    audioLanguages: ['Hindi (dub)', 'Multi Audio (Hindi, Tamil, Telugu, English, Japanese)'],
  },
  sourceUrl: 'http://127.0.0.1:8795',
  responseMs: 0,
  note: 'Real Hindi dub and multi-audio playback through AnimeDubHindi via progressive streaming.',
};

export const ANIMEWAVE_SERVER: StreamServer = {
  id: 'animewave-live',
  name: 'AnimeWave',
  region: 'Mirror Backup 1',
  status: 'online',
  capabilities: {
    qualities: ['auto', '1080p'],
    subtitleLanguages: [],
    subtitleType: 'selectable',
    audioLanguages: ['Japanese (original)', 'English (dub)'],
  },
  sourceUrl: 'http://127.0.0.1:8795',
  responseMs: 0,
  note: 'Failover mirror with comprehensive seasonal anime catalogue.',
};

export const ANIMEKAI_SERVER: StreamServer = {
  id: 'animekai-live',
  name: 'AnimeKai',
  region: 'Mirror Backup 2',
  status: 'online',
  capabilities: {
    qualities: ['auto', '1080p'],
    subtitleLanguages: [],
    subtitleType: 'selectable',
    audioLanguages: ['Japanese (original)', 'English (dub)'],
  },
  sourceUrl: 'http://127.0.0.1:8795',
  responseMs: 0,
  note: 'Failover mirror with dedicated dual-audio stream branches.',
};

export const WATCHANIMEWORLD_SERVER: StreamServer = {
  id: 'watchanimeworld-live',
  name: 'WatchAnimeWorld',
  region: 'Abyss Direct MP4',
  status: 'online',
  capabilities: {
    qualities: ['auto', '1080p', '720p', '360p'],
    subtitleLanguages: [],
    subtitleType: 'none',
    audioLanguages: ['English (dub)'],
  },
  sourceUrl: 'http://127.0.0.1:8795',
  responseMs: 0,
  note: 'Direct encrypted MP4 stream stitched on-the-fly from Abyss CDN parts.',
};

export const SERVERS: StreamServer[] = [
  LIVE_SERVER,
  ANIWATCH_SERVER,
  HIANIME_SERVER,
  ANIMEDUBHINDI_SERVER,
  WATCHANIMEWORLD_SERVER,
  ANIMEWAVE_SERVER,
  ANIMEKAI_SERVER,
];

export const serverById = (id: string): StreamServer => {
  if (id.startsWith('anikoto:')) {
    const mirror = id.slice('anikoto:'.length);
    return {
      ...LIVE_SERVER,
      id,
      name: `AniKoto · ${mirror}`,
      note: `AniKoto ${mirror} mirror server`,
    };
  }
  return SERVERS.find((s) => s.id === id) ?? LIVE_SERVER;
};

export function providerFromId(serverId: string): string {
  if (!serverId || serverId === 'auto-fastest') return 'anikoto';
  const clean = serverId.trim();
  const lower = clean.toLowerCase();

  // If serverId is in "provider:server" format (e.g. anikoto:HD-1, hianime:HD-1, hianime:MegaPlay, aniwatch:HD-1)
  if (lower.includes(':')) {
    const prov = lower.split(':')[0];
    if (['aniwatch', 'hianime', 'anikoto', 'animedubhindi', 'watchanimeworld', 'animewave', 'animekai'].includes(prov)) {
      return prov;
    }
  }

  // Handle provider-server format (e.g. hianime-1, hianime-2, aniwatch-1)
  for (const prov of ['hianime', 'aniwatch', 'anikoto', 'animedubhindi', 'watchanimeworld', 'animewave', 'animekai']) {
    if (lower === `${prov}-live` || lower === prov) {
      return prov;
    }
    if (lower.startsWith(`${prov}-`)) {
      return prov;
    }
  }

  return clean;
}

export function serverIdFromProvider(provider?: string): string {
  if (!provider) return 'anikoto:HD-1';
  if (provider.includes(':')) return provider;
  const norm = provider.toLowerCase();
  if (norm === 'hianime') return 'hianime:HD-1';
  if (norm === 'anikoto') return 'anikoto:HD-1';
  if (norm === 'aniwatch') return 'aniwatch:HD-1';
  if (norm === 'animedubhindi') return 'animedubhindi:default';
  if (norm === 'watchanimeworld') return 'watchanimeworld:default';
  return `${norm}:HD-1`;
}

export const SERVER_STATUS_LABEL: Record<ServerStatus, string> = {
  online: 'Available',
  degraded: 'Slow',
  unavailable: 'Unavailable',
};
