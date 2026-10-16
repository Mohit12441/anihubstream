import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Play, RefreshCw, SkipForward, WifiOff, X } from 'lucide-react';
import type { Anime, Episode, Marker } from '../../data/model';
import { toSeconds } from '../../data/model';
import { fetchSkipTimes } from '../../lib/aniskip';
import { LIVE_SERVER, type ServerStatus } from '../../data/servers';
import { useToast } from '../../lib/Toast';
import { usePrefersReducedMotion } from '../../lib/motion';
import { usePlayerEngine, type PlayerEngine } from '../../lib/usePlayerEngine';
import { useLiveStream } from '../../lib/useLiveStream';
import { actionFor, isEditable, type ShortcutAction } from '../../lib/shortcuts';
import type { AudioId, PlayerPrefs, SubtitleSettings } from '../../lib/playerPrefs';
import { bridgeAudios, isResolveFailure, type AudioList } from '../../lib/streamBridge';
import { stamp } from '../../lib/time';
import { Art } from '../Art';
import { PlayerControls } from './PlayerControls';
import { PlayerSettings, type SettingsTab } from './PlayerSettings';
import { PlayerTimeline } from './PlayerTimeline';
import { ServerSelector } from './ServerSelector';
import { NextEpisodeOverlay } from './NextEpisodeOverlay';
import { captionAnchor, captionStyle } from './captionStyle';

const COUNTDOWN = 8;

type Menu = { kind: 'none' } | { kind: 'settings'; tab: SettingsTab } | { kind: 'server' };

interface Props {
  anime: Anime;
  episode: Episode;
  next: Episode | null;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  theatre: boolean;
  onTheatre: (v: boolean) => void;
  prefs: PlayerPrefs;
  patch: (p: Partial<PlayerPrefs>) => void;
  patchSubs: (p: Partial<SubtitleSettings>) => void;
  restoreSubs: () => void;
  restoreAppearance: () => void;
  resumeAt: number;
  onProgress: (t: number) => void;
  onStreamResolved?: (resolved: boolean) => void;
}

/** The prefixed members Safari exposes are not in the DOM typings. */
const webkitDoc = () =>
  document as Document & {
    webkitFullscreenElement?: Element | null;
    webkitExitFullscreen?: (() => Promise<void>) | undefined;
  };

