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
    <div className="nx" role="dialog" aria-modal="false" aria-label="Up next">
      {next ? (
        <>
          <Art
            sources={[next.thumb, ...backdrops]}
            alt=""
            imgClass="nx__thumb"
            emptyClass="nx__thumb nx__thumb--none"
            iconSize={20}
            eager
          />
          <div className="nx__body">
            <p className="nx__kicker">{auto ? `Next episode starts in ${seconds}s` : 'Episode finished'}</p>
            <h3>
              Episode {next.n} · {next.title}
            </h3>
            <p className="nx__syn">{next.synopsis}</p>
            <div className="nx__acts">
              <button type="button" className="btn btn--primary btn--sm" onClick={onPlay}>
                <Play size={15} fill="currentColor" strokeWidth={0} aria-hidden="true" />
                Watch next now
              </button>
              {auto && (
                <button type="button" className="btn btn--ghost btn--sm" onClick={onCancel}>
                  <X size={15} aria-hidden="true" />
                  Cancel
                </button>
              )}
              {!auto && (
                <button type="button" className="btn btn--ghost btn--sm" onClick={onReplay}>
                  <RotateCcw size={15} aria-hidden="true" />
                  Replay episode
                </button>
              )}
            </div>
            {auto && (
              <span className="nx__bar" aria-hidden="true">
                <i style={{ width: `${pct}%` }} />
              </span>
            )}
          </div>
        </>
      ) : (
        <div className="nx__body nx__body--solo">
          <p className="nx__kicker">That was the last episode this site has listed for the season.</p>
          <div className="nx__acts">
            <button type="button" className="btn btn--ghost btn--sm" onClick={onReplay}>
              <RotateCcw size={15} aria-hidden="true" />
              Replay episode
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
