import { SHORTCUT_GROUPS } from '../../lib/shortcuts';
import { PopGroup } from './PopRows';

export function ShortcutsPanel() {
  return (
    <>
      {SHORTCUT_GROUPS.map((g) => (
        <PopGroup key={g.title} title={g.title}>
          <ul className="pop__keys">
            {g.items.map((it) => (
              <li key={it.label}>
                <span>{it.label}</span>
                <kbd>{it.keys.join(' + ')}</kbd>
              </li>
            ))}
          </ul>
        </PopGroup>
      ))}
      <p className="pop__hint">Shortcuts are ignored while you are typing in a search box or text field.</p>
    </>
  );
}