export function AdvancedPlayer(props: Props) {
  const { anime, episode, next, hasPrev, hasNext, onPrev, onNext, theatre, onTheatre, prefs, patch, onStreamResolved } = props;
  const { notify } = useToast();
  const reduced = usePrefersReducedMotion();

  const rootRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<Menu>({ kind: 'none' });
  const [chrome, setChrome] = useState(true);
  const [scrubbing, setScrubbing] = useState(false);
  const [full, setFull] = useState(false);
  const [fx, setFx] = useState<{ dir: 'fwd' | 'back'; id: number } | null>(null);
  const [hud, setHud] = useState<{ text: string; id: number } | null>(null);
  const [countdown, setCountdown] = useState(COUNTDOWN);
  const [dismissed, setDismissed] = useState(false);

  /* audio availability is probed on demand (the byte-pair check is the costly part) */
  const [audioList, setAudioList] = useState<AudioList | null>(null);
  const [audioStatus, setAudioStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [audioError, setAudioError] = useState<string | null>(null);

  const open = menu.kind !== 'none';

  /* ---------- resume ---------- */
  const resumeRef = useRef(props.resumeAt);
  resumeRef.current = props.resumeAt;
  const episodeTag = `${anime.id}:${episode.n}`;

  /* switching audio re-resolves the stream; seek the new one to the current
     playhead instead of the saved position, but never across an episode change */
  const switchSeekRef = useRef<number | null>(null);
  const switchSeekFor = useRef<string | null>(null);

  /* ---------- live bridge ---------- */
  const startAtForLive =
    switchSeekRef.current !== null && switchSeekFor.current === episodeTag
      ? switchSeekRef.current
      : resumeRef.current;

  const live = useLiveStream({
    title: anime.title,
    episode: episode.n,
    audio: prefs.audio,
    subsOn: prefs.subtitles.enabled,
    subLanguage: prefs.subtitles.language,
    startAt: startAtForLive,
    volume: prefs.volume,
    muted: prefs.muted,
    rate: prefs.speed,
  });
  const liveReady = live.status === 'ready';
  /* iOS Safari offers no picture-in-picture to a webpage's video element and some browsers
     switch it off entirely; a control that can only ever fail should not be drawn. live.pip()
     still reports the truth when the request itself is refused. */
  const pipSupported = document.pictureInPictureEnabled !== false;
  const server = LIVE_SERVER;
  const serverStatus: ServerStatus =
    live.status === 'ready' ? 'online' : live.status === 'resolving' ? 'degraded' : 'unavailable';

  /* Media duration from live stream, falling back to episode catalog runtime while loading */
  const fallbackDuration = episode.runtime ? toSeconds(episode.runtime) : 0;
  const timelineDuration = liveReady && live.duration > 0 ? live.duration : fallbackDuration;

  useEffect(() => {
    onStreamResolved?.(liveReady);
  }, [liveReady, onStreamResolved]);

  /* Dynamically query AniSkip v2 timestamps for the anime MAL ID and episode */
  const [aniSkipMarkers, setAniSkipMarkers] = useState<Marker[]>([]);
  useEffect(() => {
    let active = true;
    if (!anime.malId || anime.malId <= 0) {
      setAniSkipMarkers([]);
      return;
    }
    const epLength = timelineDuration > 0 ? timelineDuration : toSeconds(episode.runtime);
    fetchSkipTimes(anime.malId, episode.n, epLength)
      .then((m) => {
        if (active) setAniSkipMarkers(m);
      })
      .catch(() => {
        if (active) setAniSkipMarkers([]);
      });
    return () => {
      active = false;
    };
  }, [anime.malId, episode.n, timelineDuration, episode.runtime]);

  /* the provider's skip windows (via the bridge) take over once the stream is
     ready; the catalogue's synced AniSkip windows stand in until then */
  const liveMarkers = useMemo<Marker[]>(() => {
    const s = live.info?.skip;
    if (!s) return [];
    const out: Marker[] = [];
    if (s.intro) out.push({ kind: 'intro', label: 'Opening', start: s.intro[0], end: s.intro[1] });
    if (s.outro) out.push({ kind: 'outro', label: 'Ending', start: s.outro[0], end: s.outro[1] });
    return out;
  }, [live.info]);

  const markers = useMemo<Marker[]>(() => {
    const secondary = liveReady && liveMarkers.length ? liveMarkers : episode.markers;
    if (!aniSkipMarkers.length) return secondary;
    // AniSkip community markers take priority for intro, outro, and recap
    const merged: Marker[] = [...aniSkipMarkers];
    const hasIntro = merged.some((m) => m.kind === 'intro');
    const hasOutro = merged.some((m) => m.kind === 'outro');
    for (const m of secondary) {
      if (m.kind === 'intro' && !hasIntro) merged.push(m);
      else if (m.kind === 'outro' && !hasOutro) merged.push(m);
      else if (m.kind !== 'intro' && m.kind !== 'outro' && !merged.some((c) => c.kind === m.kind)) {
        merged.push(m);
      }
    }
    return merged;
  }, [aniSkipMarkers, liveReady, liveMarkers, episode.markers]);

  const engine = usePlayerEngine({
    duration: timelineDuration,
    markers,
    rate: prefs.speed,
    startAt: resumeRef.current,
    autoSkipIntro: prefs.autoSkipIntro,
    autoSkipOutro: prefs.autoSkipOutro,
    live: live.controller,
    onEnded: () => setDismissed(false),
    onAutoSkip: (kind) =>
      notify(kind === 'intro' ? 'Skipped the opening window for this episode (AniSkip).' : 'Skipped the ending window for this episode (AniSkip).'),
  });

  /* the live playhead, readable from event handlers that fire between renders */
  const engineRef = useRef<PlayerEngine>(engine);
  engineRef.current = engine;

  /* ---------- audio: switch, and probe what the source really carries ---------- */
  const setAudio = useCallback(
    (next: AudioId) => {
      if (next === prefs.audio) return;
      const at = engineRef.current.time;
      switchSeekRef.current = at > 1 ? at : null;
      switchSeekFor.current = episodeTag;
      patch({ audio: next });
      notify(
        next === 'dub'
          ? 'Switching to the dubbed audio — the bridge is re-resolving this episode.'
          : 'Switching to the original Japanese audio — the bridge is re-resolving this episode.',
      );
    },
    [prefs.audio, patch, episodeTag, notify],
  );

  const ensureAudios = useCallback(() => {
    if (audioStatus === 'loading' || audioStatus === 'ready') return;
    setAudioStatus('loading');
    setAudioError(null);
    void bridgeAudios(anime.title, episode.n).then((r) => {
      if (isResolveFailure(r)) {
        setAudioStatus('error');
        setAudioError(r.message ? `${r.error} — ${r.message}` : r.error);
        return;
      }
      setAudioList(r);
      setAudioStatus('ready');
    });
  }, [audioStatus, anime.title, episode.n]);

  /* a fresh episode re-probes (and a stored dub intent that fell back tells the viewer why) */
  useEffect(() => {
    setAudioList(null);
    setAudioStatus('idle');
  }, [episodeTag]);

  const fallbackAnnounced = useRef<string | null>(null);
  useEffect(() => {
    if (!liveReady) return;
    const key = `${episodeTag}:${live.audioFallback}`;
    if (fallbackAnnounced.current === key) return;
    fallbackAnnounced.current = key;
    if (live.audioFallback)
      notify('This episode has no dubbed audio — playing the original Japanese instead.');
  }, [liveReady, live.audioFallback, episodeTag, notify]);

  /* open the audio tab -> probe once */
  useEffect(() => {
    if (menu.kind === 'settings' && menu.tab === 'audio') ensureAudios();
  }, [menu, ensureAudios]);

  /* ---------- persist position ---------- */
  const saveRef = useRef({ time: engine.time, fn: props.onProgress, on: prefs.rememberPosition, dur: timelineDuration });
  saveRef.current = { time: engine.time, fn: props.onProgress, on: prefs.rememberPosition, dur: timelineDuration };

  const bucket = Math.floor(engine.time / 5);
  useEffect(() => {
    const id = window.setTimeout(() => {
      if (saveRef.current.on) saveRef.current.fn(saveRef.current.time);
    }, 400);
    return () => window.clearTimeout(id);
  }, [bucket]);

  useEffect(() => {
    if (!engine.playing && saveRef.current.on) saveRef.current.fn(engine.time);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine.playing]);

  useEffect(() => {
    // capture this episode's recorder in the closure: on unmount/episode change the
    // render-time ref already points at the *next* episode, which would misfile the time.
    const rec = props.onProgress;
    const on = prefs.rememberPosition;
    return () => {
      if (on && saveRef.current.time > 1) rec(saveRef.current.time);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episodeTag]);

  /* ---------- caption clearance ---------- */
  const barRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = barRef.current;
    const stage = stageRef.current;
    const root = rootRef.current;
    if (!el || !stage || !root || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      root.style.setProperty('--pl-bar', `${Math.round(el.getBoundingClientRect().height) + 14}px`);
      /* The frame's own height as well: on a phone the stage is ~200px and a long cue at
         the viewer's size covers the picture it is describing, so CSS shrinks the text
         against this instead of against the viewport. */
      root.style.setProperty('--pl-stage-h', `${Math.round(stage.getBoundingClientRect().height)}px`);
    });
    ro.observe(el);
    ro.observe(stage);
    return () => ro.disconnect();
  }, []);

  /* ---------- chrome auto-hide ---------- */
  const wake = useCallback(() => setChrome(true), []);

  useEffect(() => {
    if (!engine.playing || scrubbing || open || engine.ended) return;
    if (!chrome) return;
    const id = window.setTimeout(() => setChrome(false), 2800);
    return () => window.clearTimeout(id);
  }, [engine.playing, engine.ended, chrome, scrubbing, open]);

  useEffect(() => {
    if (engine.playing) return;
    setChrome(true);
  }, [engine.playing]);

  /* ---------- fullscreen ---------- */
  useEffect(() => {
    const onFs = () => setFull(Boolean(document.fullscreenElement ?? webkitDoc().webkitFullscreenElement));
    document.addEventListener('fullscreenchange', onFs);
    /* Safari on macOS still uses the prefixed event name */
    document.addEventListener('webkitfullscreenchange', onFs);
    return () => {
      document.removeEventListener('fullscreenchange', onFs);
      document.removeEventListener('webkitfullscreenchange', onFs);
    };
  }, []);

  /* The prefixed path is for Safari on macOS. iPhones get no element fullscreen at all —
     only the video's own native player, which would drop this player's caption layer, the
     server chips and the skip buttons, so it is deliberately not offered: the button says
     plainly that this browser context cannot do it. */
  const toggleFull = useCallback(() => {
    const doc = webkitDoc();
    const el = rootRef.current as (HTMLElement & { webkitRequestFullscreen?: () => void }) | null;
    if (document.fullscreenElement ?? doc.webkitFullscreenElement) {
      const out = document.exitFullscreen?.() ?? doc.webkitExitFullscreen?.();
      if (!out) {
        notify('Fullscreen could not be closed in this context.');
        return;
      }
      void Promise.resolve(out).catch(() => notify('Fullscreen could not be closed in this context.'));
      return;
    }
    if (el?.requestFullscreen) {
      void el.requestFullscreen().catch(() => notify('Fullscreen was blocked by the browser.'));
      return;
    }
    if (el?.webkitRequestFullscreen) {
      /* the prefixed call returns nothing: the change listener above is what decides
         whether the player actually went fullscreen, so no claim is made here */
      el.webkitRequestFullscreen();
      return;
    }
    notify('Fullscreen is not available in this browser context.');
  }, [notify]);

  /* ---------- feedback fx ---------- */
  useEffect(() => {
    if (!fx && !hud) return;
    const id = window.setTimeout(() => {
      setFx(null);
      setHud(null);
    }, reduced ? 320 : 760);
    return () => window.clearTimeout(id);
  }, [fx, hud, reduced]);

  const jump = useCallback(
    (delta: number) => {
      engine.seekBy(delta);
      setFx({ dir: delta >= 0 ? 'fwd' : 'back', id: Date.now() });
      wake();
    },
    [engine, wake],
  );

  const volume = useCallback(
    (v: number) => {
      const nv = Math.min(1, Math.max(0, Math.round(v * 100) / 100));
      patch({ volume: nv, muted: nv === 0 });
      setHud({ text: `${Math.round(nv * 100)}%`, id: Date.now() });
      wake();
    },
    [patch, wake],
  );

  const toggleCaptions = useCallback(() => {
    props.patchSubs({ enabled: !prefs.subtitles.enabled });
    notify(
      prefs.subtitles.enabled
        ? 'Captions hidden.'
        : live.subName
          ? `Captions shown — provider track: ${live.subName}.`
          : 'Captions on — this stream carries no caption track, so nothing is shown.',
    );
    wake();
  }, [prefs.subtitles.enabled, wake, live.subName, props]);

  /* ---------- tell the viewer what the caption track actually did ---------- */
  const subNoticeRef = useRef<string | null>(null);
  useEffect(() => {
    if (!liveReady || !prefs.subtitles.enabled) return;
    const key = `${live.subState}:${live.subRequestLabel}:${live.subTracks.length}`;
    if (subNoticeRef.current === key) return;
    subNoticeRef.current = key;
    const offered = live.subTracks.map((t) => t.label).join(', ');
    if (live.subState === 'missing') {
      notify(
        live.subRequestLabel && offered
          ? `No ${live.subRequestLabel} captions on this source — it offers: ${offered}.`
          : 'This source carries no caption track at all. Nothing is shown in its place.',
      );
    } else if (live.subState === 'unreadable') {
      notify(`The ${live.subName} caption file arrived but holds no readable cues.`);
    } else if (live.subState === 'failed') {
      notify('The caption file could not be fetched through the bridge.');
    }
  }, [liveReady, live.subState, live.subRequestLabel, live.subName, live.subTracks, prefs.subtitles.enabled, notify]);

  /* ---------- tell the viewer when the browser refuses a play() ---------- */
  const playNoticeRef = useRef(0);
  useEffect(() => {
    const r = live.playRefused;
    if (!r || playNoticeRef.current === r.n) return;
    playNoticeRef.current = r.n;
    notify(r.text);
  }, [live.playRefused, notify]);

  /* ---------- auto-next countdown ---------- */
  const autoNextOpen = engine.ended && !dismissed;
  const countdownRef = useRef(countdown);
  useEffect(() => {
    countdownRef.current = countdown;
  }, [countdown]);

  useEffect(() => {
    countdownRef.current = COUNTDOWN;
    setCountdown(COUNTDOWN);
    setDismissed(false);
    engine.reset(resumeRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episodeTag]);

  useEffect(() => {
    if (!autoNextOpen || !prefs.autoNext || !hasNext) return;
    // the tick that reaches zero clears its own interval, so a advance can only fire once
    const id = window.setInterval(() => {
      const next = Math.max(0, countdownRef.current - 1);
      countdownRef.current = next;
      setCountdown(next);
      if (next === 0) {
        window.clearInterval(id);
        onNext();
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [autoNextOpen, prefs.autoNext, hasNext, onNext]);

  /* ---------- server ---------- */
  /* AniKoto is the only source; re-picking it (or its retry) re-probes the bridge */
  const pickServer = () => {
    setMenu({ kind: 'none' });
    if (!liveReady && live.status !== 'resolving') {
      notify('Re-probing the AniKoto bridge…');
      live.retry();
    }
  };

  /* ---------- keyboard ---------- */
  const run = useRef<(a: ShortcutAction) => void>(() => {});
  run.current = (a: ShortcutAction) => {
    switch (a) {
      case 'toggle':
        engine.toggle();
        break;
      case 'back5':
        jump(-5);
        break;
      case 'fwd5':
        jump(5);
        break;
      case 'back10':
        jump(-10);
        break;
      case 'fwd10':
        jump(10);
        break;
      case 'volUp':
        volume(prefs.muted ? 0.5 : prefs.volume + 0.1);
        break;
      case 'volDown':
        volume(prefs.volume - 0.1);
        break;
      case 'mute':
        patch({ muted: !prefs.muted });
        setHud({ text: prefs.muted ? 'Unmuted' : 'Muted', id: Date.now() });
        break;
      case 'fullscreen':
        toggleFull();
        break;
      case 'theatre':
        onTheatre(!theatre);
        break;
      case 'captions':
        toggleCaptions();
        break;
      case 'settings':
        setMenu((m) => (m.kind === 'settings' ? { kind: 'none' } : { kind: 'settings', tab: 'root' }));
        break;
      case 'shortcuts':
        setMenu((m) => (m.kind === 'settings' && m.tab === 'shortcuts' ? { kind: 'none' } : { kind: 'settings', tab: 'shortcuts' }));
        break;
      case 'next':
        if (hasNext) onNext();
        else notify('This is the last episode this site has listed for the title.');
        break;
      case 'prev':
        if (hasPrev) onPrev();
        else notify('Episode 1 is the first episode loaded for this title.');
        break;
      case 'escape':
        if (menu.kind !== 'none') setMenu({ kind: 'none' });
        else if (document.fullscreenElement) void document.exitFullscreen();
        else if (theatre) onTheatre(false);
        else if (autoNextOpen) setDismissed(true);
        break;
    }
    wake();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as Element | null;
      // Escape closes an open menu from anywhere inside it, even when focus is on a field
      if (e.key === 'Escape' && el?.closest?.('.pop')) {
        e.preventDefault();
        run.current('escape');
        return;
      }
      if (isEditable(el)) return;
      if (el?.closest?.('[role="slider"]')) return;
      const a = actionFor(e);
      if (!a) return;
      if ((a === 'toggle' || a === 'escape') && el?.closest?.('button, a') && e.key !== 'Escape') return;
      e.preventDefault();
      run.current(a);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  /* ---------- click-away for menus ---------- */
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const el = e.target as Element | null;
      if (!el?.closest) return;
      if (el.closest('.pop') || el.closest('.player button[aria-expanded], .player .pl__lab[aria-expanded]')) return;
      setMenu({ kind: 'none' });
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  /* ---------- tap / double-tap on the stage ---------- */
  const tap = useRef<{ t: number; x: number; timer: number; visible: boolean }>({ t: 0, x: 0, timer: 0, visible: true });
  useEffect(() => () => window.clearTimeout(tap.current.timer), []);

  const onStageUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = e.target as Element | null;
    if (el?.closest?.('button, input, [role="slider"], .pop, .nx')) return;
    const now = performance.now();
    const prev = tap.current;
    const isDouble = now - prev.t < 340 && Math.abs(e.clientX - prev.x) < 70;
    window.clearTimeout(prev.timer);
    if (isDouble) {
      tap.current = { t: 0, x: 0, timer: 0, visible: prev.visible };
      const r = e.currentTarget.getBoundingClientRect();
      jump(e.clientX - r.left < r.width / 2 ? -10 : 10);
      return;
    }
    // decide from the state *before* pointerdown revealed the chrome, otherwise a tap
    // meant to show the controls would hide them again 340ms later
    const wasVisible = prev.visible;
    tap.current = {
      t: now,
      x: e.clientX,
      visible: wasVisible,
      timer: window.setTimeout(() => setChrome(wasVisible ? !engine.playing : true), 340),
    };
    // a finger has to wait out the double-tap window before the chrome appears, otherwise the
    // second tap of a seek gesture would land on the freshly revealed control row
    if (e.pointerType !== 'touch') wake();
  };

  /* ---------- caption line ---------- */
  const liveCues = liveReady ? live.cuesAt(engine.time) : [];
  /* A paused frame is precisely when a viewer wants to read the line, and the cue still
     covers this instant. Gating on engine.playing deleted the caption the moment anyone
     stopped the video — the audit caught it at 6.13s on Jujutsu Kaisen. "Ended" is the
     one non-playing state where the line goes, because the picture is over. */
  const showCaptions = prefs.subtitles.enabled && !engine.ended && liveCues.length > 0;

  const canSeek = engine.canSeek !== false;
  const skipTarget = canSeek
    ? (engine.inIntro ? engine.intro : engine.inOutro ? engine.outro : engine.inRecap ? engine.recap : undefined)
    : undefined;
  const skipLabel = engine.inIntro
    ? 'Skip Opening'
    : engine.inOutro
      ? 'Skip Ending'
      : engine.inRecap
        ? 'Skip Recap'
        : 'Skip';

  return (
    <div
      className="player"
      ref={rootRef}
      data-density={prefs.density}
      data-aspect={prefs.aspect}
      data-theatre={theatre || undefined}
      data-menu={menu.kind === 'none' ? undefined : menu.kind}
      onPointerMove={wake}
      onPointerDown={(e) => {
        // remember the pre-wake chrome state: a tap meant to reveal the controls must not
        // hide them again 340ms later
        tap.current.visible = chrome;
        if (e.pointerType !== 'touch') wake();
      }}
      /* the gesture surface is the whole player, not just the picture: the control row is a
         sibling of the stage, so a double-tap whose first tap revealed the chrome would
         otherwise have its second tap swallowed by the bar and never register */
      onPointerUp={onStageUp}
      onKeyDown={wake}
      onFocus={wake}
    >
      <div className="player__stage" ref={stageRef} data-chrome={chrome ? 'visible' : 'hidden'}>
        <Art
          sources={[anime.key, anime.poster]}
          alt={`${anime.title} — episode ${episode.n} frame`}
          imgClass="player__frame"
          eager
          hideWhenEmpty
        />
        <video
          ref={live.videoRef}
          className="player__live"
          data-on={liveReady || undefined}
          poster={anime.key || anime.poster}
          playsInline
          preload="metadata"
          aria-label={`AniKoto stream — ${anime.title} episode ${episode.n}`}
        />
        <div className="player__grade" />

        <div className="player__top">
          <span className="pl__chip">{anime.title}</span>
          <span className="pl__chip pl__chip--dim">
            {anime.season} · EP {episode.n}
          </span>
          <span className="pl__spacer" />
          <span
            className={`pl__sim pl__sim--${liveReady ? 'live' : live.status === 'resolving' ? 'wait' : 'off'}`}
            title={
              liveReady
                ? 'Real playback: hls.js streams the verified AniKoto source through the bridge — the timeline and buffer band reflect the actual media.'
                : live.status === 'resolving'
                  ? 'Asking the AniKoto bridge to resolve this episode. Playback starts once the stream is verified.'
                  : live.status === 'error'
                    ? `The bridge answered — it just has nothing playable for this episode: ${live.error ?? 'no source listed'}. Nothing is streamed in its place.`
                    : 'The AniKoto bridge is not reachable — real playback needs it. Nothing is streamed in its place.'
            }
          >
            {liveReady
              ? `Live · ${live.info?.audio === 'dub' ? 'DUB' : 'SUB'} · ${live.info?.quality ?? 1080}p${live.firstFrameLatency ? ` · ${live.firstFrameLatency}ms` : ''}`
              : live.status === 'resolving'
                ? 'Connecting to bridge…'
                : /* a refusal from the bridge is not the bridge being down: saying so would blame
                     the wrong thing and send the viewer to retry a connection that is fine */
                  live.status === 'error'
                  ? 'No stream for this episode'
                  : 'Bridge offline'}
          </span>
        </div>

        {live.status === 'resolving' && (
          <div className="pl__live-wait" role="status" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', alignItems: 'center' }}>
            <span>Resolving stream through AniKoto… ({live.resolvingElapsed}s)</span>
            {live.resolvingElapsed >= 8 && (
              <div className="pl__stall-retry" role="alert" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <span style={{ fontSize: '0.85rem', color: '#ffc247' }}>Stream taking longer than usual —</span>
                <button type="button" className="btn btn--sm btn--primary" onClick={live.retry}>
                  <RefreshCw size={12} aria-hidden="true" /> Retry
                </button>
                <button
                  type="button"
                  className="btn btn--sm btn--ghost"
                  onClick={() => {
                    live.retry();
                    notify('Switching stream server…');
                  }}
                >
                  Switch Server
                </button>
              </div>
            )}
          </div>
        )}

        {(live.status === 'unavailable' || live.status === 'error') && (
          <div className="pl__offline" role="alert">
            <WifiOff size={26} aria-hidden="true" />
            <b>{live.status === 'unavailable' ? 'Streaming bridge unreachable' : 'This episode could not be streamed'}</b>
            <p>
              {live.status === 'unavailable'
                ? 'Real playback runs through the AniKoto bridge, which is not answering right now. Nothing is streamed in its place.'
                : `${live.error ?? 'The bridge could not resolve this episode.'} Nothing is streamed in its place.`}
            </p>
            <button type="button" className="btn btn--sm btn--primary" onClick={live.retry}>
              <RefreshCw size={14} aria-hidden="true" /> Retry
            </button>
          </div>
        )}

        {liveReady && !engine.playing && !engine.ended && (
          <button
            type="button"
            className="player__big"
            onClick={engine.toggle}
            aria-label={engine.time > 1 ? `Resume ${anime.title} episode ${episode.n}` : `Play episode ${episode.n}`}
          >
            <Play size={30} fill="currentColor" strokeWidth={0} aria-hidden="true" />
          </button>
        )}

        {liveReady && engine.time > 1 && !engine.ended && (
          <button
            type="button"
            className="pl__resume"
            onClick={() => {
              engine.seek(0);
              notify('Restarted this episode from 0:00.');
            }}
            aria-label="Restart from the beginning"
            title={`Resume point saved at ${stamp(engine.time)} — restart from 0:00`}
          >
            <X size={13} aria-hidden="true" />
            Resume {stamp(engine.time)}
          </button>
        )}

        {showCaptions && (
          <p className={`cap ${captionAnchor(prefs.subtitles)}`} style={captionStyle(prefs.subtitles)}>
            <span className="cap__tag" aria-hidden="true">
              CC · {live.subName ?? 'this source'}
            </span>
            {/* dir="auto" decides from the first strong character of its own text, so it has to sit
                on the cue line: on the paragraph the tag's Latin "CC" came first and pinned every
                track — Arabic included — to left-to-right. */}
            {liveCues.map((cue) => (
              <span key={cue} className="cap__text" dir="auto" lang={live.subCode ?? undefined}>
                {cue}
              </span>
            ))}
          </p>
        )}

        {fx && (
          <span className={`pl__fx pl__fx--${fx.dir}`} aria-hidden="true" key={fx.id}>
            <b>{fx.dir === 'fwd' ? '+10' : '−10'}</b>
            {fx.dir === 'fwd' ? <SkipForward size={16} /> : <SkipForward size={16} className="flip" />}
          </span>
        )}

        {hud && (
          <span className="pl__hud" aria-hidden="true" key={hud.id}>
            {hud.text}
          </span>
        )}

        {skipTarget && (
          <button
            type="button"
            className="pl__skip"
            onClick={() => {
              engine.skipTo(skipTarget, 'end');
              notify(
                engine.inIntro
                  ? `Jumped to ${stamp(skipTarget.end)} — opening marker for episode ${episode.n}.`
                  : engine.inOutro
                    ? `Jumped to ${stamp(skipTarget.end)} — ending marker for episode ${episode.n}.`
                    : `Jumped to ${stamp(skipTarget.end)} — recap marker for episode ${episode.n}.`,
              );
            }}
          >
            {skipLabel}
            <small>{stamp(skipTarget.end)}</small>
          </button>
        )}

        {autoNextOpen && (
          <NextEpisodeOverlay
            next={hasNext ? next : null}
            backdrops={[anime.key, anime.poster]}
            auto={prefs.autoNext && hasNext}
            seconds={countdown}
            total={COUNTDOWN}
            onPlay={() => {
              if (hasNext) onNext();
              else notify('No later episode is loaded for this title.');
            }}
            onCancel={() => setDismissed(true)}
            onReplay={() => {
              engine.seek(0);
              engine.play();
              setDismissed(true);
            }}
          />
        )}
      </div>

      <div className={`player__bar${chrome ? '' : ' is-hidden'}`} ref={barRef}>
        <PlayerTimeline
          time={engine.time}
          duration={timelineDuration}
          buffered={engine.buffered}
          markers={markers}
          onSeek={engine.seek}
          onScrub={setScrubbing}
        />

        <PlayerControls
          playing={engine.playing}
          onToggle={engine.toggle}
          onBack10={() => jump(-10)}
          onFwd10={() => jump(10)}
          hasPrev={hasPrev}
          hasNext={hasNext}
          onPrev={onPrev}
          onNext={onNext}
          volume={prefs.volume}
          muted={prefs.muted}
          onVolume={volume}
          onMute={() => patch({ muted: !prefs.muted })}
          speed={prefs.speed}
          quality={live.info ? `${live.info.quality}p` : 'Auto'}
          onQuality={() =>
            notify(
              live.info
                ? `The bridge is streaming the provider's ${live.info.quality}p variant.`
                : 'The bridge streams the provider\u2019s best variant once the episode resolves.',
            )
          }
          subOn={prefs.subtitles.enabled}
          subLang={prefs.subtitles.language}
          onToggleCaptions={toggleCaptions}
          settingsOpen={menu.kind === 'settings'}
          onSettings={() => setMenu((m) => (m.kind === 'settings' ? { kind: 'none' } : { kind: 'settings', tab: 'root' }))}
          serversOpen={menu.kind === 'server'}
          onServers={() => setMenu((m) => (m.kind === 'server' ? { kind: 'none' } : { kind: 'server' }))}
          serverName={server.name}
          serverStatus={serverStatus}
          theatre={theatre}
          onTheatre={() => onTheatre(!theatre)}
          full={full}
          onFull={toggleFull}
          pipAvailable={liveReady && pipSupported}
          onPip={() => {
            if (!liveReady) {
              notify('Picture-in-picture needs a ready stream.');
              return;
            }
            void live.pip().then((ok) => {
              if (!ok) notify('Picture-in-picture was blocked or is unavailable in this browser.');
            });
          }}
          time={engine.time}
          duration={timelineDuration}
        />

        {menu.kind === 'settings' && (
          <PlayerSettings
            tab={menu.tab}
            onTab={(tab) => setMenu({ kind: 'settings', tab })}
            onServers={() => setMenu({ kind: 'server' })}
            prefs={prefs}
            patch={patch}
            patchSubs={props.patchSubs}
            restoreSubs={props.restoreSubs}
            restoreAppearance={props.restoreAppearance}
            server={server}
            subTracks={live.subTracks}
            subState={live.subState}
            subReady={liveReady}
            playingAudio={live.info?.audio === 'dub' ? 'dub' : 'sub'}
            audioList={audioList}
            audioStatus={audioStatus}
            audioError={audioError}
            onAudio={setAudio}
          />
        )}

        {menu.kind === 'server' && (
          <ServerSelector
            servers={[{ ...LIVE_SERVER, status: serverStatus }]}
            currentId={LIVE_SERVER.id}
            onSelect={() => pickServer()}
            onRetry={live.retry}
            onClose={() => setMenu({ kind: 'none' })}
          />
        )}
      </div>
    </div>
  );
}
