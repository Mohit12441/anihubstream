import { RotateCcw } from 'lucide-react';
import {
  SUBTITLE_PRESETS,
  subLangLabel,
  type CaptionBackdrop,
  type CaptionFont,
  type CaptionPosition,
  type CaptionShadow,
  type SubtitleSettings as Subs,
} from '../../lib/playerPrefs';
import type { SubStatus, SubTrack } from '../../lib/useLiveStream';
import { PopGrid, PopGroup, PopRow, PopSwitch } from './PopRows';
import { captionAnchor, captionStyle } from './captionStyle';

const COLORS = [
  { v: '#ffffff', n: 'White' },
  { v: '#ffe066', n: 'Yellow' },
  { v: '#7dd3fc', n: 'Sky' },
  { v: '#ff5470', n: 'Rose' },
  { v: '#2ee6a8', n: 'Mint' },
  { v: '#c4b5fd', n: 'Lilac' },
];

const FONTS: { id: CaptionFont; label: string }[] = [
  { id: 'sans', label: 'Sans (Inter)' },
  { id: 'classic', label: 'Classic Anime' },
  { id: 'serif', label: 'Cinema Serif' },
  { id: 'mono', label: 'Monospace' },
  { id: 'display', label: 'Display' },
];

const SHADOWS: { id: CaptionShadow; label: string }[] = [
  { id: 'outline', label: 'Standard' },
  { id: 'heavy', label: 'Heavy Outline' },
  { id: 'glow', label: 'Ambient Glow' },
  { id: 'drop', label: 'Drop Shadow' },
  { id: 'none', label: 'None' },
];

const BACKDROPS: { id: CaptionBackdrop; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'box', label: 'Box' },
  { id: 'shadow', label: 'Shadow' },
];

const POSITIONS: { id: CaptionPosition; label: string }[] = [
  { id: 'bottom', label: 'Bottom' },
  { id: 'middle', label: 'Middle' },
  { id: 'top', label: 'Top' },
];

interface Props {
  subs: Subs;
  patch: (p: Partial<Subs>) => void;
  restore: () => void;
  /** caption tracks the resolved stream actually carries */
  tracks: SubTrack[];
  /** what the chosen track really did */
  state: SubStatus;
  /** the stream has resolved, so `tracks` reflects reality */
  loaded: boolean;
  hardsub: boolean;
}

/** one honest line under the track grid, keyed to the real fetch outcome */
function stateLine(state: SubStatus, chosen: SubTrack | undefined, requestedLabel: string): string | null {
  switch (state) {
    case 'loading':
      return 'Loading subtitles…';
    case 'shown':
      return `Showing ${chosen?.label ?? requestedLabel} subtitles.`;
    case 'missing':
      return `This episode does not have ${requestedLabel} subtitles. Pick a track above to change it.`;
    case 'unreadable':
      return `The ${chosen?.label ?? requestedLabel} track contains no readable cues. Please pick another track.`;
    case 'failed':
      return 'Unable to load subtitles. Try again or pick another track.';
    default:
      return null;
  }
}

