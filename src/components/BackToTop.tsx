import { useEffect, useState } from 'react';
import { ArrowUp } from 'lucide-react';
import { soundFx } from '../lib/soundFx';
import { usePrefersReducedMotion } from '../lib/motion';

export function BackToTop() {
  const [visible, setVisible] = useState(false);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    const handleScroll = () => {
      setVisible(window.scrollY > 380);
    };

    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToTop = () => {
    soundFx.playClick();
    window.scrollTo({
      top: 0,
      behavior: reduced ? 'auto' : 'smooth',
    });
  };

  if (!visible) return null;

  return (
    <button
      type="button"
      className="back-to-top"
      onClick={scrollToTop}
      aria-label="Scroll back to top of page"
      title="Back to top"
    >
      <ArrowUp size={18} aria-hidden="true" />
    </button>
  );
}
