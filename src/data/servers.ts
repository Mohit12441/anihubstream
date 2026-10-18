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

export const SERVERS: StreamServer[] = [
  AUTO_SERVER,
  ANIWATCH_SERVER,
  HIANIME_SERVER,
  LIVE_SERVER,
  ANIMEDUBHINDI_SERVER,
  ANIMEWAVE_SERVER,
  ANIMEKAI_SERVER,
];

export const serverById = (id: string): StreamServer =>
  SERVERS.find((s) => s.id === id) ?? SERVERS[0];

export function providerFromId(serverId: string): string {
  if (serverId === 'auto-fastest') return 'auto';
  if (serverId === 'aniwatch-live') return 'aniwatch';
  if (serverId === 'hianime-live') return 'hianime';
  if (serverId === 'anikoto-live') return 'anikoto';
  if (serverId === 'animedubhindi-live') return 'animedubhindi';
  if (serverId === 'animewave-live') return 'animewave';
  if (serverId === 'animekai-live') return 'animekai';
  return 'auto';
}

export function serverIdFromProvider(provider?: string): string {
  if (!provider) return 'auto-fastest';
  const norm = provider.toLowerCase();
  if (norm === 'aniwatch') return 'aniwatch-live';
  if (norm === 'hianime') return 'hianime-live';
  if (norm === 'anikoto') return 'anikoto-live';
  if (norm === 'animedubhindi') return 'animedubhindi-live';
  if (norm === 'animewave') return 'animewave-live';
  if (norm === 'animekai') return 'animekai-live';
  return 'auto-fastest';
}

export const SERVER_STATUS_LABEL: Record<ServerStatus, string> = {
  online: 'Available',
  degraded: 'Slow',
  unavailable: 'Unavailable',
};
