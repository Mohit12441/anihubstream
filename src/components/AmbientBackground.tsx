import { useMemo } from 'react';
import { usePrefersReducedMotion } from '../lib/motion';

/**
 * AmbientBackground
 * GPU-accelerated glowing ambient aurora mesh that adds cinematic depth
 * across dark theme viewports. Dynamically adapts hue tones to the client's
 * time of day (Midnight Nebula, Twilight Crimson, or Cyber Cyan).
 * Automatically respects reduced-motion.
 */
export function AmbientBackground() {
  const reduced = usePrefersReducedMotion();

  const timeOfDay = useMemo(() => {
    const hour = new Date().getHours();
    if (hour >= 22 || hour < 5) return 'night';
    if (hour >= 17) return 'twilight';
    return 'day';
  }, []);

  if (reduced) return null;

  return (
    <div className={`ambient-mesh ambient-mesh--${timeOfDay}`} aria-hidden="true">
      <div className="ambient-mesh__orb ambient-mesh__orb--1" />
      <div className="ambient-mesh__orb ambient-mesh__orb--2" />
      <div className="ambient-mesh__orb ambient-mesh__orb--3" />
      {timeOfDay === 'night' && <div className="ambient-mesh__stars" />}
    </div>
  );
}
