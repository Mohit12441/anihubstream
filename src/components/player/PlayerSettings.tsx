import { useEffect } from 'react';
import {
  AudioWaveform,
  Captions,
  Clapperboard,
  Gauge,
  Keyboard,
  LayoutTemplate,
  Palette,
  Server,
  SlidersHorizontal,
} from 'lucide-react';
import type { StreamServer } from '../../data/servers';
import {
  ACCENTS,
  ASPECTS,
  SPEEDS,
  SUB_LANG_NAMES,
  subLangLabel,
  type AudioId,
  type PlayerPrefs,
  type SubtitleSettings,
} from '../../lib/playerPrefs';
import type { SubStatus, SubTrack } from '../../lib/useLiveStream';
import type { AudioList } from '../../lib/streamBridge';
import { PopGrid, PopGroup, PopHead, PopRow, PopShell, PopSwitch } from './PopRows';
import { ShortcutsPanel } from './KeyboardShortcuts';
import { SubtitlePanel } from './SubtitlePanel';
import { useMenuNav } from './useMenuNav';

export type SettingsTab =
  | 'root'
  | 'speed'
  | 'aspect'
  | 'audio'
  | 'subs'
  | 'behaviour'
  | 'appearance'
  | 'shortcuts';

const TITLES: Record<SettingsTab, string> = {
  root: 'Settings',
  speed: 'Playback speed',
  aspect: 'Aspect ratio',
  audio: 'Audio',
  subs: 'Subtitles',
  behaviour: 'Behaviour',
  appearance: 'Appearance',
  shortcuts: 'Keyboard shortcuts',
};

interface Props {
  tab: SettingsTab;
  onTab: (t: SettingsTab) => void;
  onServers: () => void;
  prefs: PlayerPrefs;
  patch: (p: Partial<PlayerPrefs>) => void;
  patchSubs: (p: Partial<SubtitleSettings>) => void;
  restoreSubs: () => void;
  restoreAppearance: () => void;
  server: StreamServer;
  /** caption tracks the resolved stream actually carries */
  subTracks: SubTrack[];
  subState: SubStatus;
  /** the stream has resolved, so subTracks reflects reality (empty before it does) */
  subReady: boolean;
  /** audio: what is really playing, and the probed availability */
  playingAudio: AudioId;
  audioList: AudioList | null;
  audioStatus: 'idle' | 'loading' | 'ready' | 'error';
  audioError: string | null;
  onAudio: (id: AudioId) => void;
}

