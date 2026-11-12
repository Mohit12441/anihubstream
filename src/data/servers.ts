/* ============================================================
   Stream server registry.

   Multi-provider integration with real-time latency racing:
   Auto (Fastest) concurrently races AniWatch, HiAnime, AniKoto,
   connecting to whichever proves a playable
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

export const ANIPM_SERVER: StreamServer = {
  id: 'anipm-live',
  name: 'AniPM',
  region: 'Settlar High-Speed HLS',
  status: 'online',
  capabilities: {
    qualities: ['auto', '1080p', '720p'],
    subtitleLanguages: [],
    subtitleType: 'selectable',
    audioLanguages: ['Japanese (original)', 'English (dub)'],
  },
  sourceUrl: 'http://127.0.0.1:8795',
  responseMs: 0,
  note: 'Open partner Settlar session stream with precise skip intervals.',
};

export const SERVERS: StreamServer[] = [
  LIVE_SERVER,
  ANIWATCH_SERVER,
  HIANIME_SERVER,
  ANIPM_SERVER,
];

const ALL_PROVIDER_IDS = [
  'aniwatch',
  'hianime',
  'anikoto',
  'anipm',
];

export function providerFromId(serverId: string): string {
  if (!serverId || serverId === 'auto-fastest') return 'anikoto';
  const clean = serverId.trim();
  const lower = clean.toLowerCase();

  // If serverId is in "provider:server" format
  if (lower.includes(':')) {
    const prov = lower.split(':')[0];
    if (ALL_PROVIDER_IDS.includes(prov)) {
      return prov;
    }
  }

  // Handle provider-server format (e.g. hianime-1, hianime-2, aniwatch-1)
  for (const prov of ALL_PROVIDER_IDS) {
    if (lower === `${prov}-live` || lower === prov) {
      return prov;
    }
    if (lower.startsWith(`${prov}-`)) {
      return prov;
    }
  }

  return ALL_PROVIDER_IDS.includes(lower) ? lower : 'anikoto';
}

export function serverIdFromProvider(provider?: string, audio?: string): string {
  const isDub = (audio || '').toLowerCase() === 'dub';
  if (!provider) return isDub ? 'anikoto:HD-1-dub' : 'anikoto:HD-1';
  if (provider.includes(':')) return provider;
  const norm = provider.toLowerCase();
  if (norm === 'hianime') return isDub ? 'hianime:HD-1-dub' : 'hianime:HD-1';
  if (norm === 'anikoto') return isDub ? 'anikoto:HD-1-dub' : 'anikoto:HD-1';
  if (norm === 'aniwatch') return isDub ? 'aniwatch:HD-1-dub' : 'aniwatch:HD-1';
  if (norm === 'anipm') return isDub ? 'anipm:settlar-dub' : 'anipm:beta';
  return isDub ? `${norm}:HD-1-dub` : `${norm}:HD-1`;
}

export const SERVER_STATUS_LABEL: Record<ServerStatus, string> = {
  online: 'Available',
  degraded: 'Slow',
  unavailable: 'Unavailable',
};
