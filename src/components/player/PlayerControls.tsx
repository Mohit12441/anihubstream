import {
  Captions,
  CaptionsOff,
  FastForward,
  Maximize,
  Minimize,
  Pause,
  PictureInPicture,
  Play,
  Rewind,
  Server,
  Settings2,
  SkipBack,
  SkipForward,
  Theater,
  Volume1,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { ServerStatus } from '../../data/servers';
import { stamp } from '../../lib/time';

interface Props {
  playing: boolean;
  onToggle: () => void;
  onBack10: () => void;
  onFwd10: () => void;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  volume: number;
  muted: boolean;
  onVolume: (v: number) => void;
  onMute: () => void;
  speed: number;
  quality: string;
  onQuality: () => void;
  subOn: boolean;
  subLang: string;
  onToggleCaptions: () => void;
  settingsOpen: boolean;
  onSettings: () => void;
  serversOpen: boolean;
  onServers: () => void;
  serverName: string;
  serverStatus: ServerStatus;
  theatre: boolean;
  onTheatre: () => void;
  full: boolean;
  onFull: () => void;
  pipAvailable: boolean;
  onPip: () => void;
  time: number;
  duration: number;
}

export function PlayerControls(p: Props) {
  const Vol = p.muted || p.volume === 0 ? VolumeX : p.volume > 0.55 ? Volume2 : Volume1;

  return (
    <div className="pl__ctrls">
      <button type="button" className="pl__btn pl__btn--main" onClick={p.onToggle} aria-label={p.playing ? 'Pause' : 'Play'}>
        {p.playing ? <Pause size={20} /> : <Play size={20} fill="currentColor" strokeWidth={0} />}
      </button>

      <button type="button" className="pl__btn" onClick={p.onBack10} aria-label="Back 10 seconds">
        <Rewind size={18} aria-hidden="true" />
        <span className="pl__btn-tag">10</span>
      </button>
      <button type="button" className="pl__btn" onClick={p.onFwd10} aria-label="Forward 10 seconds">
        <FastForward size={18} aria-hidden="true" />
        <span className="pl__btn-tag">10</span>
      </button>

      <button
        type="button"
        className="pl__btn"
        onClick={p.onPrev}
        disabled={!p.hasPrev}
        aria-disabled={!p.hasPrev}
        aria-label="Previous episode"
      >
        <SkipBack size={18} />
      </button>
      <button
        type="button"
        className="pl__btn"
        onClick={p.onNext}
        disabled={!p.hasNext}
        aria-disabled={!p.hasNext}
        aria-label="Next episode"
      >
        <SkipForward size={18} />
      </button>

      <button
        type="button"
        className={`pl__btn${p.muted ? ' is-on' : ''}`}
        onClick={p.onMute}
        aria-label={p.muted || p.volume === 0 ? 'Unmute' : 'Mute'}
      >
        <Vol size={18} />
      </button>
      <input
        className="pl__vol"
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={p.muted ? 0 : p.volume}
        onChange={(e) => p.onVolume(Number(e.target.value))}
        aria-label="Volume"
        aria-valuetext={`${Math.round((p.muted ? 0 : p.volume) * 100)} percent`}
      />

      <span className="pl__time">
        {stamp(p.time)} <span>/ {p.duration > 0 ? stamp(p.duration) : '––:––'}</span>
      </span>

      <div className="pl__right">
        {p.speed !== 1 && <span className="pl__pill">Speed {p.speed}×</span>}

        <button
          type="button"
          className="pl__lab"
          onClick={p.onQuality}
          aria-haspopup="dialog"
          aria-label={`Quality: ${p.quality}`}
          title="Stream quality — resolved by the bridge"
        >
          {p.quality}
        </button>

        <button
          type="button"
          className={`pl__btn${p.subOn ? ' is-on' : ''}`}
          onClick={p.onToggleCaptions}
          aria-pressed={p.subOn}
          aria-label={p.subOn ? `Captions on, ${p.subLang}` : 'Captions off'}
          title="Captions (C)"
        >
          {p.subOn ? <Captions size={18} /> : <CaptionsOff size={18} />}
        </button>

        <button
          type="button"
          className={`pl__btn${p.settingsOpen ? ' is-on' : ''}`}
          onClick={p.onSettings}
          aria-label="Player settings"
          aria-expanded={p.settingsOpen}
          title="Settings (S)"
        >
          <Settings2 size={18} />
        </button>

        <button
          type="button"
          className={`pl__lab${p.serversOpen ? ' is-on' : ''}`}
          onClick={p.onServers}
          aria-expanded={p.serversOpen}
          aria-label={`Stream server: ${p.serverName}, ${p.serverStatus}`}
          title="Stream server"
        >
          <Server size={14} aria-hidden="true" />
          {p.serverName}
        </button>

        <button
          type="button"
          className={`pl__btn pl__btn--theatre${p.theatre ? ' is-on' : ''}`}
          onClick={p.onTheatre}
          aria-pressed={p.theatre}
          aria-label={p.theatre ? 'Exit theatre mode' : 'Theatre mode'}
          title="Theatre (T)"
        >
          <Theater size={18} />
        </button>

        <button
          type="button"
          className="pl__btn pl__btn--pip"
          onClick={p.onPip}
          disabled={!p.pipAvailable}
          aria-disabled={!p.pipAvailable}
          aria-label="Picture-in-picture"
          title={p.pipAvailable ? 'Picture-in-picture' : 'Available once the stream is ready'}
        >
          <PictureInPicture size={18} />
        </button>

        <button
          type="button"
          className="pl__btn"
          onClick={p.onFull}
          aria-label={p.full ? 'Exit fullscreen' : 'Fullscreen'}
          title="Fullscreen (F)"
        >
          {p.full ? <Minimize size={18} /> : <Maximize size={18} />}
        </button>
      </div>
    </div>
  );
}
