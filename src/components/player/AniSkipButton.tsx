import { useEffect, useMemo, useRef } from 'react';
import { FastForward } from 'lucide-react';
import type { AniSkipData, SkipInterval } from './PlayerInput';

export interface AniSkipButtonProps {
  aniskip?: AniSkipData | null;
  currentTime: number;
  onSkip: (targetSeconds: number) => void;
  autoSkip?: boolean;
  className?: string;
}

export function AniSkipButton({
  aniskip,
  currentTime,
  onSkip,
  autoSkip = false,
  className = '',
}: AniSkipButtonProps) {
  const hasAutoSkipped = useRef<string | null>(null);

  // Determine active skip interval
  const activeInterval = useMemo((): SkipInterval | null => {
    if (!aniskip) return null;

    const { op, ed, recap } = aniskip;

    if (op && currentTime >= op.start && currentTime < op.end) {
      return op;
    }
    if (ed && currentTime >= ed.start && currentTime < ed.end) {
      return ed;
    }
    if (recap && currentTime >= recap.start && currentTime < recap.end) {
      return recap;
    }

    return null;
  }, [aniskip, currentTime]);

  // Handle auto-skip preference (only auto-skip if confidence is high >= 0.80)
  useEffect(() => {
    if (!autoSkip || !activeInterval) {
      if (!activeInterval) hasAutoSkipped.current = null;
      return;
    }

    const confidence = activeInterval.confidence ?? 1.0;
    if (confidence < 0.8) {
      // Lower confidence interval requires manual click to prevent skipping dialogue
      return;
    }

    const key = `${activeInterval.label}:${activeInterval.start}`;
    if (hasAutoSkipped.current !== key) {
      hasAutoSkipped.current = key;
      onSkip(activeInterval.end + 0.5);
    }
  }, [autoSkip, activeInterval, onSkip]);

  if (!activeInterval) return null;

  const sourceBadge = (() => {
    switch (activeInterval.source) {
      case 'estimated':
        return { label: 'Est.', bg: 'rgba(234, 179, 8, 0.2)', color: '#facc15' };
      case 'learned_template':
        return { label: 'Learned', bg: 'rgba(99, 102, 241, 0.25)', color: '#c7d2fe' };
      case 'provider':
        return { label: 'Provider', bg: 'rgba(59, 130, 246, 0.2)', color: '#93c5fd' };
      default:
        return { label: 'AniSkip', bg: 'rgba(34, 197, 94, 0.2)', color: '#86efac' };
    }
  })();

  return (
    <button
      type="button"
      onClick={() => onSkip(activeInterval.end + 0.5)}
      className={`aniskip-button ${className}`}
      style={{
        position: 'absolute',
        bottom: '80px',
        right: '24px',
        zIndex: 30,
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '10px 18px',
        borderRadius: '8px',
        background: 'rgba(15, 23, 42, 0.85)',
        backdropFilter: 'blur(8px)',
        border: '1.5px solid var(--brand, #6366f1)',
        color: '#ffffff',
        fontWeight: 600,
        fontSize: '0.9rem',
        cursor: 'pointer',
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.5)',
        transition: 'all 0.18s ease-in-out',
      }}
      aria-label={`Skip ${activeInterval.label}`}
    >
      <FastForward size={18} style={{ color: 'var(--brand, #6366f1)' }} />
      <span>Skip {activeInterval.label}</span>
      <span
        style={{
          fontSize: '0.65rem',
          padding: '1px 6px',
          borderRadius: '4px',
          background: sourceBadge.bg,
          color: sourceBadge.color,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.03em',
        }}
      >
        {sourceBadge.label}
      </span>
    </button>
  );
}
