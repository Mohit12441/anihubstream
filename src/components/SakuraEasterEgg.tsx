import { useEffect, useRef, useState } from 'react';
import { useToast } from '../lib/Toast';
import { soundFx } from '../lib/soundFx';

const KONAMI_CODE = [
  'ArrowUp',
  'ArrowUp',
  'ArrowDown',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowLeft',
  'ArrowRight',
  'KeyB',
  'KeyA',
];

interface Petal {
  x: number;
  y: number;
  size: number;
  speedX: number;
  speedY: number;
  rotation: number;
  rotationSpeed: number;
  opacity: number;
  color: string;
}

export function SakuraEasterEgg() {
  const [active, setActive] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const inputBuffer = useRef<string[]>([]);
  const { notify } = useToast();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      inputBuffer.current.push(e.code);
      if (inputBuffer.current.length > KONAMI_CODE.length) {
        inputBuffer.current.shift();
      }

      if (inputBuffer.current.join(',') === KONAMI_CODE.join(',')) {
        inputBuffer.current = [];
        setActive(true);
        soundFx.playChime();
        notify('🌸 Cyber-Sakura Rain Unlocked! (Konami Code)');
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [notify]);

  useEffect(() => {
    if (!active) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const colors = ['#ff70a6', '#ff97b7', '#ff1f4a', '#e93bff', '#ffb5d8'];
    const count = 48;
    const petals: Petal[] = Array.from({ length: count }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * -canvas.height,
      size: Math.random() * 8 + 6,
      speedX: Math.random() * 2 - 0.5,
      speedY: Math.random() * 2.5 + 1.5,
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: (Math.random() - 0.5) * 0.05,
      opacity: Math.random() * 0.6 + 0.4,
      color: colors[Math.floor(Math.random() * colors.length)],
    }));

    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      petals.forEach((p) => {
        p.x += p.speedX;
        p.y += p.speedY;
        p.rotation += p.rotationSpeed;

        if (p.y > canvas.height) {
          p.y = -20;
          p.x = Math.random() * canvas.width;
        }

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.globalAlpha = p.opacity;
        ctx.fillStyle = p.color;

        // Draw curved petal shape
        ctx.beginPath();
        ctx.ellipse(0, 0, p.size, p.size * 0.55, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);

    const timer = setTimeout(() => {
      setActive(false);
    }, 14000);

    return () => {
      cancelAnimationFrame(animId);
      clearTimeout(timer);
    };
  }, [active]);

  if (!active) return null;

  return (
    <canvas
      ref={canvasRef}
      className="sakura-canvas"
      aria-hidden="true"
    />
  );
}
