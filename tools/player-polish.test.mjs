import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

describe('TASK 11 (P2) — Player Polish', () => {
  const root = process.cwd();

  it('HD badge in Watch.tsx is gated on resolved stream', () => {
    const watchContent = fs.readFileSync(path.join(root, 'src/pages/Watch.tsx'), 'utf8');

    // Must NOT have unconditionally rendered HD badge
    assert.ok(
      !watchContent.includes('<ul className="watch__badges">\n              <li className="badge badge--accent">HD</li>'),
      'HD badge must not render unconditionally',
    );

    // Must be gated on isStreamResolved
    assert.match(
      watchContent,
      /\{isStreamResolved\s*&&\s*<(li|span) className="badge badge--accent">(1080p )?HD<\/(li|span)>\}/,
      'HD badge must be gated on isStreamResolved state',
    );
  });

  it('AdvancedPlayer and usePlayerEngine calculate and render Skip Opening / Ending with AniSkip data', () => {
    const playerContent = fs.readFileSync(path.join(root, 'src/components/player/AdvancedPlayer.tsx'), 'utf8');

    // Skip Opening / Skip Ending label logic
    assert.match(playerContent, /'Skip Opening'/);
    assert.match(playerContent, /'Skip Ending'/);
    assert.match(playerContent, /className="pl__skip"/);
    assert.match(playerContent, /engine\.skipTo\(skipTarget,\s*'end'\)/);

    // Timeline duration uses episode runtime fallback to prevent aria-valuemax=0 while loading
    assert.match(playerContent, /fallbackDuration\s*=\s*episode\.runtime\s*\?\s*toSeconds\(episode\.runtime\)\s*:\s*0/);
    assert.match(playerContent, /timelineDuration\s*=\s*liveReady\s*&&\s*live\.duration\s*>\s*0\s*\?\s*live\.duration\s*:\s*fallbackDuration/);
  });

  it('native-title elements across the application have lang="ja"', () => {
    const watchContent = fs.readFileSync(path.join(root, 'src/pages/Watch.tsx'), 'utf8');
    assert.match(watchContent, /<p className="watch__native" lang="ja">\{anime\.native\}<\/p>/);

    const heroContent = fs.readFileSync(path.join(root, 'src/components/HeroSlideshow.tsx'), 'utf8');
    assert.match(heroContent, /<span className="vj__jp" lang="ja">/);

    const discoverContent = fs.readFileSync(path.join(root, 'src/pages/Discover.tsx'), 'utf8');
    assert.match(discoverContent, /<span className="vj__jp" lang="ja">冒険は続く<\/span>/);
  });

  it('EpisodeSidebar provides chunked batch selection for long-running series (>50 episodes)', () => {
    const sidebarContent = fs.readFileSync(path.join(root, 'src/components/EpisodeSidebar.tsx'), 'utf8');

    // Batch size constant and threshold
    assert.match(sidebarContent, /const\s+BATCH_SIZE\s*=\s*50;/);
    assert.match(sidebarContent, /const\s+hasBatches\s*=\s*total\s*>\s*BATCH_SIZE;/);

    // Range selector and slice calculation
    assert.match(sidebarContent, /anime\.episodes\.slice\(selectedBatch\s*\*\s*BATCH_SIZE,\s*\(selectedBatch\s*\+\s*1\)\s*\*\s*BATCH_SIZE\)/);
    assert.match(sidebarContent, /aria-label="Select episode range"/);
    assert.match(sidebarContent, /Episodes\s*\{start\}\s*-\s*\{end\}/);
  });
});
