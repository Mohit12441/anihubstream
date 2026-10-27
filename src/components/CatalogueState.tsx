import { AlertTriangle, RefreshCw } from 'lucide-react';
import '../styles/pages.css';

export function CatalogueLoading({ grid = true, rows = 10 }: { grid?: boolean; rows?: number }) {
  return (
    <div className="catalogue-loading" role="status" aria-live="polite">
      <p className="catalogue-loading__note">Loading anime…</p>
      <ul className={grid ? 'pgrid' : 'lgrid'} aria-busy="true">
        {Array.from({ length: rows }, (_, i) => (
          <li key={i}>
            <div className={grid ? 'skel skel--poster' : 'skel skel--wide'} />
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
