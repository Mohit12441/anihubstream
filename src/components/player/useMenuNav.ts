import { useCallback, useEffect, useRef } from 'react';

/** Arrow/Home/End roving focus inside an open player menu. */
export function useMenuNav<T extends HTMLElement>(open: boolean) {
  const ref = useRef<T>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof Node && !el.contains(e.target)) return;
      const items = Array.from(
        el.querySelectorAll<HTMLButtonElement>('button:not([disabled])'),
      );
      if (!items.length) return;
      const idx = items.indexOf(document.activeElement as HTMLButtonElement);
      let next = -1;
      if (e.key === 'ArrowDown') next = idx < 0 ? 0 : (idx + 1) % items.length;
      else if (e.key === 'ArrowUp') next = idx < 0 ? items.length - 1 : (idx - 1 + items.length) % items.length;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = items.length - 1;
      if (next < 0) return;
      e.preventDefault();
      items[next].focus();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open]);

  /** Move focus into a freshly opened sub-panel only when the viewer is on the keyboard. */
  const focusFirst = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    if (!el.contains(document.activeElement)) return;
    el.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus();
  }, []);

  return { ref, focusFirst };
}
