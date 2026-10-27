export type ShortcutAction =
  | 'toggle'
  | 'back5'
  | 'fwd5'
  | 'back10'
  | 'fwd10'
  | 'volUp'
  | 'volDown'
  | 'mute'
  | 'fullscreen'
  | 'theatre'
  | 'captions'
  | 'settings'
  | 'shortcuts'
  | 'next'
  | 'prev'
  | 'escape';

const LOWER = new Map<string, ShortcutAction>([
  ['space', 'toggle'],
  ['k', 'toggle'],
  ['arrowleft', 'back5'],
  ['arrowright', 'fwd5'],
  ['shift+arrowleft', 'back10'],
  ['shift+arrowright', 'fwd10'],
  ['arrowup', 'volUp'],
  ['arrowdown', 'volDown'],
  ['m', 'mute'],
  ['f', 'fullscreen'],
  ['t', 'theatre'],
  ['c', 'captions'],
  ['s', 'settings'],
  ['?', 'shortcuts'],
  ['shift+?', 'shortcuts'],
  ['n', 'next'],
  ['p', 'prev'],
  ['escape', 'escape'],
]);

export function actionFor(e: KeyboardEvent): ShortcutAction | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  const key = e.key === ' ' ? 'space' : e.key.toLowerCase();
  const withShift = `shift+${key}`;
  if (e.shiftKey && LOWER.has(withShift)) return LOWER.get(withShift) ?? null;
  return LOWER.get(key) ?? null;
}

/** Never hijack typing into fields the viewer is actually using. */
export function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return true;
  if (el.isContentEditable) return true;
  return !!el.closest?.('[contenteditable="true"], [role="combobox"], [role="listbox"]');
}

export const SHORTCUT_GROUPS: { title: string; items: { keys: string[]; label: string }[] }[] = [
  {
    title: 'Playback',
    items: [
      { keys: ['Space', 'K'], label: 'Play / pause' },
      { keys: ['←'], label: 'Back 5 s' },
      { keys: ['→'], label: 'Forward 5 s' },
      { keys: ['Shift', '← / →'], label: 'Jump 10 s' },
      { keys: ['N'], label: 'Next episode' },
      { keys: ['P'], label: 'Previous episode' },
    ],
  },
  {
    title: 'Audio',
    items: [
      { keys: ['↑'], label: 'Volume up' },
      { keys: ['↓'], label: 'Volume down' },
      { keys: ['M'], label: 'Mute / unmute' },
    ],
  },
  {
    title: 'Display',
    items: [
      { keys: ['F'], label: 'Fullscreen' },
      { keys: ['T'], label: 'Theatre mode' },
      { keys: ['C'], label: 'Captions on / off' },
      { keys: ['S'], label: 'Settings' },
      { keys: ['?'], label: 'This shortcut list' },
      { keys: ['Esc'], label: 'Close menu / leave mode' },
    ],
  },
];
