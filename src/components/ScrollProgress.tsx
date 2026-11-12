import { useEffect, useState } from 'react';

/**
 * ScrollProgress
 * Thin, high-polish glowing neon progress bar fixed at the very top of the window
 * indicating page scroll percentage.
 */
export function ScrollProgress() {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const onScroll = () => {
      const scrollHeight = document.documentElement.scrollHeight - window.innerHeight;
      if (scrollHeight <= 0) {
        setProgress(0);
        return;
      }
      const current = (window.scrollY / scrollHeight) * 100;
      setProgress(Math.min(100, Math.max(0, current)));
    };

    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div
      className="scroll-progress-bar"
      style={{
        transform: `scaleX(${progress / 100})`,
        opacity: progress > 0.5 ? 1 : 0,
      }}
      aria-hidden="true"
    />
  );
}
