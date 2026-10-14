/* ============================================================
   Stream server registry.

   One entry: AniKoto. It is the real integration — every request
   goes to the AniKoto bridge (api/bridge.mjs), which resolves the
   episode and proxies the provider's playlist, segments and
   captions. The browser reaches it on loopback when it runs on
   the same machine, and through the public tunnel otherwise.
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

/**
 * The real source: every request goes to the AniKoto bridge
 * (api/bridge.mjs), which resolves the episode and proxies the
 * provider's playlist, segments and captions.
 */
export const LIVE_SERVER: StreamServer = {
  id: 'anikoto-live',
  name: 'AniKoto',
  region: 'Bridge (this machine / tunnel)',
  status: 'online',
  capabilities: {
    qualities: ['auto', '1080p'],
    /* Caption tracks are read live from each resolved stream (useLiveStream.subTracks), so no
       static list here drives the subtitle UI — AniKoto serves selectable multi-language VTT. */
    subtitleLanguages: [],
    subtitleType: 'selectable',
    /* The original always plays; a dub is offered only when the bridge proves a second audio. */
    audioLanguages: ['Japanese (original)', 'English (dub, only when the source really carries one)'],
  },
  sourceUrl: 'http://127.0.0.1:8795',
  responseMs: 0,
  note: 'Real playback through the AniKoto bridge — it resolves the episode and proxies the stream; the player reports whether the bridge answers.',
};

export const SERVERS: StreamServer[] = [LIVE_SERVER];

export const serverById = (id: string): StreamServer =>
  SERVERS.find((s) => s.id === id) ?? SERVERS[0];

export const SERVER_STATUS_LABEL: Record<ServerStatus, string> = {
  online: 'Available',
  degraded: 'Slow',
  unavailable: 'Unavailable',
};
