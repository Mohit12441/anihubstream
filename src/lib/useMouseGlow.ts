import { useEffect } from 'react';

/**
 * useMouseGlow
 * High-performance mouse coordinate listener that updates CSS variables
 * directly on target elements (.acard, .ad-hero, .ad-ep-card, .watch__servers-external)
 * without triggering React renders, keeping 120fps fluid interaction.
 */
export function useMouseGlow() {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const onMouseMove = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const card = target?.closest('.acard, .ad-hero, .ad-ep-card, .watch__servers-external') as HTMLElement | null;
      if (!card) return;

      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      card.style.setProperty('--mouse-x', `${x}px`);
      card.style.setProperty('--mouse-y', `${y}px`);
    };

    window.addEventListener('mousemove', onMouseMove, { passive: true });
    return () => window.removeEventListener('mousemove', onMouseMove);
  }, []);
}
