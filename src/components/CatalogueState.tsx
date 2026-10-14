import { AlertTriangle, RefreshCw } from 'lucide-react';
import '../styles/pages.css';

export function CatalogueLoading({ grid = true, rows = 10 }: { grid?: boolean; rows?: number }) {
  return (
    <div className="catalogue-loading" role="status" aria-live="polite">
      <p className="catalogue-loading__note">Loading the catalogue…</p>
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
        <b>The catalogue service did not answer.</b>
        <br />
        {error ?? 'No titles could be loaded.'}
      </p>
      <div className="empty__cta">
        <button type="button" className="btn btn--sm btn--primary" onClick={onRetry}>
          <RefreshCw size={14} aria-hidden="true" />
          Try again
        </button>
      </div>
      <p className="note">
        <AlertTriangle size={14} aria-hidden="true" />
        Nothing is bundled into the page as a stand-in — the shelves show what the database actually returns.
      </p>
    </div>
  );
}
