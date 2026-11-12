/**
 * soundFx.ts
 * High-performance, zero-asset UI sound synthesizer using native Web Audio API.
 * Synthesizes crisp micro-interaction sounds (clicks, soft hover ticks, whooshes, chimes)
 * without needing external MP3/WAV files or network requests.
 * Persists mute state in localStorage.
 */

let audioCtx: AudioContext | null = null;
let isMuted: boolean = (() => {
  try {
    return localStorage.getItem('anihub_sound_enabled') !== 'true';
  } catch {
    return true;
  }
})();

const listeners = new Set<(muted: boolean) => void>();

function getAudioContext(): AudioContext | null {
  if (isMuted) return null;
  if (typeof window === 'undefined') return null;

  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }

  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }

  return audioCtx;
}

export const soundFx = {
  isMuted() {
    return isMuted;
  },

  setMuted(muted: boolean) {
    isMuted = muted;
    try {
      localStorage.setItem('anihub_sound_enabled', muted ? 'false' : 'true');
    } catch {}
    listeners.forEach((fn) => fn(muted));
  },

  toggleMute() {
    this.setMuted(!isMuted);
    if (!isMuted) {
      this.playChime();
    }
    return isMuted;
  },

  subscribe(fn: (muted: boolean) => void) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },

  /**
   * Ultra-subtle hover click/tick (15ms, 850Hz -> 650Hz)
   */
  playHover() {
    const ctx = getAudioContext();
    if (!ctx) return;

    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const now = ctx.currentTime;

      osc.type = 'sine';
      osc.frequency.setValueAtTime(800, now);
      osc.frequency.exponentialRampToValueAtTime(500, now + 0.025);

      gain.gain.setValueAtTime(0.025, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.025);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.025);
    } catch {}
  },

  /**
   * Snappy button click (35ms, 600Hz -> 180Hz)
   */
  playClick() {
    const ctx = getAudioContext();
    if (!ctx) return;

    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const now = ctx.currentTime;

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(620, now);
      osc.frequency.exponentialRampToValueAtTime(140, now + 0.04);

      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.04);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.04);
    } catch {}
  },

  /**
   * Melodic 2-tone chime for adding to list / positive actions
   */
  playChime() {
    const ctx = getAudioContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      [523.25, 659.25].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const start = now + i * 0.06;

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, start);

        gain.gain.setValueAtTime(0.05, start);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(start);
        osc.stop(start + 0.16);
      });
    } catch {}
  },

  /**
   * Soft low whoosh/swoosh for opening menus or panels
   */
  playWhoosh() {
    const ctx = getAudioContext();
    if (!ctx) return;

    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const now = ctx.currentTime;

      osc.type = 'sine';
      osc.frequency.setValueAtTime(260, now);
      osc.frequency.exponentialRampToValueAtTime(80, now + 0.12);

      gain.gain.setValueAtTime(0.04, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.12);
    } catch {}
  },
};
