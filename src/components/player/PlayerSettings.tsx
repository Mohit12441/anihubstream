import { useEffect, useState } from 'react';
import {
  AudioWaveform,
  Captions,
  Clapperboard,
  Gauge,
  Keyboard,
  LayoutTemplate,
  Palette,
  SlidersHorizontal,
} from 'lucide-react';
import {
  ACCENTS,
  ASPECTS,
  QUALITIES,
  SPEEDS,
  SUB_LANG_NAMES,
  subLangLabel,
  type AudioId,
  type PlayerPrefs,
  type SubtitleSettings,
} from '../../lib/playerPrefs';
import type { SubStatus, SubTrack } from '../../lib/useLiveStream';
import type { AudioList } from '../../lib/streamBridge';
import { clearStreamCache, getStreamCacheStats, type CacheStats } from '../../lib/pwa';
import { PopGrid, PopGroup, PopHead, PopRow, PopShell, PopSwitch } from './PopRows';
import { ShortcutsPanel } from './KeyboardShortcuts';
import { SubtitlePanel } from './SubtitlePanel';
import { useMenuNav } from './useMenuNav';

export type SettingsTab =
  | 'root'
  | 'quality'
  | 'speed'
  | 'aspect'
  | 'audio'
  | 'subs'
  | 'behaviour'
  | 'appearance'
  | 'shortcuts';

const TITLES: Record<SettingsTab, string> = {
  root: 'Settings',
  quality: 'Quality',
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
  prefs: PlayerPrefs;
  patch: (p: Partial<PlayerPrefs>) => void;
  patchSubs: (p: Partial<SubtitleSettings>) => void;
  restoreSubs: () => void;
  restoreAppearance: () => void;
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
  switchableAudio?: boolean;
  hlsAudioTracks?: { id: number; name: string; lang?: string; default?: boolean }[];
  currentHlsAudioTrack?: number;
  onSwitchHlsAudioTrack?: (id: number) => void;
  qualities?: { id: string; label: string; index: number }[];
  currentQualityIndex?: number;
  currentQualityLabel?: string;
  onQualityPick?: (index: number, label: string) => void;
}

