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

  // Handle auto-skip preference
  useEffect(() => {
    if (!autoSkip || !activeInterval) {
      if (!activeInterval) hasAutoSkipped.current = null;
      return;
    }

    const key = `${activeInterval.label}:${activeInterval.start}`;
    if (hasAutoSkipped.current !== key) {
      hasAutoSkipped.current = key;
      onSkip(activeInterval.end + 0.5);
    }
  }, [autoSkip, activeInterval, onSkip]);

  if (!activeInterval) return null;

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
    </button>
  );
}
