import { useEffect, useState } from 'react';
import { Clapperboard } from 'lucide-react';
import { normalizeArtUrl } from '../data/model';

/**
 * A frame image that never leaves a broken icon on screen.
 *
 * It walks the sources in priority order (episode still -> title key art -> title poster),
 * advancing on a load error and never requesting the same bad url twice. When every source
 * is spent it shows the neutral placeholder — never another title's artwork.
 *
 * Automatically normalizes expiring S3/Backblaze signed URLs to permanent CDN URLs.
 * Sets explicit width and height attributes to stop cumulative layout shifts (CLS).
 */
export function Art({
  sources,
  alt,
  imgClass,
  fill = false,
  iconSize = 14,
  eager = false,
  hideWhenEmpty = false,
  emptyClass,
  width,
  height,
}: {
  /** candidates in priority order; empty/null entries are dropped up front */
  sources: (string | null | undefined)[];
  alt: string;
  /** class for the <img> (the placeholder carries its own) */
  imgClass?: string;
  /** use the full-bleed placeholder variant */
  fill?: boolean;
  iconSize?: number;
  /** load now rather than on scroll — for artwork above the fold or behind the player */
  eager?: boolean;
  /** render nothing instead of the placeholder once the chain is spent (decorative backdrops) */
  hideWhenEmpty?: boolean;
  /** placeholder class where the slot has its own tile style, e.g. the next-episode thumb */
  emptyClass?: string;
  /** explicit width attribute to prevent layout shifts */
  width?: number | string;
  /** explicit height attribute to prevent layout shifts */
  height?: number | string;
}) {
  const chain = sources
    .filter((s): s is string => Boolean(s))
    .map(normalizeArtUrl)
    .filter(Boolean);

  const sig = chain.join('|');
  const [idx, setIdx] = useState(0);
  /* a new episode means a new chain: restart at its own still rather than a spent slot */
  useEffect(() => setIdx(0), [sig]);

  if (idx >= chain.length) {
    if (hideWhenEmpty) return null;
    return (
      <span className={emptyClass ?? `still-none${fill ? ' still-none--fill' : ''}`} aria-hidden="true">
        <Clapperboard size={iconSize} />
      </span>
    );
  }

  return (
    <img
      src={chain[idx]}
      alt={alt}
      width={width ?? (fill ? 300 : undefined)}
      height={height ?? (fill ? 420 : undefined)}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      className={imgClass}
      /* onError only ever moves forward, so a failed url is never re-requested */
      onError={() => setIdx((i) => i + 1)}
    />
  );
}