export function SubtitlePanel({ subs, patch, restore, tracks, state, loaded, hardsub }: Props) {
  const selectedId = subs.enabled ? subs.language : '';
  const chosen = tracks.find((t) => t.key === subs.language || t.name === subs.language);
  const requestedLabel = chosen?.label ?? subLangLabel(subs.language);
  const line = stateLine(state, chosen, requestedLabel);

  return (
    <>
      <PopGroup title="Track">
        <PopSwitch label="Captions" checked={subs.enabled} onChange={(v) => patch({ enabled: v })} />
        {hardsub && (
          <p className="pop__warn" id="subs-hardsub">
            This source burns captions into the picture, so the language list is informational only.
          </p>
        )}
        {!loaded ? (
          <p className="pop__hint">Available subtitles will appear here once loaded.</p>
        ) : tracks.length === 0 ? (
          <p className="pop__hint">
            This stream carries no selectable caption track — the provider did not list one for this episode. Nothing is
            shown in its place.
          </p>
        ) : (
          <>
            <PopGrid
              options={[
                { id: 'off', label: 'Off' },
                ...tracks.map((t) => ({ id: t.key, label: t.label })),
              ]}
              value={subs.enabled ? selectedId : 'off'}
              onPick={(id) => {
                if (id === 'off') {
                  patch({ enabled: false });
                } else {
                  patch({ language: id, enabled: true });
                }
              }}
            />
            {subs.enabled && line && (
              <p className="pop__hint" role="status">
                {line}
              </p>
            )}
          </>
        )}
      </PopGroup>

      <PopGroup title="Style Presets">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
          {SUBTITLE_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => patch(preset.settings)}
              title={preset.description}
              style={{
                padding: '8px 10px',
                borderRadius: '6px',
                fontSize: '0.8rem',
                fontWeight: 600,
                textAlign: 'left',
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                color: '#f8fafc',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(99, 102, 241, 0.2)';
                e.currentTarget.style.borderColor = 'var(--brand, #6366f1)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
              }}
            >
              <div>{preset.name}</div>
              <div style={{ fontSize: '0.68rem', color: '#94a3b8', fontWeight: 400, marginTop: '2px' }}>
                {preset.settings.font} · {preset.settings.shadow}
              </div>
            </button>
          ))}
        </div>
      </PopGroup>

      <PopGroup title="Typography">
        <PopGrid
          options={FONTS}
          value={subs.font || 'sans'}
          onPick={(id) => patch({ font: id as CaptionFont })}
        />
      </PopGroup>

      <PopGroup title="Size">
        <label className="pop__slider">
          <span>Font size</span>
          <output>{subs.size}px</output>
          <input
            type="range"
            min={11}
            max={30}
            step={1}
            value={subs.size}
            onChange={(e) => patch({ size: Number(e.target.value) })}
            aria-label="Caption font size"
          />
        </label>
        <label className="pop__slider">
          <span>Background opacity</span>
          <output>{Math.round(subs.background * 100)}%</output>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={subs.background}
            onChange={(e) => patch({ background: Number(e.target.value) })}
            aria-label="Caption background opacity"
          />
        </label>
        <PopSwitch label="Text outline" checked={subs.outline} onChange={(v) => patch({ outline: v })} />
      </PopGroup>

      <PopGroup title="Colour">
        <div className="pop__swatches" role="radiogroup" aria-label="Caption text colour">
          {COLORS.map((c) => (
            <button
              key={c.v}
              type="button"
              role="radio"
              aria-checked={subs.color.toLowerCase() === c.v}
              aria-label={c.n}
              title={c.n}
              className={`pop__sw${subs.color.toLowerCase() === c.v ? ' is-on' : ''}`}
              style={{ background: c.v }}
              onClick={() => patch({ color: c.v })}
            />
          ))}
        </div>
      </PopGroup>

      <PopGroup title="Backdrop">
        <PopGrid
          options={BACKDROPS}
          value={subs.backdrop}
          onPick={(id) => patch({ backdrop: id as CaptionBackdrop })}
        />
      </PopGroup>

      <PopGroup title="Text Shadow & Outline">
        <PopGrid
          options={SHADOWS}
          value={subs.shadow || (subs.outline ? 'outline' : 'none')}
          onPick={(id) => patch({ shadow: id as CaptionShadow, outline: id !== 'none' })}
        />
      </PopGroup>

      <PopGroup title="Position">
        <PopGrid options={POSITIONS} value={subs.position} onPick={(id) => patch({ position: id as CaptionPosition })} />
        <p className="pop__hint">Middle and top move the caption away from the controls and the centre button.</p>
      </PopGroup>

      <PopGroup title="Audio Sync Offset">
        <label className="pop__slider">
          <span>Timing Sync</span>
          <output style={{ fontWeight: 600, color: (subs.offset || 0) === 0 ? '#94a3b8' : '#a5b4fc' }}>
            {(subs.offset || 0) === 0
              ? 'In Sync (0.0s)'
              : (subs.offset || 0) > 0
              ? `+${(subs.offset || 0).toFixed(1)}s (Delayed)`
              : `${(subs.offset || 0).toFixed(1)}s (Advanced)`}
          </output>
          <input
            type="range"
            min={-3}
            max={3}
            step={0.1}
            value={subs.offset || 0}
            onChange={(e) => patch({ offset: Number.parseFloat(e.target.value) })}
            aria-label="Subtitle synchronization offset in seconds"
          />
        </label>
        <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
          <button
            type="button"
            onClick={() => patch({ offset: Math.max(-5, Number(((subs.offset || 0) - 0.5).toFixed(1))) })}
            style={{
              flex: 1,
              padding: '4px 8px',
              borderRadius: '4px',
              fontSize: '0.75rem',
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              color: '#cbd5e1',
              cursor: 'pointer',
            }}
          >
            −0.5s Earlier
          </button>
          <button
            type="button"
            onClick={() => patch({ offset: 0 })}
            style={{
              padding: '4px 10px',
              borderRadius: '4px',
              fontSize: '0.75rem',
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              color: '#94a3b8',
              cursor: 'pointer',
            }}
          >
            Reset
          </button>
          <button
            type="button"
            onClick={() => patch({ offset: Math.min(5, Number(((subs.offset || 0) + 0.5).toFixed(1))) })}
            style={{
              flex: 1,
              padding: '4px 8px',
              borderRadius: '4px',
              fontSize: '0.75rem',
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              color: '#cbd5e1',
              cursor: 'pointer',
            }}
          >
            +0.5s Later
          </button>
        </div>
        <p className="pop__hint">Fine-tune caption timing to match dialogue audio perfectly.</p>
      </PopGroup>

      <PopGroup title="Preview">
        <div className={`cap-preview ${captionAnchor(subs)}`}>
          <span className="cap-line" style={captionStyle(subs)}>
            Caption preview — the real track arrives with the stream.
          </span>
        </div>
      </PopGroup>

      <PopRow
        label="Restore caption defaults"
        icon={<RotateCcw size={15} aria-hidden="true" />}
        onClick={restore}
        radio={false}
      />
    </>
  );
}
