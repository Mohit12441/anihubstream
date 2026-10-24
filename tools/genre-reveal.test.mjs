import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

test('Genres Animated Reveal Component Contract', () => {
  const genresPage = fs.readFileSync(path.resolve(ROOT, 'src/pages/Genres.tsx'), 'utf8');

  // Must have genre reveal drawer wrapper with is-open dynamic state
  assert.ok(
    genresPage.includes('className={`genre-reveal${genre ? \' is-open\' : \'\'}`'),
    'Genres.tsx must wrap the results in .genre-reveal with dynamic is-open class'
  );

  // Must have clear close button
  assert.ok(
    genresPage.includes('className="genre-reveal__close-btn"'),
    'Genres.tsx must provide a dedicated close/collapse button'
  );

  // Must render cards with staggered entrance classes and index CSS variable
  assert.ok(
    genresPage.includes('className="genre-card-animate"'),
    'Genres.tsx must attach .genre-card-animate to anime result cards'
  );
  assert.ok(
    genresPage.includes("style={{ '--card-index': idx } as React.CSSProperties}"),
    'Genres.tsx must pass --card-index variable for staggered CSS animation'
  );

  // Must preserve cached label during exit transition to prevent layout glitching
  assert.ok(
    genresPage.includes('displayLabel'),
    'Genres.tsx must use displayLabel to smoothly preserve genre title during collapse'
  );
});

test('GenreGrid Accessible Controls Contract', () => {
  const gridComponent = fs.readFileSync(path.resolve(ROOT, 'src/components/GenreGrid.tsx'), 'utf8');

  assert.ok(
    gridComponent.includes('aria-expanded={on}'),
    'GenreGrid.tsx must provide aria-expanded={on} for screen reader accessibility'
  );
  assert.ok(
    gridComponent.includes('aria-controls="genres-reveal-section"'),
    'GenreGrid.tsx must associate cards with the reveal section via aria-controls'
  );
});

test('Genre Reveal CSS & Reduced Motion Tokens', () => {
  const css = fs.readFileSync(path.resolve(ROOT, 'src/styles/pages.css'), 'utf8');

  // CSS must have grid-template-rows expansion
  assert.ok(css.includes('.genre-reveal {'), 'pages.css must define .genre-reveal');
  assert.ok(css.includes('grid-template-rows: 0fr;'), 'pages.css must have collapsed 0fr state');
  assert.ok(css.includes('.genre-reveal.is-open {'), 'pages.css must define .genre-reveal.is-open');
  assert.ok(css.includes('grid-template-rows: 1fr;'), 'pages.css must expand to 1fr when is-open');

  // Staggered keyframe definition
  assert.ok(css.includes('@keyframes cardStaggerReveal'), 'pages.css must define @keyframes cardStaggerReveal');
  assert.ok(css.includes('--card-index'), 'pages.css must compute delay using --card-index');

  // Neon-red active styling matching AniHubStream theme
  assert.ok(css.includes('.gcard.is-on {'), 'pages.css must style .gcard.is-on');
  assert.ok(
    css.includes('rgba(255, 31, 74,'),
    'pages.css must apply AniHubStream crimson neon glow on active genre card'
  );

  // Accessibility: prefers-reduced-motion
  assert.ok(
    css.includes('@media (prefers-reduced-motion: reduce)'),
    'pages.css must respect prefers-reduced-motion'
  );
});
