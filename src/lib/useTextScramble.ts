import { useEffect, useRef, useState } from 'react';

const CHARS = '0123456789';

/**
 * useTextScramble
 * Cyberpunk/hacker numeric decryption effect that scrambles through digits
 * before cleanly resolving to the target string or number.
 */
export function useTextScramble(target: string | number | null | undefined): string {
  const finalStr = target !== null && target !== undefined ? String(target) : '—';
  const [display, setDisplay] = useState(finalStr);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    if (finalStr === '—' || !finalStr) {
      setDisplay(finalStr);
      return;
    }

    let iteration = 0;
    const maxIterations = 14;
    const length = finalStr.length;

    const animate = () => {
      iteration++;
      const current = finalStr
        .split('')
        .map((char, index) => {
          if (!/\d/.test(char)) return char;
          if (iteration / maxIterations > index / length) {
            return char;
          }
          return CHARS[Math.floor(Math.random() * CHARS.length)];
        })
        .join('');

      setDisplay(current);

      if (iteration < maxIterations) {
        frameRef.current = requestAnimationFrame(animate);
      } else {
        setDisplay(finalStr);
      }
    };

    frameRef.current = requestAnimationFrame(animate);

    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [finalStr]);

  return display;
}
