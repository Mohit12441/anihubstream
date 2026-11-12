import { useEffect } from 'react';

/**
 * useMouseGlow
 * High-performance mouse coordinate and 3D tilt listener that updates CSS variables
 * directly on target elements (.acard, .ad-hero, .ad-ep-card, .watch__servers-external)
 * without triggering React renders, keeping 120fps fluid interaction.
 */
export function useMouseGlow() {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    let activeCard: HTMLElement | null = null;

    const onMouseMove = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const card = target?.closest('.acard, .ad-hero, .ad-ep-card, .watch__servers-external') as HTMLElement | null;

      if (activeCard && activeCard !== card) {
        activeCard.style.setProperty('--tilt-x', '0');
        activeCard.style.setProperty('--tilt-y', '0');
        activeCard = null;
      }

      if (!card) return;
      activeCard = card;

      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const normX = Math.max(-1, Math.min(1, (x / rect.width - 0.5) * 2));
      const normY = Math.max(-1, Math.min(1, (y / rect.height - 0.5) * 2));

      card.style.setProperty('--mouse-x', `${x}px`);
      card.style.setProperty('--mouse-y', `${y}px`);
      card.style.setProperty('--tilt-x', normX.toFixed(3));
      card.style.setProperty('--tilt-y', normY.toFixed(3));
    };

    const onMouseLeave = () => {
      if (activeCard) {
        activeCard.style.setProperty('--tilt-x', '0');
        activeCard.style.setProperty('--tilt-y', '0');
        activeCard = null;
      }
    };

    window.addEventListener('mousemove', onMouseMove, { passive: true });
    document.addEventListener('mouseleave', onMouseLeave);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseleave', onMouseLeave);
    };
  }, []);
}
