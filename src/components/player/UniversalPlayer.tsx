import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import Hls from 'hls.js';
import {
  AlertCircle,
  Loader2,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  RotateCcw,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { PlayerInput, SubtitleTrack } from './PlayerInput';

export interface UniversalPlayerRef {
  seek: (seconds: number) => void;
  play: () => Promise<void>;
  pause: () => void;
  currentTime: () => number;
  duration: () => number;
  videoElement: () => HTMLVideoElement | null;
}

export interface UniversalPlayerProps {
  input: PlayerInput;
  autoPlay?: boolean;
  theatre?: boolean;
  onTimeUpdate?: (currentTime: number, duration: number) => void;
  onDuration?: (duration: number) => void;
  onEnded?: () => void;
  onError?: (error: Error) => void;
  onSeeked?: (currentTime: number) => void;
  className?: string;
}

export const UniversalPlayer = forwardRef<UniversalPlayerRef, UniversalPlayerProps>(
  (
    {
      input,
      autoPlay = true,
      theatre = false,
      onTimeUpdate,
      onDuration,
      onEnded,
      onError,
      onSeeked,
      className = '',
    },
    ref
  ) => {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const hlsRef = useRef<Hls | null>(null);
    const containerRef = useRef<HTMLDivElement | null>(null);

    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [volume, setVolume] = useState(1);
    const [isMuted, setIsMuted] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [activeFallbackIndex, setActiveFallbackIndex] = useState(-1);

    // Imperative ref methods for parent controllers
    useImperativeHandle(
      ref,
      () => ({
        seek: (seconds: number) => {
          if (videoRef.current) {
            const clamped = Math.max(0, Math.min(seconds, videoRef.current.duration || seconds));
            videoRef.current.currentTime = clamped;
            if (onSeeked) onSeeked(clamped);
          }
        },
        play: async () => {
          if (videoRef.current) {
            await videoRef.current.play().catch(() => {});
          }
        },
        pause: () => {
          if (videoRef.current) {
            videoRef.current.pause();
          }
        },
        currentTime: () => videoRef.current?.currentTime ?? 0,
        duration: () => videoRef.current?.duration ?? 0,
        videoElement: () => videoRef.current,
      }),
      [onSeeked]
    );

    // Source swapping and HLS instance management
    useEffect(() => {
      const video = videoRef.current;
      if (!video) return;

      setIsLoading(true);
      setErrorMessage(null);
      setActiveFallbackIndex(-1);

      const targetSrc = input?.src || '';
      if (!targetSrc || targetSrc.startsWith('/api/play/resolve')) {
        setIsLoading(true);
        return;
      }

      const isHls = input.type === 'hls' || targetSrc.includes('.m3u8');

      // Cleanup prior HLS instance
      if (hlsRef.current) {
        hlsRef.current.stopLoad();
        hlsRef.current.destroy();
        hlsRef.current = null;
      }

      if (isHls && Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true,
          maxBufferLength: 60,
          maxMaxBufferLength: 120,
          liveSyncDurationCount: 3,
        });

        hls.loadSource(targetSrc);
        hls.attachMedia(video);

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          setIsLoading(false);
          if (input.startTime > 0) {
            video.currentTime = input.startTime;
          }
          if (autoPlay) {
            video.play().catch(() => {
              // Browser policy fallback: try muted autoplay if audio-unmuted play is blocked
              video.muted = true;
              setIsMuted(true);
              video.play().catch(() => {
                setIsPlaying(false);
              });
            });
          }
        });

        hls.on(Hls.Events.ERROR, (_, data) => {
          if (data.fatal) {
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                // Attempt network error recovery or fallback cascade
                if (input.fallbackUrls && input.fallbackUrls.length > 0 && activeFallbackIndex < input.fallbackUrls.length - 1) {
                  const nextIdx = activeFallbackIndex + 1;
                  setActiveFallbackIndex(nextIdx);
                  const fallbackUrl = input.fallbackUrls[nextIdx];
                  hls.loadSource(fallbackUrl);
                  hls.startLoad();
                } else {
                  hls.startLoad();
                }
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                hls.recoverMediaError();
                break;
              default:
                hls.destroy();
                setErrorMessage('Stream playback error. Please try another server.');
                if (onError) onError(new Error(data.details));
                break;
            }
          }
        });

        hlsRef.current = hls;
      } else {
        // Native MP4 / Safari native HLS
        video.src = targetSrc;
        const handleLoadedMetadata = () => {
          setIsLoading(false);
          if (input.startTime > 0) {
            video.currentTime = input.startTime;
          }
          if (autoPlay) {
            void video.play().catch(() => {
              setIsPlaying(false);
            });
          }
        };

        video.addEventListener('loadedmetadata', handleLoadedMetadata, { once: true });
      }

      return () => {
        if (hlsRef.current) {
          hlsRef.current.stopLoad();
          hlsRef.current.destroy();
          hlsRef.current = null;
        }
      };
    }, [input.src, input.type, input.startTime, autoPlay, input.fallbackUrls, onError, activeFallbackIndex]);

    // Video playback event listeners
    const handleTimeUpdate = useCallback(() => {
      if (!videoRef.current) return;
      const cur = videoRef.current.currentTime;
      const dur = videoRef.current.duration || 0;
      setCurrentTime(cur);
      if (dur > 0 && dur !== duration) {
        setDuration(dur);
        if (onDuration) onDuration(dur);
      }
      if (onTimeUpdate) onTimeUpdate(cur, dur);
    }, [duration, onDuration, onTimeUpdate]);

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleWaiting = () => setIsLoading(true);
    const handlePlaying = () => setIsLoading(false);
    const handleEnded = () => {
      setIsPlaying(false);
      if (onEnded) onEnded();
    };

    const togglePlay = () => {
      if (!videoRef.current) return;
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        void videoRef.current.play().catch(() => {});
      }
    };

    const toggleMute = () => {
      if (!videoRef.current) return;
      const nextMuted = !isMuted;
      videoRef.current.muted = nextMuted;
      setIsMuted(nextMuted);
    };

    const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!videoRef.current) return;
      const val = Number.parseFloat(e.target.value);
      videoRef.current.volume = val;
      setVolume(val);
      if (val === 0) {
        videoRef.current.muted = true;
        setIsMuted(true);
      } else if (isMuted) {
        videoRef.current.muted = false;
        setIsMuted(false);
      }
    };

    const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!videoRef.current) return;
      const target = Number.parseFloat(e.target.value);
      videoRef.current.currentTime = target;
      setCurrentTime(target);
      if (onSeeked) onSeeked(target);
    };

    const toggleFullscreen = async () => {
      if (!containerRef.current) return;
      if (!document.fullscreenElement) {
        await containerRef.current.requestFullscreen().catch(() => {});
        setIsFullscreen(true);
      } else {
        await document.exitFullscreen().catch(() => {});
        setIsFullscreen(false);
      }
    };

    const formatTime = (secs: number) => {
      if (!Number.isFinite(secs) || secs < 0) return '0:00';
      const m = Math.floor(secs / 60);
      const s = Math.floor(secs % 60);
      return `${m}:${s < 10 ? '0' : ''}${s}`;
    };

    return (
      <div
        ref={containerRef}
        className={`universal-player ${theatre ? 'universal-player--theatre' : ''} ${className}`}
        style={{
          position: 'relative',
          backgroundColor: '#000',
          width: '100%',
          aspectRatio: '16 / 9',
          overflow: 'hidden',
          borderRadius: theatre ? '0px' : '12px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        }}
      >
        <video
          ref={videoRef}
          playsInline
          style={{ width: '100%', height: '100%', display: 'block', objectFit: 'contain' }}
          onTimeUpdate={handleTimeUpdate}
          onPlay={handlePlay}
          onPause={handlePause}
          onWaiting={handleWaiting}
          onPlaying={handlePlaying}
          onEnded={handleEnded}
        >
          {input.subtitles.map((track: SubtitleTrack) => (
            <track
              key={track.id}
              kind="subtitles"
              label={track.label}
              srcLang={track.language}
              src={track.url}
              default={track.default}
            />
          ))}
        </video>

        {/* Loading Spinner */}
        {isLoading && !errorMessage && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: 'rgba(0,0,0,0.3)',
              pointerEvents: 'none',
            }}
          >
            <Loader2 size={48} className="animate-spin" style={{ color: 'var(--brand, #6366f1)' }} />
          </div>
        )}

        {/* Error Overlay */}
        {errorMessage && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: 'rgba(10, 10, 15, 0.95)',
              color: '#fff',
              padding: '24px',
              textAlign: 'center',
            }}
          >
            <AlertCircle size={44} style={{ color: '#ef4444', marginBottom: '12px' }} />
            <h3 style={{ fontSize: '1.2rem', fontWeight: 600, margin: '0 0 8px 0' }}>Playback Issue</h3>
            <p style={{ opacity: 0.8, maxWidth: '420px', margin: '0 0 16px 0', fontSize: '0.9rem' }}>
              {errorMessage}
            </p>
            <button
              type="button"
              onClick={() => {
                setErrorMessage(null);
                if (videoRef.current) {
                  videoRef.current.load();
                  void videoRef.current.play().catch(() => {});
                }
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 16px',
                borderRadius: '8px',
                background: 'var(--brand, #6366f1)',
                color: '#fff',
                border: 'none',
                cursor: 'pointer',
                fontWeight: 500,
              }}
            >
              <RotateCcw size={16} /> Retry Playback
            </button>
          </div>
        )}

        {/* Basic Overlay Controls */}
        <div
          className="universal-player__controls"
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            padding: '16px 20px',
            background: 'linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0) 100%)',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            transition: 'opacity 0.2s ease',
          }}
        >
          {/* Timeline Bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', width: '100%' }}>
            <input
              type="range"
              min={0}
              max={duration || 100}
              value={currentTime}
              onChange={handleSeek}
              style={{
                flex: 1,
                accentColor: 'var(--brand, #6366f1)',
                cursor: 'pointer',
                height: '4px',
              }}
              aria-label="Seek timeline"
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <button
                type="button"
                onClick={togglePlay}
                style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: '4px' }}
                aria-label={isPlaying ? 'Pause' : 'Play'}
              >
                {isPlaying ? <Pause size={20} /> : <Play size={20} />}
              </button>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  type="button"
                  onClick={toggleMute}
                  style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: '4px' }}
                  aria-label={isMuted ? 'Unmute' : 'Mute'}
                >
                  {isMuted || volume === 0 ? <VolumeX size={20} /> : <Volume2 size={20} />}
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={isMuted ? 0 : volume}
                  onChange={handleVolumeChange}
                  style={{ width: '60px', accentColor: 'var(--brand, #6366f1)', cursor: 'pointer' }}
                  aria-label="Volume slider"
                />
              </div>

              <span style={{ fontSize: '0.85rem', color: '#e2e8f0', fontFamily: 'monospace' }}>
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <button
                type="button"
                onClick={toggleFullscreen}
                style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: '4px' }}
                aria-label={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
              >
                {isFullscreen ? <Minimize2 size={20} /> : <Maximize2 size={20} />}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
);

UniversalPlayer.displayName = 'UniversalPlayer';
