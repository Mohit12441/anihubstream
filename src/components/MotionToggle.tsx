import { useEffect, useState } from 'react';
import { Sparkles, Sparkle } from 'lucide-react';
import { usePrefersReducedMotion, toggleReducedMotion } from '../lib/motion';
import { soundFx } from '../lib/soundFx';

export function MotionToggle() {
  const reduced = usePrefersReducedMotion();
  const [active, setActive] = useState(reduced);

  useEffect(() => {
    setActive(reduced);
  }, [reduced]);

  const handleToggle = () => {
    soundFx.playClick();
    const next = toggleReducedMotion();
    setActive(next);
  };

  return (
    <button
      type="button"
      className="icon-btn site-header__motion"
      onClick={handleToggle}
      aria-label={active ? 'Enable animations' : 'Reduce motion & animations'}
      title={active ? 'Enable animations' : 'Reduce motion'}
    >
      {active ? (
        <Sparkle size={17} style={{ opacity: 0.5 }} />
      ) : (
        <Sparkles size={17} className="text-accent" />
      )}
    </button>
  );
}
