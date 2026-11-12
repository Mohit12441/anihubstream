import { useEffect, useState } from 'react';

const motionListeners = new Set<(reduced: boolean) => void>();

function getInitialReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  const manual = localStorage.getItem('anihub_reduce_motion');
  if (manual !== null) {
    return manual === 'true';
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function setManualReducedMotion(reduced: boolean) {
  try {
    localStorage.setItem('anihub_reduce_motion', reduced ? 'true' : 'false');
    if (reduced) {
      document.documentElement.setAttribute('data-reduce-motion', 'true');
    } else {
      document.documentElement.removeAttribute('data-reduce-motion');
    }
  } catch {}
  motionListeners.forEach((fn) => fn(reduced));
}

export function toggleReducedMotion(): boolean {
  const next = !getInitialReducedMotion();
  setManualReducedMotion(next);
  return next;
}

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(getInitialReducedMotion);

  useEffect(() => {
    const fn = (val: boolean) => setReduced(val);
    motionListeners.add(fn);

    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => {
      if (localStorage.getItem('anihub_reduce_motion') === null) {
        setReduced(mq.matches);
      }
    };
    mq.addEventListener('change', onChange);

    return () => {
      motionListeners.delete(fn);
      mq.removeEventListener('change', onChange);
    };
  }, []);

  return reduced;
}

/**
 * useScrollReveal
 * Automatically observes DOM elements matching `selector` (default: .scroll-reveal)
 * and applies `.is-visible` when they enter the viewport with a fluid stagger.
 * Gracefully marks everything visible immediately if reduced-motion is requested.
 */
export function useScrollReveal(selector = '.scroll-reveal') {
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (reduced) {
      document.querySelectorAll(selector).forEach((el) => el.classList.add('is-visible'));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.08, rootMargin: '0px 0px -30px 0px' }
    );

    const observeElements = () => {
      document.querySelectorAll(selector).forEach((el) => {
        if (!el.classList.contains('is-visible')) {
          observer.observe(el);
        }
      });
    };

    observeElements();
    const mutationObserver = new MutationObserver(observeElements);
    mutationObserver.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      mutationObserver.disconnect();
    };
  }, [reduced, selector]);
}
