import { useEffect, useState } from 'react';
import { soundFx } from '../lib/soundFx';
import { usePrefersReducedMotion } from '../lib/motion';

export function DomainExpansion() {
  const [active, setActive] = useState(false);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    const handleTrigger = () => {
      setActive(true);
      soundFx.playWhoosh();
      document.documentElement.setAttribute('data-domain-expansion', 'active');
    };

    window.addEventListener('anihub:domain-expansion', handleTrigger);
    return () => {
      window.removeEventListener('anihub:domain-expansion', handleTrigger);
      document.documentElement.removeAttribute('data-domain-expansion');
    };
  }, []);

  useEffect(() => {
    if (!active) return;

    const timer = setTimeout(() => {
      close();
    }, 7500);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
      }
    };

    window.addEventListener('keydown', onKeyDown);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [active]);

  const close = () => {
    setActive(false);
    document.documentElement.removeAttribute('data-domain-expansion');
  };

  if (!active) return null;

  return (
    <div
      className={`domain-overlay ${reduced ? 'domain-overlay--reduced' : ''}`}
      onClick={close}
      role="dialog"
      aria-modal="true"
      aria-label="Domain Expansion Activated"
    >
      <div className="domain-overlay__backdrop" />
      <div className="domain-overlay__void-ring" aria-hidden="true" />
      <div className="domain-overlay__content">
        <span className="domain-overlay__kanji">「 領域展開 」</span>
        <h2 className="domain-overlay__title">無量空処</h2>
        <p className="domain-overlay__sub">DOMAIN EXPANSION: INFINITE VOID</p>
        <div className="domain-overlay__tag">PRESS ESC OR CLICK ANYWHERE TO DISPEL</div>
      </div>
    </div>
  );
}
