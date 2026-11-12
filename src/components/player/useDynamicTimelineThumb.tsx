import { useEffect, useRef, useState, useCallback } from 'react';
import type Hls from 'hls.js';

interface Options {
  streamUrl?: string | null;
  streamKind?: 'progressive' | 'hls' | 'embed' | null;
  duration: number;
  hoverTime: number | null;
  enabled: boolean;
  primaryVideoEl?: HTMLVideoElement | null;
}

const MAX_CACHE_SIZE = 40;

export function useDynamicTimelineThumb({
  streamUrl,
  streamKind,
  duration,
  hoverTime,
  enabled,
  primaryVideoEl,
}: Options) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [isSeeking, setIsSeeking] = useState(false);
  const [hasHovered, setHasHovered] = useState(false);

  const hiddenVideoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cacheRef = useRef<Map<number, string>>(new Map());
  const seekTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSeekRef = useRef<number | null>(null);
  const isMountedRef = useRef(true);

  // Lazy activation: only load secondary media pipeline after user first touches/hovers the timeline
  useEffect(() => {
    if (hoverTime !== null && !hasHovered) {
      setHasHovered(true);
    }
  }, [hoverTime, hasHovered]);

  // Setup media loading on secondary hidden video (lazily initialized)
  useEffect(() => {
    isMountedRef.current = true;
    cacheRef.current.clear();
    setThumbUrl(null);
    setIsSeeking(false);

    const video = hiddenVideoRef.current;
    if (!enabled || !hasHovered || !streamUrl || streamKind === 'embed' || !video) {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      if (video) {
        video.removeAttribute('src');
        video.load();
      }
      return;
    }

    let cancelled = false;

    const setupMedia = async () => {
      const isProgressive = streamKind === 'progressive' || streamUrl.endsWith('.mp4');

      if (isProgressive) {
        video.src = streamUrl;
        video.load();
        return;
      }

      // HLS stream: load lightweight secondary hls.js instance with ultra-lean buffer
      try {
        const { default: HlsCtor } = await import('hls.js');
        if (cancelled || !isMountedRef.current) return;

        if (HlsCtor.isSupported()) {
          const hls = new HlsCtor({
            enableWorker: true,
            lowLatencyMode: false,
            autoStartLoad: true,
            maxBufferLength: 1, // only buffer 1 second for thumbnail scrubbing
            maxMaxBufferLength: 2,
            backBufferLength: 0, // prune all back buffer immediately
            maxBufferSize: 2 * 1024 * 1024, // 2MB memory cap (vs default 60MB)
            startLevel: 0, // lowest bitrate (e.g. 360p) for fastest seeking & minimal network
            testBandwidth: false,
            xhrSetup: (xhr: XMLHttpRequest) => {
              xhr.withCredentials = false;
            },
          });

          hlsRef.current = hls;
          hls.attachMedia(video);
          hls.loadSource(streamUrl);

          hls.on(HlsCtor.Events.MANIFEST_PARSED, (_evt, data) => {
            if (cancelled || !data.levels || data.levels.length === 0) return;
            // Force lowest quality level for fastest seeking
            let minIdx = 0;
            let minH = Infinity;
            data.levels.forEach((lvl, idx) => {
              if (lvl.height && lvl.height < minH) {
                minH = lvl.height;
                minIdx = idx;
              }
            });
            hls.currentLevel = minIdx;
          });

          hls.on(HlsCtor.Events.ERROR, (_evt, data) => {
            if (cancelled || !data.fatal) return;
            // Non-fatal frame extract errors fall back cleanly to fallbackArt
          });
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
          video.src = streamUrl;
          video.load();
        }
      } catch {
        // Fallback gracefully on import or setup errors
      }
    };

    setupMedia();

    return () => {
      cancelled = true;
      isMountedRef.current = false;
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      if (video) {
        video.removeAttribute('src');
        video.load();
      }
    };
  }, [streamUrl, streamKind, enabled, hasHovered]);

  // Network optimization: pause secondary HLS segment fetching when user leaves timeline
  useEffect(() => {
    const hls = hlsRef.current;
    if (!hls) return;
    if (hoverTime === null) {
      hls.stopLoad();
    } else {
      hls.startLoad();
    }
  }, [hoverTime]);

  // Frame capture logic
  const captureFrame = useCallback((targetTime: number, sourceVideo?: HTMLVideoElement | null): boolean => {
    const video = sourceVideo || hiddenVideoRef.current;
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) return false;

    if (!canvasRef.current) {
      canvasRef.current = document.createElement('canvas');
      canvasRef.current.width = 160;
      canvasRef.current.height = 90;
    }

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;

    try {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.6);

      if (isMountedRef.current) {
        const cacheKey = Math.round(targetTime);
        if (cacheRef.current.size >= MAX_CACHE_SIZE) {
          const oldestKey = cacheRef.current.keys().next().value;
          if (oldestKey !== undefined) cacheRef.current.delete(oldestKey);
        }
        cacheRef.current.set(cacheKey, dataUrl);
        setThumbUrl(dataUrl);
        setIsSeeking(false);
        return true;
      }
    } catch {
      // CORS tainted canvas or browser security error — gracefully fall back
    }
    return false;
  }, []);

  // Listen to seeked and loadedmetadata events on hidden video
  useEffect(() => {
    const video = hiddenVideoRef.current;
    if (!video) return;

    const onSeeked = () => {
      const target = pendingSeekRef.current ?? video.currentTime;
      captureFrame(target);
    };

    const onLoadedMetadata = () => {
      if (pendingSeekRef.current !== null && video.readyState >= 1) {
        video.currentTime = pendingSeekRef.current;
      }
    };

    video.addEventListener('seeked', onSeeked);
    video.addEventListener('loadedmetadata', onLoadedMetadata);

    return () => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
    };
  }, [captureFrame]);

  // Debounced seek dispatch triggered by timeline hover
  useEffect(() => {
    if (!enabled || hoverTime === null || duration <= 0) return;

    const roundedT = Math.round(hoverTime);
    const clampedT = Math.max(0, Math.min(hoverTime, duration));

    // 1. Instant cache hit
    if (cacheRef.current.has(roundedT)) {
      setThumbUrl(cacheRef.current.get(roundedT)!);
      setIsSeeking(false);
      return;
    }

    // 2. Instant capture from primary video if hovering within 2.5s of current playback
    if (primaryVideoEl && Math.abs(clampedT - primaryVideoEl.currentTime) <= 2.5) {
      const captured = captureFrame(roundedT, primaryVideoEl);
      if (captured) return;
    }

    setIsSeeking(true);

    if (seekTimerRef.current) {
      clearTimeout(seekTimerRef.current);
    }

    // 3. Debounced seek on secondary hidden video (90ms)
    seekTimerRef.current = setTimeout(() => {
      const video = hiddenVideoRef.current;
      if (!video) return;

      pendingSeekRef.current = clampedT;
      if (video.readyState >= 1) {
        try {
          video.currentTime = clampedT;
        } catch {
          setIsSeeking(false);
        }
      }
    }, 90);

    return () => {
      if (seekTimerRef.current) {
        clearTimeout(seekTimerRef.current);
      }
    };
  }, [hoverTime, duration, enabled, primaryVideoEl, captureFrame]);

  // Offscreen fixed position (with non-zero opacity) forces Chromium GPU layout & decoding
  const hiddenVideoElement = enabled && hasHovered ? (
    <video
      ref={hiddenVideoRef}
      style={{
        position: 'fixed',
        top: '-9999px',
        left: '-9999px',
        width: '160px',
        height: '90px',
        opacity: 0.001,
        pointerEvents: 'none',
        zIndex: -9999,
      }}
      muted
      playsInline
      preload="auto"
      crossOrigin="anonymous"
      aria-hidden="true"
    />
  ) : null;

  return {
    thumbUrl,
    isSeeking,
    hiddenVideoElement,
  };
}
