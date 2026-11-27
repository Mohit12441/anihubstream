import { Play, RotateCcw, X } from 'lucide-react';
import { Art } from '../Art';
import type { Episode } from '../../data/model';

interface Props {
  next: Episode | null;
  /** the title's own artwork, used when this episode publishes no still */
  backdrops: (string | null | undefined)[];
  auto: boolean;
  seconds: number;
  total: number;
  onPlay: () => void;
  onCancel: () => void;
  onReplay: () => void;
}

export function NextEpisodeOverlay({ next, backdrops, auto, seconds, total, onPlay, onCancel, onReplay }: Props) {
  const pct = auto && total > 0 ? Math.max(0, Math.min(100, (seconds / total) * 100)) : 0;

  return (
    <div className={`nx ${next ? 'nx--pip' : 'nx--solo'}`} role="dialog" aria-modal="false" aria-label="Up next">
      {next ? (
        <>
          <div className="nx__thumb-wrap">
            <Art
              sources={[next.thumb, ...backdrops]}
              alt=""
              imgClass="nx__thumb"
              emptyClass="nx__thumb nx__thumb--none"
              iconSize={18}
              eager
            />
            <span className="nx__thumb-badge">EP {next.n}</span>
          </div>
          <div className="nx__body">
            <div className="nx__header-line">
              <p className="nx__kicker">{auto ? `Next episode in ${seconds}s` : 'Episode finished'}</p>
              <button
                type="button"
                className="nx__close-btn"
                onClick={onCancel}
                aria-label="Dismiss up next"
                title="Dismiss"
              >
                <X size={14} aria-hidden="true" />
              </button>
            </div>
            <h4 className="nx__title">
              {next.title && next.title.trim().toLowerCase() !== `episode ${next.n}`
                ? next.title
                : `Episode ${next.n}`}
            </h4>
            <div className="nx__acts">
              <button type="button" className="btn btn--primary btn--sm nx__play-btn" onClick={onPlay}>
                <Play size={14} fill="currentColor" strokeWidth={0} aria-hidden="true" />
                <span>Play Now</span>
              </button>
              {auto ? (
                <button type="button" className="btn btn--ghost btn--sm nx__cancel-btn" onClick={onCancel}>
                  Cancel
                </button>
              ) : (
                <button type="button" className="btn btn--ghost btn--sm nx__replay-btn" onClick={onReplay}>
                  <RotateCcw size={13} aria-hidden="true" />
                  Replay
                </button>
              )}
            </div>
          </div>
          {auto && (
            <span className="nx__bar" aria-hidden="true">
              <i style={{ width: `${pct}%` }} />
            </span>
          )}
        </>
      ) : (
        <div className="nx__body nx__body--solo">
          <p className="nx__kicker">You've reached the latest available episode!</p>
          <div className="nx__acts">
            <button type="button" className="btn btn--ghost btn--sm nx__replay-btn" onClick={onReplay}>
              <RotateCcw size={14} aria-hidden="true" />
              Replay Episode
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
