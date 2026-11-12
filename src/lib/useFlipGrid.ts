import { useLayoutEffect, useRef } from 'react';
import { usePrefersReducedMotion } from './motion';

/**
 * Lightweight FLIP (First, Last, Invert, Play) hook for grid and list reflows.
 * Hardware-accelerated with translate3d and automatic cleanup.
 */
export function useFlipGrid<T extends HTMLElement>(
  containerRef: React.RefObject<T | null>,
  deps: unknown[]
) {
  const reduced = usePrefersReducedMotion();
  const prevRects = useRef<Map<string, DOMRect>>(new Map());

  useLayoutEffect(() => {
    if (reduced || !containerRef.current) return;

    const container = containerRef.current;
    const items = container.querySelectorAll<HTMLElement>('[data-flip-id]');
    const currentRects = new Map<string, DOMRect>();

    items.forEach((item) => {
      const id = item.getAttribute('data-flip-id');
      if (id) {
        currentRects.set(id, item.getBoundingClientRect());
      }
    });

    const oldRects = prevRects.current;

    if (oldRects.size > 0) {
      items.forEach((item) => {
        const id = item.getAttribute('data-flip-id');
        if (!id) return;

        const oldRect = oldRects.get(id);
        const newRect = currentRects.get(id);

        if (oldRect && newRect) {
          const dx = oldRect.left - newRect.left;
          const dy = oldRect.top - newRect.top;

          if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
            item.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
            item.style.transition = 'none';

            requestAnimationFrame(() => {
              item.style.transition = 'transform 360ms cubic-bezier(0.16, 1, 0.3, 1)';
              item.style.transform = 'translate3d(0, 0, 0)';
            });

            const onTransitionEnd = () => {
              item.style.transition = '';
              item.style.transform = '';
              item.removeEventListener('transitionend', onTransitionEnd);
            };
            item.addEventListener('transitionend', onTransitionEnd);
          }
        }
      });
    }

    prevRects.current = currentRects;
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
}
