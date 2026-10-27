import { useCallback, useEffect, useState } from 'react';
import {
  ACCENTS,
  DEFAULT_PREFS,
  DEFAULT_SUBTITLES,
  loadPositions,
  loadPrefs,
  savePosition,
  savePrefs,
  type AccentId,
  type PositionMap,
  type PlayerPrefs,
  type SubtitleSettings,
} from './playerPrefs';

const INK: Record<AccentId, string> = {
  crimson: '#fff',
  purple: '#fff',
  blue: '#fff',
  emerald: '#04140d',
  neutral: '#12131a',
};

export function accentVars(id: AccentId): Record<string, string> {
  const color = ACCENTS.find((a) => a.id === id)?.color ?? 'var(--crimson)';
  return { '--p-accent': color, '--p-accent-ink': INK[id] ?? '#fff' };
}

export function usePlayerPreferences() {
  const [prefs, setPrefs] = useState<PlayerPrefs>(loadPrefs);
  const [positions, setPositions] = useState<PositionMap>(loadPositions);

  useEffect(() => {
    savePrefs(prefs);
  }, [prefs]);

  const patch = useCallback((next: Partial<PlayerPrefs>) => {
    setPrefs((p) => ({ ...p, ...next }));
  }, []);

  const patchSubs = useCallback((next: Partial<SubtitleSettings>) => {
    setPrefs((p) => ({ ...p, subtitles: { ...p.subtitles, ...next } }));
  }, []);

  const restoreSubs = useCallback(() => {
    setPrefs((p) => ({ ...p, subtitles: { ...DEFAULT_SUBTITLES, language: p.subtitles.language } }));
  }, []);

  const restoreAppearance = useCallback(() => {
    setPrefs((p) => ({ ...p, accent: DEFAULT_PREFS.accent, density: DEFAULT_PREFS.density }));
  }, []);

  const record = useCallback((key: string, t: number, d: number) => {
    setPositions(savePosition(key, t, d));
  }, []);

  return { prefs, patch, patchSubs, restoreSubs, restoreAppearance, positions, record };
}
