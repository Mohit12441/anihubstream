import type { CSSProperties } from 'react';
import type { SubtitleSettings } from '../../lib/playerPrefs';

const OUTLINE = '1px 1px 0 rgba(0,0,0,.9), -1px 1px 0 rgba(0,0,0,.9), 1px -1px 0 rgba(0,0,0,.9), -1px -1px 0 rgba(0,0,0,.9)';

export function captionStyle(s: SubtitleSettings): CSSProperties {
  const shadow: string[] = [];
  if (s.outline) shadow.push(OUTLINE);
  if (s.backdrop === 'shadow') shadow.push('0 2px 16px rgba(0,0,0,.9)');
  return {
    color: s.color,
    /* Published as a variable rather than as font-size: an inline font-size outranks every
       CSS rule, and a caption inside a 200px-tall phone frame has to be able to shrink
       against the frame (player.css reads --cap-px and --pl-stage-h together). */
    '--cap-px': `${s.size}px`,
    lineHeight: 1.42,
    background: s.backdrop === 'box' ? `rgba(5,5,12,${s.background})` : 'transparent',
    boxShadow: s.backdrop === 'box' && s.background > 0.35 ? '0 4px 18px rgba(0,0,0,.35)' : 'none',
    textShadow: shadow.length ? shadow.join(', ') : 'none',
    padding: s.backdrop === 'box' ? '0.32em 0.7em' : '0.1em 0.2em',
    borderRadius: '0.35em',
  } as CSSProperties;
}

export const captionAnchor = (s: SubtitleSettings) => `cap--${s.position}`;
