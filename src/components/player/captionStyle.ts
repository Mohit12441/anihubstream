import type { CSSProperties } from 'react';
import type { SubtitleSettings } from '../../lib/playerPrefs';

const OUTLINE_LIGHT =
  '1px 1px 0 rgba(0,0,0,.9), -1px 1px 0 rgba(0,0,0,.9), 1px -1px 0 rgba(0,0,0,.9), -1px -1px 0 rgba(0,0,0,.9)';
const OUTLINE_HEAVY =
  '2px 2px 0 #000, -2px 2px 0 #000, 2px -2px 0 #000, -2px -2px 0 #000, 0 2px 0 #000, 0 -2px 0 #000, 2px 0 0 #000, -2px 0 0 #000, 1px 1px 2px rgba(0,0,0,0.8)';
const SHADOW_GLOW = '0 0 8px rgba(0,0,0,0.95), 0 0 16px rgba(0,0,0,0.85)';
const SHADOW_DROP = '2px 3px 6px rgba(0,0,0,0.95)';

const FONT_MAP: Record<string, string> = {
  sans: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  classic: "'Trebuchet MS', 'Lucida Sans Unicode', 'Noto Sans', sans-serif",
  serif: "'Noto Serif JP', 'Merriweather', 'Georgia', serif",
  mono: "'JetBrains Mono', 'Consolas', 'Courier New', monospace",
  display: "'Bakbak One', 'Impact', sans-serif",
};

export function captionStyle(s: SubtitleSettings): CSSProperties {
  const shadows: string[] = [];

  const shadowMode = s.shadow || (s.outline ? 'outline' : 'none');
  if (shadowMode === 'heavy') {
    shadows.push(OUTLINE_HEAVY);
  } else if (shadowMode === 'glow') {
    shadows.push(SHADOW_GLOW);
  } else if (shadowMode === 'drop') {
    shadows.push(SHADOW_DROP);
  } else if (shadowMode === 'outline' || s.outline) {
    shadows.push(OUTLINE_LIGHT);
  }

  if (s.backdrop === 'shadow') {
    shadows.push('0 2px 16px rgba(0,0,0,.9)');
  }

  const fontFamily = FONT_MAP[s.font || 'sans'] || FONT_MAP.sans;

  return {
    color: s.color,
    fontFamily,
    /* Published as a variable rather than as font-size: an inline font-size outranks every
       CSS rule, and a caption inside a 200px-tall phone frame has to be able to shrink
       against the frame (player.css reads --cap-px and --pl-stage-h together). */
    '--cap-px': `${s.size}px`,
    lineHeight: 1.42,
    background: s.backdrop === 'box' ? `rgba(5,5,12,${s.background})` : 'transparent',
    boxShadow: s.backdrop === 'box' && s.background > 0.35 ? '0 4px 18px rgba(0,0,0,.35)' : 'none',
    textShadow: shadows.length ? shadows.join(', ') : 'none',
    padding: s.backdrop === 'box' ? '0.32em 0.7em' : '0.1em 0.2em',
    borderRadius: '0.35em',
  } as CSSProperties;
}

export const captionAnchor = (s: SubtitleSettings) => `cap--${s.position}`;
