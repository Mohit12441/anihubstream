import { useEffect, useRef, useState } from 'react';
import { usePrefersReducedMotion } from '../../lib/motion';

interface Props {
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  videoEl?: HTMLVideoElement | null;
  accentColor?: string;
  enabled?: boolean;
}

export function AmbilightGlow({ videoRef, videoEl, accentColor = '#ff1f4a', enabled = true }: Props) {
  const reduced = usePrefersReducedMotion();
  const [ambientGlow, setAmbientGlow] = useState<string>(accentColor);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!enabled || reduced) return;
    const video = videoEl || videoRef?.current;
    if (!video) return;

    let timer: number | null = null;
    let canvas = canvasRef.current;
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.width = 16;
      canvas.height = 9;
      canvasRef.current = canvas;
    }

    const sampleFrame = () => {
      if (!video || video.paused || video.ended || video.readyState < 2) return;

      try {
        const ctx = canvas?.getContext('2d', { willReadFrequently: true });
        if (!ctx || !canvas) return;

        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

        let r = 0, g = 0, b = 0, count = 0;
        for (let i = 0; i < data.length; i += 16) {
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
          count++;
        }

        if (count > 0) {
          const avgR = Math.round(r / count);
          const avgG = Math.round(g / count);
          const avgB = Math.round(b / count);
          setAmbientGlow(`rgb(${avgR}, ${avgG}, ${avgB})`);
        }
      } catch {
        // Cross-origin fallback
        setAmbientGlow(accentColor);
      }
    };

    const interval = window.setInterval(sampleFrame, 350);
    return () => {
      window.clearInterval(interval);
      if (timer) window.clearTimeout(timer);
    };
  }, [videoRef, videoEl, accentColor, enabled, reduced]);

  if (!enabled || reduced) return null;

  return (
    <div
      className="ambilight-glow"
      style={{
        '--ambilight-color': ambientGlow,
      } as React.CSSProperties}
      aria-hidden="true"
    />
  );
}
