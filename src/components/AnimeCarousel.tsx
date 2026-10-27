import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, RotateCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  label: string;
  onShuffle?: () => void;
}

export function AnimeCarousel({ children, label, onShuffle }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ start: true, end: false });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setEdge({ start: el.scrollLeft <= 4, end: el.scrollLeft >= max - 4 });
  }, []);

  useEffect(() => {
    measure();
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure, children]);

  const nudge = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    const step = Math.max(280, el.clientWidth * 0.72);
    el.scrollBy({ left: dir * step, behavior: 'smooth' });
  };

  return (
    <div className="carousel">
      <div
        className="carousel__track no-bar"
        ref={ref}
        onScroll={measure}
        role="group"
        aria-label={label}
        tabIndex={0}
      >
        {children}
      </div>

      {onShuffle && (
        <button type="button" className="icon-btn carousel__btn carousel__btn--shuffle" onClick={onShuffle} aria-label="Shuffle this row">
          <RotateCw size={16} />
        </button>
      )}

      <button
        type="button"
        className="icon-btn carousel__btn carousel__btn--prev"
        onClick={() => nudge(-1)}
        disabled={edge.start}
        aria-label={`Scroll ${label} left`}
      >
        <ArrowLeft size={18} />
      </button>
      <button
        type="button"
        className="icon-btn carousel__btn carousel__btn--next"
        onClick={() => nudge(1)}
        disabled={edge.end}
        aria-label={`Scroll ${label} right`}
      >
        <ArrowRight size={18} />
      </button>
    </div>
  );
}