export function PlayerSettings({
  tab,
  onTab,
  prefs,
  patch,
  patchSubs,
  restoreSubs,
  restoreAppearance,
  subTracks,
  subState,
  subReady,
  playingAudio,
  audioList,
  audioStatus,
  audioError,
  onAudio,
  switchableAudio: _switchableAudio,
  hlsAudioTracks,
  currentHlsAudioTrack,
  onSwitchHlsAudioTrack,
  qualities,
  currentQualityIndex,
  currentQualityLabel,
  onQualityPick,
}: Props) {
  const { ref, focusFirst } = useMenuNav<HTMLDivElement>(true);
  const [cacheStats, setCacheStats] = useState<CacheStats | null>(null);

  useEffect(() => {
    if (tab === 'behaviour') {
      getStreamCacheStats().then(setCacheStats);
    }
  }, [tab]);

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
          : tab === 'quality'
            ? (qualities && qualities.length <= 1
                ? 'Stream is direct 1080p source. 720p & 360p available via Download.'
                : 'Quality switches instantly via adaptive bitrate levels.')
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
            icon={<SlidersHorizontal size={16} aria-hidden="true" />}
            label="Quality"
            value={currentQualityLabel ?? (prefs.quality === 'auto' ? 'Auto' : prefs.quality)}
            onClick={() => onTab('quality')}
          />
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
            value={
              hlsAudioTracks && hlsAudioTracks.length > 0 && currentHlsAudioTrack !== undefined && currentHlsAudioTrack !== -1 && hlsAudioTracks[currentHlsAudioTrack]
                ? (hlsAudioTracks[currentHlsAudioTrack].name && !hlsAudioTracks[currentHlsAudioTrack].name.startsWith('Audio Track')
                    ? hlsAudioTracks[currentHlsAudioTrack].name
                    : (playingAudio === 'dub' ? 'English (Dub)' : 'Japanese (Original)'))
                : (playingAudio === 'dub'
                    ? 'English (Dub)'
                    : playingAudio === 'hindi'
                      ? 'Hindi'
                      : 'Japanese (Original)')
            }
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
            icon={<LayoutTemplate size={16} aria-hidden="true" />}
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
            icon={<Keyboard size={16} aria-hidden="true" />}
            label="Keyboard shortcuts"
            onClick={() => onTab('shortcuts')}
          />
        </>
      )}

      {tab === 'quality' && (
        <PopGroup title="Resolution">
          <PopRow
            radio
            label="Auto"
            note="Adaptive Bitrate (ABR)"
            active={currentQualityIndex === -1}
            onClick={() => {
              patch({ quality: 'auto' });
              onQualityPick?.(-1, 'Auto');
            }}
          />
          {qualities && qualities.length > 0 ? (
            qualities.map((q) => (
              <PopRow
                key={q.id}
                radio
                label={q.label}
                note={qualities.length === 1 ? 'direct source' : undefined}
                active={currentQualityIndex === q.index}
                onClick={() => {
                  patch({ quality: q.label as any });
                  onQualityPick?.(q.index, q.label);
                }}
              />
            ))
          ) : (
            QUALITIES.filter((q) => q.id !== 'auto').map((q) => (
              <PopRow
                key={q.id}
                radio
                label={q.label}
                active={prefs.quality === q.id}
                onClick={() => {
                  patch({ quality: q.id });
                  onQualityPick?.(-1, q.label);
                }}
              />
            ))
          )}
        </PopGroup>
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
            Speed applies directly to the video playback rate without re-buffering.
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
          if (hlsAudioTracks && hlsAudioTracks.length > 0) {
            return (
              <PopGroup title="Audio Tracks">
                {hlsAudioTracks.map((t, idx) => {
                  const defaultLabel = playingAudio === 'dub' ? 'English (Dub)' : 'Japanese (Original)';
                  const trackLabel = t.name && !t.name.startsWith('Audio Track') ? t.name : (idx === 0 ? defaultLabel : (t.name || `Audio Track ${idx + 1}`));
                  const isCurrent = currentHlsAudioTrack === t.id || (currentHlsAudioTrack === -1 && idx === 0);
                  return (
                    <PopRow
                      key={t.id}
                      radio
                      label={trackLabel}
                      note={isCurrent ? 'playing now' : undefined}
                      active={isCurrent}
                      onClick={() => onSwitchHlsAudioTrack?.(t.id)}
                    />
                  );
                })}
              </PopGroup>
            );
          }
          const dubOpt = audioList?.audios.find((a) => a.id === 'dub');
          const checking = audioStatus === 'idle' || audioStatus === 'loading';
          const dubAvailable = audioStatus === 'ready' && Boolean(dubOpt?.available);
          return (
            <>
              <PopGroup title="Track">
                {audioList?.audios && audioList.audios.length > 0 ? (
                  audioList.audios.map((a) => (
                    <PopRow
                      key={a.id}
                      radio
                      label={a.label}
                      note={
                        playingAudio === a.id
                          ? 'playing now'
                          : a.available
                            ? (a.state === 'verified' ? 'verified audio' : 'available')
                            : checking
                              ? 'checking…'
                              : 'not offered'
                      }
                      active={playingAudio === a.id}
                      disabled={!a.available && !checking}
                      onClick={() => onAudio(a.id as AudioId)}
                    />
                  ))
                ) : (
                  <>
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
                          : checking
                            ? 'checking…'
                            : dubAvailable
                              ? 'verified second audio'
                              : 'switch to dub'
                      }
                      active={playingAudio === 'dub'}
                      disabled={audioStatus === 'ready' && !dubAvailable && Boolean(audioList)}
                      onClick={() => onAudio('dub')}
                    />
                  </>
                )}
              </PopGroup>

              {checking && (
                <p className="pop__hint" role="status">
                  Measuring available audio tracks across providers…
                </p>
              )}
              {audioStatus === 'error' && (
                <p className="pop__warn" role="status">
                  {audioError ?? 'Audio tracks could not be verified right now.'}
                </p>
              )}
              {audioStatus === 'ready' && !dubAvailable && (
                <p className="pop__hint">
                  {dubOpt?.reason ?? 'This title has no verified dubbed audio for this episode.'}
                </p>
              )}
              <p className="pop__hint">
                Multi-audio and dubbed streams are selectable across all providers with automated fallback.
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
          hardsub={false}
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
            <PopSwitch
              label="P2P Mesh Streaming (Experimental)"
              hint="Shares buffered video chunks directly with concurrent peers via WebRTC to reduce server bandwidth"
              checked={prefs.enableP2P ?? false}
              onChange={(v) => patch({ enableP2P: v })}
            />
          </PopGroup>

          <PopGroup title="Offline Stream Buffer (PWA)">
            <PopRow
              label="Stream Segment Cache"
              value={cacheStats ? `${cacheStats.streamSegments} / ${cacheStats.maxSegments} segments` : 'Active'}
              note="Cached HLS chunks enable instant rewind and offline buffering. Click to clear."
              onClick={() => {
                clearStreamCache().then(() => {
                  getStreamCacheStats().then(setCacheStats);
                });
              }}
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
