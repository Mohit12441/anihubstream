import { AlertTriangle, RefreshCw } from 'lucide-react';
import '../styles/pages.css';

export function ShurikenSpinner({ size = 36, className = '' }: { size?: number; className?: string }) {
  return (
    <div
      className={`shuriken-spinner ${className}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="50" cy="50" r="14" fill="currentColor" className="shuriken__core" />
        <path
          d="M50 6C50 6 56 32 65 35C74 38 94 50 94 50C94 50 68 56 65 65C62 74 50 94 50 94C50 94 44 68 35 65C26 62 6 50 6 50C6 50 32 44 35 35C38 26 50 6 50 6Z"
          fill="url(#shuriken-neon-grad)"
          className="shuriken__blades"
        />
        <circle cx="50" cy="50" r="5" fill="#07070b" />
        <defs>
          <linearGradient id="shuriken-neon-grad" x1="6" y1="6" x2="94" y2="94" gradientUnits="userSpaceOnUse">
            <stop stopColor="var(--crimson, #ff1f4a)" />
            <stop offset="0.5" stopColor="var(--magenta, #e93bff)" />
            <stop offset="1" stopColor="var(--cyan, #24d3ee)" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
}

export function CatalogueLoading({ grid = true, rows = 10 }: { grid?: boolean; rows?: number }) {
  return (
    <div className="catalogue-loading" role="status" aria-live="polite">
      <div className="catalogue-loading__header">
        <ShurikenSpinner size={32} />
        <p className="catalogue-loading__note">Summoning anime catalogue…</p>
      </div>
      <ul className={grid ? 'pgrid' : 'lgrid'} aria-busy="true">
        {Array.from({ length: rows }, (_, i) => (
          <li key={i} className="stagger-card-entry" style={{ animationDelay: `${i * 45}ms` }}>
            <div className={grid ? 'skel skel--poster' : 'skel skel--wide'}>
              <div className="skel__shimmer" />
            </div>
            {grid && (
              <div className="skel__meta">
                <div className="skel__line skel__line--title" />
                <div className="skel__line skel__line--sub" />
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function CatalogueError({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  return (
    <div className="empty" role="alert">
      <p>
        <b>Unable to load anime right now.</b>
        <br />
        {error ?? 'Please check your connection and retry.'}
      </p>
      <div className="empty__cta">
        <button type="button" className="btn btn--sm btn--primary" onClick={onRetry}>
          <RefreshCw size={14} aria-hidden="true" />
          Try again
        </button>
      </div>
      <p className="note">
        <AlertTriangle size={14} aria-hidden="true" />
        Please check your internet connection or try again in a few moments.
      </p>
    </div>
  );
}
