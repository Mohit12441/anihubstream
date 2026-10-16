/* ============================================================
   useLiveStream — real playback through the AniKoto bridge.

   hls.js feeds a real <video> from whichever bridge base answers
   (loopback, or the public tunnel — see streamBridge.ts). The
   engine is held at the resume point during resolve, then mirrors
   the media element: time, playing state and the buffer band all
   become real.

   Nothing degrades into a fake stream: while the bridge cannot be
   reached the status is 'unavailable' (or 'error' for a resolve
   failure) and the caller shows an offline overlay with retry.
   ============================================================ */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type Hls from 'hls.js';
import type { LiveController } from './usePlayerEngine';
import {
  bridgeHealth,
  bridgeResolve,
  bridgeUrl,
  fetchVtt,
  isResolveFailure,
  prefetchEpisode,
  type BridgeSource,
  type Cue,
} from './streamBridge';
import { subLangCode, subLangLabel } from './playerPrefs';

export type LiveStatus = 'resolving' | 'ready' | 'error' | 'unavailable';
/** what the caption track the viewer asked for actually did */
export type SubStatus = 'off' | 'loading' | 'shown' | 'missing' | 'unreadable' | 'failed';

export interface SubTrack {
  /** position in the provider's own list */
  i: number;
  /** ISO code folded from the provider's token/name, null when unrecognised */
  code: string | null;
  /** what the grid addresses this track by — its code, or the provider name when
      a second track already claims that code */
  key: string;
  label: string;
  /** the provider's own display name, verbatim */
  name: string;
  url: string;
}

interface Options {
  title: string;
  episode: number;
  audio: 'sub' | 'dub';
  /** captions on/off and the requested language (ISO code) */
  subsOn: boolean;
  subLanguage: string | null;
  startAt: number;
  volume: number;
  muted: boolean;
  rate: number;
}

/* Refusals that a fresh resolve could clear: the provider was mid-response, a CDN object
   moved, the bridge was busy. Naming them is what keeps recovery from hammering a title
   that simply does not have this episode. */
const TRANSIENT_REFUSALS = new Set([
  'RESOLVE_FAILED',
  'NO_EMBEDS',
  'BRIDGE_TIMEOUT',
  'UPSTREAM',
  'NETWORK',
  'RATE_LIMITED',
]);