export function PlayerSettings({
  tab,
  onTab,
  onServers,
  prefs,
  patch,
  patchSubs,
  restoreSubs,
  restoreAppearance,
  server,
  subTracks,
  subState,
  subReady,
  playingAudio,
  audioList,
  audioStatus,
  audioError,
  onAudio,
}: Props) {
  const { ref, focusFirst } = useMenuNav<HTMLDivElement>(true);

  useEffect(() => {
    focusFirst();
  }, [tab, focusFirst]);

  return (
    <PopShell
      label="Player settings"
      head={tab === 'root' ? undefined : <PopHead title={TITLES[tab]} onBack={() => onTab('root')} />}
      innerRef={ref}
      footer={
        tab === 'root'
          ? 'Preferences are stored on this device only.'
          : tab === 'aspect'
            ? 'Fit letterboxes and Fill crops the frame. Ratios never stretch the artwork.'
            : tab === 'subs'
              ? 'Captions use the provider track that arrives with the stream, when it carries one.'
              : undefined
      }
    >
      {tab === 'root' && (
        <>
          <PopRow
            icon={<Gauge size={16} aria-hidden="true" />}
            label="Playback speed"
            value={`${prefs.speed}×`}
            onClick={() => onTab('speed')}
          />
          <PopRow
            icon={<Clapperboard size={16} aria-hidden="true" />}
            label="Aspect ratio"
            value={ASPECTS.find((a) => a.id === prefs.aspect)?.label}
            onClick={() => onTab('aspect')}
          />
          <PopRow
            icon={<AudioWaveform size={16} aria-hidden="true" />}
            label="Audio"
            value={playingAudio === 'dub' ? 'DUB' : 'Original'}
            onClick={() => onTab('audio')}
          />
          <PopRow
            icon={<Captions size={16} aria-hidden="true" />}
            label="Subtitles"
            value={
              prefs.subtitles.enabled
                ? (subTracks.find((t) => t.key === prefs.subtitles.language || t.name === prefs.subtitles.language)?.label ??
                  subLangLabel(prefs.subtitles.language))
                : 'Off'
            }
            onClick={() => onTab('subs')}
          />
          <PopRow
            icon={<SlidersHorizontal size={16} aria-hidden="true" />}
            label="Behaviour"
            value={prefs.autoNext ? 'Auto-next on' : 'Auto-next off'}
            onClick={() => onTab('behaviour')}
          />
          <PopRow
            icon={<Palette size={16} aria-hidden="true" />}
            label="Appearance"
            value={ACCENTS.find((a) => a.id === prefs.accent)?.label}
            onClick={() => onTab('appearance')}
          />
          <PopRow
            icon={<Server size={16} aria-hidden="true" />}
            label="Server"
            value={server.name}
            onClick={onServers}
          />
          <PopRow
            icon={<Keyboard size={16} aria-hidden="true" />}
            label="Keyboard shortcuts"
            onClick={() => onTab('shortcuts')}
          />
        </>
      )}

      {tab === 'speed' && (
        <>
          <PopGroup title="Rate">
            <div className="pop__grid">
              {SPEEDS.map((s) => (
                <button
                  key={s}
                  type="button"
                  role="menuitemradio"
                  aria-checked={prefs.speed === s}
                  className={`pop__chip${prefs.speed === s ? ' is-on' : ''}`}
                  onClick={() => patch({ speed: s })}
                >
                  {s}×
                </button>
              ))}
            </div>
          </PopGroup>
          <p className="pop__hint">
            Speed applies directly to the real stream playback rate — the bridge stream is not re-fetched.
          </p>
        </>
      )}

      {tab === 'aspect' &&
        ASPECTS.map((a) => (
          <PopRow
            key={a.id}
            radio
            label={a.label}
            note={a.hint}
            active={prefs.aspect === a.id}
            onClick={() => patch({ aspect: a.id })}
          />
        ))}

      {tab === 'audio' &&
        (() => {
          const dubOpt = audioList?.audios.find((a) => a.id === 'dub');
          const checking = audioStatus === 'idle' || audioStatus === 'loading';
          const dubAvailable = audioStatus === 'ready' && Boolean(dubOpt?.available);
          return (
            <>
              <PopGroup title="Track">
                <PopRow
                  radio
                  label="Original (Japanese)"
                  note={playingAudio === 'sub' ? 'playing now' : undefined}
                  active={playingAudio === 'sub'}
                  onClick={() => onAudio('sub')}
                />
                <PopRow
                  radio
                  label="Dubbed (English)"
                  note={
                    playingAudio === 'dub'
                      ? 'playing now'
                      : audioStatus === 'error'
                        ? 'unverified'
                        : checking
                          ? 'checking…'
                          : dubAvailable
                            ? 'verified second audio'
                            : 'not offered'
                  }
                  active={playingAudio === 'dub'}
                  disabled={!dubAvailable}
                  onClick={() => onAudio('dub')}
                />
              </PopGroup>

              {checking && (
                <p className="pop__hint" role="status">
                  Measuring whether this source really carries a second audio…
                </p>
              )}
              {audioStatus === 'error' && (
                <p className="pop__warn" role="status">
                  {audioError ?? 'The dubbed audio could not be checked right now.'}
                </p>
              )}
              {audioStatus === 'ready' && !dubAvailable && (
                <p className="pop__hint">
                  {dubOpt?.reason ?? 'This source has no verified dubbed audio for this episode.'}
                </p>
              )}
              <p className="pop__hint">
                A dub is selectable only when the bridge proves the source carries audio that differs from the
                original — never on the site's label alone.
              </p>
            </>
          );
        })()}

      {tab === 'subs' && (
        <SubtitlePanel
          subs={prefs.subtitles}
          patch={patchSubs}
          restore={restoreSubs}
          tracks={subTracks}
          state={subState}
          loaded={subReady}
          hardsub={server.capabilities.subtitleType === 'hardsub'}
        />
      )}

      {tab === 'behaviour' && (
        <>
          <PopGroup title="Playback">
            <PopSwitch
              label="Auto-play next episode"
              hint="Only when an episode actually reaches its end"
              checked={prefs.autoNext}
              onChange={(v) => patch({ autoNext: v })}
            />
            <PopSwitch
              label="Auto-skip opening"
              hint="Jumps the opening window the provider reports"
              checked={prefs.autoSkipIntro}
              onChange={(v) => patch({ autoSkipIntro: v })}
            />
            <PopSwitch
              label="Auto-skip ending"
              checked={prefs.autoSkipOutro}
              onChange={(v) => patch({ autoSkipOutro: v })}
            />
            <PopSwitch
              label="Remember my position"
              hint="Resumes this episode where you stopped"
              checked={prefs.rememberPosition}
              onChange={(v) => patch({ rememberPosition: v })}
            />
          </PopGroup>

          <PopGroup title="Defaults for new episodes">
            <p className="pop__hint">Default speed</p>
            <PopGrid
              options={[{ id: 'last', label: 'Last used' }, ...SPEEDS.map((s) => ({ id: String(s), label: `${s}×` }))]}
              value={prefs.defaultSpeed === null ? 'last' : String(prefs.defaultSpeed)}
              onPick={(id) => patch({ defaultSpeed: id === 'last' ? null : Number(id) })}
            />
            <p className="pop__hint">Default subtitle language</p>
            <PopGrid
              options={[
                { id: 'last', label: 'Last used' },
                ...Object.entries(SUB_LANG_NAMES).map(([id, label]) => ({ id, label })),
              ]}
              value={prefs.defaultSubLang === null ? 'last' : prefs.defaultSubLang}
              onPick={(id) =>
                patch({
                  defaultSubLang: id === 'last' ? null : id,
                  subtitles: id === 'last' ? prefs.subtitles : { ...prefs.subtitles, language: id, enabled: true },
                })
              }
            />
          </PopGroup>
        </>
      )}

      {tab === 'appearance' && (
        <>
          <PopGroup title="Accent">
            <div className="pop__accents" role="radiogroup" aria-label="Player accent colour">
              {ACCENTS.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  role="radio"
                  aria-checked={prefs.accent === a.id}
                  className={`pop__accent${prefs.accent === a.id ? ' is-on' : ''}`}
                  onClick={() => patch({ accent: a.id })}
                >
                  <i style={{ background: a.color }} aria-hidden="true" />
                  {a.label}
                </button>
              ))}
            </div>
          </PopGroup>
          <PopGroup title="Control spacing">
            <PopGrid
              options={[
                { id: 'comfortable', label: 'Comfortable' },
                { id: 'compact', label: 'Compact' },
              ]}
              value={prefs.density}
              onPick={(id) => patch({ density: id === 'compact' ? 'compact' : 'comfortable' })}
            />
          </PopGroup>
          <PopRow
            icon={<LayoutTemplate size={16} aria-hidden="true" />}
            label="Restore default appearance"
            onClick={restoreAppearance}
          />
          <p className="pop__hint">Accent affects the player, timeline, selected episode and focus rings.</p>
        </>
      )}

      {tab === 'shortcuts' && <ShortcutsPanel />}
    </PopShell>
  );
}
