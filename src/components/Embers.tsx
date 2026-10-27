import { useMemo } from 'react';
import { usePrefersReducedMotion } from '../lib/motion';

interface Props {
  count?: number;
  tone?: 'crimson' | 'violet' | 'amber' | 'cyan';
  className?: string;
}

/** Lightweight CSS-driven ember/petal drift. Renders nothing when motion is reduced. */
export function Embers({ count = 22, tone = 'crimson', className = '' }: Props) {
  const reduced = usePrefersReducedMotion();

  const seeds = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => {
        const r = (n: number) => {
          const x = Math.sin((i + 1) * 12.9898 * n) * 43758.5453;
          return x - Math.floor(x);
        };
        return {
          left: r(1) * 100,
          delay: r(2) * -22,
          dur: 13 + r(3) * 16,
          size: 2 + r(4) * 5,
          drift: (r(5) - 0.5) * 160,
          spin: r(6) * 540 - 270,
          fade: 0.35 + r(7) * 0.5,
        };
      }),
    [count],
  );

  if (reduced) return null;

  return (
    <div className={`embers embers--${tone} ${className}`} aria-hidden="true">
      {seeds.map((s, i) => (
        <span
          key={i}
          style={
            {
              left: `${s.left}%`,
              width: `${s.size}px`,
              height: `${s.size * 1.9}px`,
              opacity: s.fade,
              animationDelay: `${s.delay}s`,
              animationDuration: `${s.dur}s`,
              '--drift': `${s.drift}px`,
              '--spin': `${s.spin}deg`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
