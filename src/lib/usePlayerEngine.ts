/* ============================================================
   usePlayerEngine — playback clock.

   The engine mirrors the real media element hls.js feeds through
   the AniKoto bridge: time, playing state, buffer band and end
   detection all come from the <video>. While the bridge resolves
   (or is unreachable) the caller passes a hold controller, so the
   clock parks at the resume point instead of advancing.
   ============================================================ */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Marker } from '../data/model';

/** What the engine consumes from a real media element (see useLiveStream). */
export interface LiveController {
  play: () => void;
  pause: () => void;
  seek: (t: number) => void;
  /** False if media is an uncontrollable or cross-origin embed that refuses seeking */
  canSeek?: boolean | (() => boolean);
  current: () => {
    time: number;
    playing: boolean;
    ended: boolean;
    bufferedEnd: number;
    duration: number;
  };
}

export interface EngineOptions {
  /** real media duration in seconds; 0 until metadata has landed */
  duration: number;
  markers: Marker[];
  rate: number;
  startAt?: number;
  autoSkipIntro?: boolean;
  autoSkipOutro?: boolean;
  /** the real media element (or a hold controller while it is not ready) */
  live: LiveController;
  onEnded?: () => void;
  onAutoSkip?: (kind: 'intro' | 'outro') => void;
}

export interface PlayerEngine {
  time: number;
  duration: number;
  playing: boolean;
  ended: boolean;
  /** media buffered range end, in seconds */
  buffered: number;
  progress: number;
  intro?: Marker;
  outro?: Marker;
  recap?: Marker;
  inIntro: boolean;
  inOutro: boolean;
  inRecap: boolean;
  canSeek: boolean;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seek: (t: number) => void;
  seekBy: (delta: number) => void;
  skipTo: (marker: Marker | undefined, edge: 'start' | 'end') => void;
  reset: (t: number) => void;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function usePlayerEngine(o: EngineOptions): PlayerEngine {
  const [time, setTime] = useState(() => Math.max(0, o.startAt ?? 0));
  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  const [buffered, setBuffered] = useState(0);

  const rateRef = useRef(o.rate);
  const endedRef = useRef(o.onEnded);
  const skipRef = useRef(o.onAutoSkip);
  const durationRef = useRef(o.duration);
  const live = o.live;

  useEffect(() => {
    rateRef.current = o.rate;
  }, [o.rate]);
  useEffect(() => {
    endedRef.current = o.onEnded;
  }, [o.onEnded]);
  useEffect(() => {
    skipRef.current = o.onAutoSkip;
  }, [o.onAutoSkip]);
  useEffect(() => {
    durationRef.current = o.duration;
  }, [o.duration]);

  const seek = useCallback(
    (t: number) => {
      const d = durationRef.current;
      const next = d > 0 ? clamp(t, 0, d) : Math.max(0, t);
      live.seek(next);
      setTime(next);
      setEnded(d > 0 && next >= d - 0.4);
    },
    [live],
  );

  /* mirror the real media element every 250ms */
  const wasEnded = useRef(false);
  useEffect(() => {
    const tick = () => {
      const cur = live.current();
      setTime(cur.time);
      setPlaying(cur.playing);
      setBuffered(cur.bufferedEnd);
      setEnded(cur.ended);
      if (cur.ended && !wasEnded.current) {
        wasEnded.current = true;
        endedRef.current?.();
      } else if (!cur.ended) {
        wasEnded.current = false;
      }
    };
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [live]);

  const canSeek = useMemo(() => {
    if (typeof live.canSeek === 'function') return live.canSeek();
    if (typeof live.canSeek === 'boolean') return live.canSeek;
    return true;
  }, [live]);

  const intro = useMemo(() => o.markers.find((m) => m.kind === 'intro'), [o.markers]);
  const outro = useMemo(() => o.markers.find((m) => m.kind === 'outro'), [o.markers]);
  const recap = useMemo(() => o.markers.find((m) => m.kind === 'recap'), [o.markers]);

  const inIntro = !!intro && time >= intro.start && time < intro.end;
  const inOutro = !!outro && time >= outro.start && time < outro.end;
  const inRecap = !!recap && time >= recap.start && time < recap.end;

  const skipped = useRef('');
  useEffect(() => {
    skipped.current = '';
  }, [o.markers]);

  useEffect(() => {
    if (!playing || !canSeek) return;
    if (o.autoSkipIntro && intro && inIntro && !skipped.current.includes('i')) {
      skipped.current += 'i';
      seek(intro.end + 0.2);
      skipRef.current?.('intro');
    }
    if (o.autoSkipOutro && outro && inOutro && !skipped.current.includes('o')) {
      skipped.current += 'o';
      seek(outro.end + 0.2);
      skipRef.current?.('outro');
    }
  }, [playing, canSeek, inIntro, inOutro, intro, outro, o.autoSkipIntro, o.autoSkipOutro, seek]);

  const reset = useCallback(
    (t: number) => {
      const d = durationRef.current;
      const next = d > 0 ? clamp(t, 0, d) : Math.max(0, t);
      live.pause();
      live.seek(next);
      setTime(next);
      setPlaying(false);
      setEnded(false);
    },
    [live],
  );

  return {
    time,
    duration: o.duration,
    playing,
    ended,
    buffered,
    progress: o.duration > 0 ? time / o.duration : 0,
    intro,
    outro,
    recap,
    inIntro,
    inOutro,
    inRecap,
    canSeek,
    play: useCallback(() => {
      live.play();
    }, [live]),
    pause: useCallback(() => {
      live.pause();
    }, [live]),
    toggle: useCallback(() => {
      if (playing) live.pause();
      else live.play();
    }, [live, playing]),
    seek,
    seekBy: useCallback(
      (delta: number) => {
        seek(time + delta);
      },
      [seek, time],
    ),
    skipTo: useCallback(
      (marker: Marker | undefined, edge: 'start' | 'end') => {
        if (!marker) return;
        seek(edge === 'end' ? marker.end + 0.2 : marker.start);
      },
      [seek],
    ),
    reset,
  };
}
