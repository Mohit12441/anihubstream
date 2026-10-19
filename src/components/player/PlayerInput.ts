/**
 * Layer 2: Player Input Adapter
 *
 * Pure TypeScript contract that maps backend Layer 1 server payloads into
 * strict Layer 3 PlayerInput objects.
 *
 * Deterministic, unit-testable, with zero UI or network dependencies.
 */

export interface SubtitleTrack {
  id: string;
  language: string;
  label: string;
  url: string;
  default?: boolean;
}

export interface AudioTrack {
  id: string;
  language: string;
  label: string;
  default?: boolean;
  streamUrl?: string;
}

export interface SkipInterval {
  start: number;
  end: number;
  label: string;
}

export interface AniSkipData {
  op: SkipInterval | null;
  ed: SkipInterval | null;
  recap: SkipInterval | null;
}

export interface DownloadOption {
  name: string;
  quality: string;
  url: string;
}

export interface PlayServer {
  id: string;
  name: string;
  provider: string;
  status: 'ready' | 'loading' | 'error';
  streamUrl: string;
  type: 'hls' | 'mp4' | 'embed';
  quality?: string;
  audio?: string;
  audioTracks?: AudioTrack[];
  subtitles?: SubtitleTrack[];
  downloads?: DownloadOption[];
  fallbackUrls?: string[];
}

export interface Layer1PlayResponse {
  title: string;
  episode: number;
  malId?: number | null;
  servers: PlayServer[];
  aniskip?: AniSkipData | null;
}

export interface PlayerInput {
  src: string;
  type: 'hls' | 'mp4' | 'embed';
  title?: string;
  episodeNumber?: number;
  startTime: number;
  quality?: string;
  audio?: string;
  audioTracks: AudioTrack[];
  subtitles: SubtitleTrack[];
  aniskip?: AniSkipData;
  fallbackUrls: string[];
  provider: string;
  serverId: string;
}

/**
 * Transforms a PlayServer and AniSkip payload into a normalized PlayerInput.
 */
export function toPlayerInput(
  server: PlayServer,
  aniskip?: AniSkipData | null,
  startTime: number = 0,
  title?: string,
  episodeNumber?: number
): PlayerInput {
  const subtitles: SubtitleTrack[] = Array.isArray(server.subtitles)
    ? server.subtitles.map((sub, idx) => ({
        id: sub.id || `sub-${idx}`,
        language: sub.language || 'en',
        label: sub.label || 'English',
        url: sub.url,
        default: sub.default ?? idx === 0,
      }))
    : [];

  const audioTracks: AudioTrack[] = Array.isArray(server.audioTracks) && server.audioTracks.length > 0
    ? server.audioTracks
    : [
        {
          id: server.audio === 'hindi' ? 'hin' : server.audio === 'dub' ? 'en' : 'ja',
          language: server.audio === 'hindi' ? 'hi' : server.audio === 'dub' ? 'en' : 'ja',
          label: server.audio === 'hindi' ? 'Hindi' : server.audio === 'dub' ? 'English Dub' : 'Japanese (Original)',
          default: true,
        },
      ];

  const fallbackUrls: string[] = Array.isArray(server.fallbackUrls) ? [...server.fallbackUrls] : [];

  return {
    src: server.streamUrl,
    type: server.type || 'hls',
    title,
    episodeNumber,
    startTime: Math.max(0, startTime),
    quality: server.quality || '1080p',
    audio: server.audio || 'sub',
    audioTracks,
    subtitles,
    aniskip: aniskip ?? undefined,
    fallbackUrls,
    provider: server.provider || 'unknown',
    serverId: server.id,
  };
}