export function useLiveStream(o: Options) {
  const [status, setStatus] = useState<LiveStatus>('resolving');
  const [info, setInfo] = useState<BridgeSource | null>(null);
  const [error, setError] = useState<string | null>(null);
  /* Whether retrying could change the outcome. Since the bridge reports a provider's
     refusal as a readable 4xx, "episode 9 is not listed" and "the CDN 404'd that
     segment" arrive here as the same status — only the second is worth another try. */
  const [retryable, setRetryable] = useState(false);
  /* a play() the browser refused, phrased for the viewer. The counter bumps so the player
     can report every refusal, not only the first one it saw. */
  const [playRefused, setPlayRefused] = useState<{ n: number; text: string } | null>(null);
  const playTry = useRef(0);
  const [duration, setDuration] = useState(0);
  const [cues, setCues] = useState<Cue[]>([]);
  /** pick id of the track whose cues are currently in state, so a language change can drop
     the outgoing text instead of painting it under the new track's label */
  const shownTrack = useRef<string | null>(null);
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  /* bumped by retry() to re-run resolve (and re-probe the bridge bases) */
  const [nonce, setNonce] = useState(0);
  const freshRef = useRef(false);
  /* set when a dub ask had to fall back to the original (episode carries no dub) */
  const [audioFallback, setAudioFallback] = useState(false);
  /* A single failed probe can be a transient blip (cold tunnel, a loaded
     network) — re-probe with growing gaps before leaving the viewer offline.
     Reset on any successful probe and on the overlay's manual Retry. */
  const autoTries = useRef(0);
  /* same idea for a provider refusal that could clear, but far more sparingly: each
     attempt costs the provider a full resolve, and a dead embed rarely recovers */
  const errorTries = useRef(0);

  const hlsRef = useRef<Hls | null>(null);
  /* resume is applied once per resolve attempt, on the first loadedmetadata */
  const startOnce = useRef(false);

  const startAtRef = useRef(o.startAt);
  startAtRef.current = o.startAt;
  const media = useRef({ volume: o.volume, muted: o.muted, rate: o.rate });
  media.current = { volume: o.volume, muted: o.muted, rate: o.rate };

  const videoRef = useCallback((el: HTMLVideoElement | null) => setVideoEl(el), []);

  const retry = useCallback(() => {
    autoTries.current = 0;
    freshRef.current = true;
    setNonce((n) => n + 1);
  }, []);

  const [resolvingElapsed, setResolvingElapsed] = useState(0);
  const [firstFrameLatency, setFirstFrameLatency] = useState<number | null>(null);
  const resolveStart = useRef<number>(Date.now());

  /* ---------- resolve ---------- */
  useEffect(() => {
    const fresh = freshRef.current;
    freshRef.current = false;
    startOnce.current = true;
    resolveStart.current = Date.now();
    setFirstFrameLatency(null);
    setDuration(0);
    setCues([]);
    shownTrack.current = null;
    setError(null);
    setRetryable(false);
    setAudioFallback(false);
    setResolvingElapsed(0);
    let cancel = false;
    setStatus('resolving');
    setInfo(null);

    const timer = window.setInterval(() => {
      setResolvingElapsed((s) => s + 1);
    }, 1000);

    const timeoutId = window.setTimeout(() => {
      if (!cancel && status === 'resolving') {
        setStatus('error');
        setRetryable(true);
        setError('Resolution timed out after 15s. Click Retry to try again.');
      }
    }, 15_000);

    void (async () => {
      try {
        const up = await bridgeHealth(fresh);
        if (cancel) return;
        if (!up) {
          setStatus('unavailable');
          return;
        }
        autoTries.current = 0;
        errorTries.current = 0;
        let res = await bridgeResolve(o.title, o.episode, o.audio);
        if (cancel) return;
        if (isResolveFailure(res)) {
          /* a dub ask for an episode that has no dubbed file falls back to the original
             rather than leaving the viewer with an error — the audio the episode actually
             carries wins over the stored intent */
          if (o.audio === 'dub' && res.error === 'NO_EMBEDS') {
            const sub = await bridgeResolve(o.title, o.episode, 'sub');
            if (cancel) return;
            if (!isResolveFailure(sub)) {
              setAudioFallback(true);
              setInfo(sub);
              // Prefetch next episode in the background
              prefetchEpisode(o.title, o.episode + 1, 'sub');
              return;
            }
            res = sub;
          }
          setRetryable(TRANSIENT_REFUSALS.has(res.error));
          setStatus(res.error === 'BRIDGE_UNREACHABLE' ? 'unavailable' : 'error');
          setError(res.message ? `${res.error} — ${res.message}` : res.error);
          return;
        }
        setInfo(res);
        // Automatically warm and prefetch the next episode so autoplay/bingeing is instant!
        prefetchEpisode(o.title, o.episode + 1, o.audio);
      } finally {
        window.clearInterval(timer);
        window.clearTimeout(timeoutId);
      }
    })();
    return () => {
      cancel = true;
      window.clearInterval(timer);
      window.clearTimeout(timeoutId);
    };
  }, [o.title, o.episode, o.audio, nonce]);

  /* ---------- self-heal a transient offline, or a refusal a re-resolve can clear ---------- */
  useEffect(() => {
    const offline = status === 'unavailable';
    if (!offline && !(status === 'error' && retryable)) return;
    const tries = offline ? autoTries.current : errorTries.current;
    if (tries >= (offline ? 10 : 2)) return;
    const id = window.setTimeout(
      () => {
        if (offline) autoTries.current += 1;
        else errorTries.current += 1;
        freshRef.current = true;
        setNonce((n) => n + 1);
      },
      offline ? 10_000 + Math.min(tries, 5) * 10_000 : 20_000 * (tries + 1),
    );
    return () => window.clearTimeout(id);
  }, [status, nonce, retryable]);

  /* ---------- attach hls.js ---------- */
  useEffect(() => {
    const v = videoEl;
    if (!v || !info) return;
    let cancelled = false;
    let mediaTried = false;
    let netTried = false;

    v.volume = media.current.volume;
    v.muted = media.current.muted;
    v.playbackRate = media.current.rate;

    const markReady = () => {
      if (!cancelled) setStatus('ready');
    };
    const onMetadata = () => {
      if (cancelled) return;
      if (Number.isFinite(v.duration) && v.duration > 0) setDuration(v.duration);
      if (startOnce.current) {
        startOnce.current = false;
        const t = startAtRef.current;
        if (t > 1 && (!Number.isFinite(v.duration) || t < v.duration - 5)) v.currentTime = t;
      }
      markReady();
    };
    const onError = () => {
      if (cancelled) return;
      /* a fresh resolve means fresh segment URLs and, usually, a different embed */
      setRetryable(true);
      setStatus('error');
      setError('The media element rejected the stream.');
    };
    const onPlaying = () => {
      const elapsed = Date.now() - resolveStart.current;
      setFirstFrameLatency(elapsed);
      console.log(`[Playback] First frame rendered in ${elapsed}ms (${info?.reused ? 'cached' : 'fresh'})`);
    };
    v.addEventListener('loadedmetadata', onMetadata);
    v.addEventListener('error', onError);
    v.addEventListener('playing', onPlaying, { once: true });

    let hls: Hls | null = null;
    void (async () => {
      const url = bridgeUrl(info.master);
      const { default: HlsCtor } = await import('hls.js');
      if (cancelled) return;
      if (HlsCtor.isSupported()) {
        hls = new HlsCtor({ maxBufferLength: 30, backBufferLength: 30 });
        hlsRef.current = hls;
        /* 'ready' is set from the video's own loadedmetadata (real media data
           appended) — a parsed manifest alone is not playback. */
        hls.on(HlsCtor.Events.ERROR, (_evt, data) => {
          if (cancelled || !data.fatal) return;
          if (data.type === HlsCtor.ErrorTypes.NETWORK_ERROR && !netTried) {
            netTried = true;
            hls?.startLoad();
            return;
          }
          if (data.type === HlsCtor.ErrorTypes.MEDIA_ERROR && !mediaTried) {
            mediaTried = true;
            hls?.recoverMediaError();
            return;
          }
          setRetryable(true);
          setStatus('error');
          setError(`Playback error: ${String(data.details ?? data.type)}`);
        });
        hls.loadSource(url);
        hls.attachMedia(v);
      } else if (v.canPlayType('application/vnd.apple.mpegurl')) {
        v.src = url;
        v.load();
      } else {
        setStatus('error');
        setError('This browser cannot play HLS (no MSE and no native HLS).');
      }
    })();

    return () => {
      cancelled = true;
      v.removeEventListener('loadedmetadata', onMetadata);
      v.removeEventListener('error', onError);
      v.removeEventListener('playing', onPlaying);
      hls?.destroy();
      if (hlsRef.current === hls) hlsRef.current = null;
      v.removeAttribute('src');
      v.load();
    };
  }, [videoEl, info]);

  /* ---------- volume / rate live updates ---------- */
  useEffect(() => {
    const v = videoEl;
    if (!v) return;
    v.volume = o.volume;
    v.muted = o.muted;
  }, [videoEl, o.volume, o.muted]);

  useEffect(() => {
    const v = videoEl;
    if (!v) return;
    v.playbackRate = o.rate;
  }, [videoEl, o.rate]);

  /* ---------- captions: the language the viewer chose, matched against the
     tracks this stream actually carries (never a silent fall back to English) ---------- */
  const tracks = useMemo<SubTrack[]>(() => {
    const tally = new Map<string, number>();
    return (info?.subtitles ?? []).map((t, i) => {
      const code = subLangCode(t.language) ?? subLangCode(t.name);
      const name = t.name ?? t.language;
      const base = subLangLabel(code ?? name);
      /* One language can arrive twice — Castilian and Latin-American Spanish are separate
         files. The first keeps its code as the pick id; the rest are addressed by the
         provider's own name, so both stay reachable and neither looks like a duplicate.
         Tally keyed on what the label says: keying unknown codes all on '' made every
         unfolded track the second of one language, so the panel read "Thai — Thai". */
      const tallyKey = (code ?? name).toLowerCase();
      const nth = (tally.get(tallyKey) ?? 0) + 1;
      tally.set(tallyKey, nth);
      return {
        i,
        code,
        key: nth > 1 ? name : (code ?? name),
        label: nth > 1 ? `${base} — ${name}` : base,
        name,
        url: t.url,
      };
    });
  }, [info]);

  /** the requested language as a code; 'Off' / unparsable -> null */
  const wanted = o.subsOn ? subLangCode(o.subLanguage) : null;
  /** raw request text — a specific provider track the code table doesn't fold */
  const wantedRaw = o.subsOn && !/^(off|none)$/i.test((o.subLanguage ?? '').trim())
    ? (o.subLanguage ?? '').trim()
    : '';

  const subPick = useMemo<SubTrack | null>(() => {
    if (!o.subsOn || !info) return null;
    if (wantedRaw) {
      const low = wantedRaw.toLowerCase();
      /* an exact pick from this episode's own list wins before the code table, so choosing
         the second of two Spanish files cannot silently land on the first */
      const exact = tracks.find((t) => t.key.toLowerCase() === low || t.name.toLowerCase() === low);
      if (exact) return exact;
      if (wanted) return tracks.find((t) => t.code === wanted) ?? null;
      /* the choice names a track this source does not carry — say so, never substitute */
      return null;
    }
    if (wanted) return tracks.find((t) => t.code === wanted) ?? null;
    /* nothing was asked for: English when the stream carries it, else the first track */
    return tracks.find((t) => t.code === 'en') ?? tracks[0] ?? null;
  }, [info, tracks, o.subsOn, wanted, wantedRaw]);

  /** human label of what the viewer asked for, for honest "not offered" copy */
  const subRequestLabel = wanted ? subLangLabel(wanted) : wantedRaw || null;

  const [subState, setSubState] = useState<SubStatus>('off');

  useEffect(() => {
    if (!o.subsOn) {
      setCues([]);
      shownTrack.current = null;
      setSubState('off');
      return;
    }
    if (!info) {
      setCues([]);
      shownTrack.current = null;
      setSubState('loading');
      return;
    }
    if (!subPick) {
      /* the stream answers, but not with the track that was asked for */
      setCues([]);
      shownTrack.current = null;
      setSubState('missing');
      return;
    }
    let cancel = false;
    /* A different track means different words: drop the outgoing cues so the caption layer
       can never show one language while its tag names another. The same track arriving with a
       new stream id is an episode/source switch, where those cues are still the right words —
       hold them instead of flashing a gap. */
    if (shownTrack.current !== subPick.key) setCues([]);
    setSubState('loading');
    void fetchVtt(subPick.url).then((f) => {
      if (cancel) return;
      setCues(f?.cues ?? []);
      shownTrack.current = f ? subPick.key : null;
      if (!f) setSubState('failed');
      else if (!f.cues.length) setSubState('unreadable');
      else setSubState('shown');
    });
    return () => {
      cancel = true;
    };
  }, [info, subPick, o.subsOn]);

  /* ---------- controllers ---------- */
  const mediaController = useMemo<LiveController>(
    () => ({
      play: () => {
        const v = videoEl;
        if (!v) return;
        /* A rejected play() used to vanish into an empty catch: the viewer pressed play,
           nothing moved, and the player had nothing to say. Autoplay policy refusals are
           not a stream fault, so they are reported as their own message, not as an error. */
        v.play().then(
          () => setPlayRefused(null),
          (e: unknown) => {
            playTry.current += 1;
            setPlayRefused({
              n: playTry.current,
              text:
                e instanceof DOMException && e.name === 'NotAllowedError'
                  ? 'The browser only plays video after a gesture it can see — tap the picture again.'
                  : 'The video element would not start this stream.',
            });
          },
        );
      },
      pause: () => videoEl?.pause(),
      seek: (t) => {
        const v = videoEl;
        if (!v) return;
        const max = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : t;
        try {
          v.currentTime = Math.min(Math.max(0, t), max);
        } catch {
          /* metadata not ready yet — the mirror will settle on the next tick */
        }
      },
      canSeek: () => {
        const v = videoEl;
        if (!v) return false;
        try {
          return Boolean(v.seekable && v.seekable.length > 0);
        } catch {
          return false;
        }
      },
      current: () => {
        const v = videoEl;
        if (!v) return { time: 0, playing: false, ended: false, bufferedEnd: 0, duration: 0 };
        let bufferedEnd = 0;
        try {
          if (v.buffered.length > 0) bufferedEnd = v.buffered.end(v.buffered.length - 1);
        } catch {
          bufferedEnd = 0;
        }
        return {
          time: v.currentTime || 0,
          playing: !v.paused && !v.ended,
          ended: v.ended,
          bufferedEnd,
          duration: Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 0,
        };
      },
    }),
    [videoEl],
  );

  /* while the bridge resolves (or is unreachable) the engine must not run a
     clock of its own — hold it at the resume point, nothing is playing yet */
  const holdController = useMemo<LiveController>(
    () => ({
      play: () => {},
      pause: () => {},
      seek: () => {},
      canSeek: false,
      current: () => ({ time: startAtRef.current, playing: false, ended: false, bufferedEnd: 0, duration: 0 }),
    }),
    [],
  );

  const controller = status === 'ready' ? mediaController : holdController;

  /* Every cue whose interval covers t, in track order. Real tracks overlap: Jujutsu Kaisen
     ep1's Arabic file has 45 cue pairs that share a moment and 19 cues with the same start,
     so a single match would silently drop one of the two lines — for those 24 instants the
     viewer would lose the second speaker's words. */
  const cuesAt = useCallback(
    (t: number) => {
      const active = cues.filter((c) => t >= c.start && t < c.end).map((c) => c.text);
      return active.length ? Array.from(new Set(active)) : active;
    },
    [cues],
  );

  const pip = useCallback(async () => {
    const v = videoEl;
    if (!v || typeof v.requestPictureInPicture !== 'function') return false;
    try {
      await v.requestPictureInPicture();
      return true;
    } catch {
      return false;
    }
  }, [videoEl]);

  return {
    status,
    info,
    error,
    /** a dub ask fell back to the original because this episode has no dub file */
    audioFallback,
    duration,
    cues,
    /** the caption tracks this stream really carries */
    subTracks: tracks,
    subState,
    /** code of the track now shown, or null when nothing is */
    subCode: subPick?.code ?? null,
    /** code the viewer asked for */
    subWanted: wanted,
    /** label of what the viewer asked for (code or verbatim track name), null when nothing was */
    subRequestLabel,
    subName: subPick ? subPick.label : null,
    controller,
    videoRef,
    cuesAt,
    /** what a refused play() told us, or null when the last attempt started cleanly */
    playRefused,
    retryable,
    pip,
    retry,
    resolvingElapsed,
    firstFrameLatency,
  };
}
