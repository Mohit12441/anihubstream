import { usePrefersReducedMotion } from '../lib/motion';

/**
 * AmbientBackground
 * GPU-accelerated glowing ambient aurora mesh that adds cinematic depth
 * across dark theme viewports. Automatically respects reduced-motion.
 */
export function AmbientBackground() {
  const reduced = usePrefersReducedMotion();

  if (reduced) return null;

  return (
    <div className="ambient-mesh" aria-hidden="true">
      <div className="ambient-mesh__orb ambient-mesh__orb--1" />
      <div className="ambient-mesh__orb ambient-mesh__orb--2" />
      <div className="ambient-mesh__orb ambient-mesh__orb--3" />
    </div>
  );
}
