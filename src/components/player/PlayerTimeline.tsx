import { useCallback, useRef, useState } from 'react';
import type { Marker } from '../../data/model';
import { stamp } from '../../lib/time';

interface Props {
  time: number;
  duration: number;
  /** media buffered range end, in seconds (0 until the stream is ready) */
  buffered: number;
  markers: Marker[];
  onSeek: (t: number) => void;
  onScrub: (active: boolean) => void;
}

const MARKER_HINT: Record<Marker['kind'], string> = {
  recap: 'Recap',
  intro: 'Opening',
  outro: 'Ending',
  credits: 'Credits',
  preview: 'Next preview',
};

export function PlayerTimeline({ time, duration, buffered, markers, onSeek, onScrub }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ x: number; t: number; marker?: Marker } | null>(null);
  const [dragging, setDragging] = useState(false);

  const at = useCallback(
    (clientX: number) => {
      const el = ref.current;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (!r.width) return null;
      const ratio = Math.min(Math.max((clientX - r.left) / r.width, 0), 1);
      const t = ratio * duration;
      return {
        x: ratio * 100,
        t,
        marker: markers.find((m) => t >= m.start && t < m.end),
      };
    },
    [duration, markers],
  );

  const down = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    e.stopPropagation();
    ref.current?.setPointerCapture(e.pointerId);
    setDragging(true);
    onScrub(true);
    const hit = at(e.clientX);
    if (hit) onSeek(hit.t);
  };

  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    const hit = at(e.clientX);
    if (!hit) return;
    setHover(hit);
    if (dragging) onSeek(hit.t);
  };

  const up = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    ref.current?.releasePointerCapture?.(e.pointerId);
    setDragging(false);
    onScrub(false);
  };

  const key = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const fine = e.shiftKey ? 10 : 5;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') onSeek(time + fine);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') onSeek(time - fine);
    else if (e.key === 'Home') onSeek(0);
    else if (e.key === 'End') onSeek(duration);
    else if (e.key === 'PageDown') onSeek(time - 30);
    else if (e.key === 'PageUp') onSeek(time + 30);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  const pct = duration ? (time / duration) * 100 : 0;
  const bufPct = duration ? (Math.min(buffered, duration) / duration) * 100 : 0;

  return (
    <div
      ref={ref}
      className={`ptl${dragging ? ' is-dragging' : ''}`}
      role="slider"
      tabIndex={0}
      aria-label="Seek through episode"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(time)}
      aria-valuetext={`${stamp(time)} of ${stamp(duration)}`}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onPointerLeave={() => !dragging && setHover(null)}
      onKeyDown={key}
    >
      <span className="ptl__rail" aria-hidden="true" />
      <span
        className="ptl__buf"
        style={{ width: `${bufPct}%` }}
        aria-hidden="true"
        title="Buffered ahead — real media data"
      />
      {markers.map((m) => (
        <span
          key={`${m.kind}-${m.start}`}
          className={`ptl__mk ptl__mk--${m.kind}${m.locked ? ' is-locked' : ''}`}
          style={{
            left: `${duration ? (m.start / duration) * 100 : 0}%`,
            width: `${duration ? ((m.end - m.start) / duration) * 100 : 0}%`,
          }}
          aria-hidden="true"
          title={`${MARKER_HINT[m.kind]} ${stamp(m.start)}–${stamp(m.end)}${
            m.locked ? ' · not available for this episode' : ''
          }`}
        />
      ))}
      <span className="ptl__fill" style={{ width: `${pct}%` }} aria-hidden="true" />
      <span className="ptl__knob" style={{ left: `${pct}%` }} aria-hidden="true" />

      {hover && (
        <span className="ptl__tip" style={{ left: `${Math.min(Math.max(hover.x, 6), 94)}%` }} aria-hidden="true">
          <b>{stamp(hover.t)}</b>
          {hover.marker && (
            <em className={`ptl__tip-mk ptl__tip-mk--${hover.marker.kind}`}>
              {MARKER_HINT[hover.marker.kind]}
              {hover.marker.locked ? ' · unavailable' : ''}
            </em>
          )}
        </span>
      )}
    </div>
  );
}
