import { RotateCcw } from 'lucide-react';
import {
  subLangLabel,
  type CaptionBackdrop,
  type CaptionPosition,
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
      return 'Loading the chosen caption file through the bridge…';
    case 'shown':
      return `Showing the ${chosen?.label ?? requestedLabel} track from this source.`;
    case 'missing':
      return `This episode's stream does not carry ${requestedLabel}. Pick a track above to change it.`;
    case 'unreadable':
      return `The ${chosen?.label ?? requestedLabel} file arrived but holds no readable cues — the provider sent an empty or unsupported track.`;
    case 'failed':
      return 'The caption file could not be fetched through the bridge. Try again or pick another track.';
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
          <p className="pop__hint">Caption tracks are listed once this episode resolves through the bridge.</p>
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

      <PopGroup title="Position">
        <PopGrid options={POSITIONS} value={subs.position} onPick={(id) => patch({ position: id as CaptionPosition })} />
        <p className="pop__hint">Middle and top move the caption away from the controls and the centre button.</p>
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
