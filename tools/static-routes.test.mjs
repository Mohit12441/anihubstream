import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

describe('TASK 8 (P2) — Dead links and missing pages', () => {
  const root = process.cwd();

  it('Footer contains real <a> links for social channels (X/Twitter and Instagram) with valid hrefs', () => {
    const footerContent = fs.readFileSync(path.join(root, 'src/components/Footer.tsx'), 'utf8');

    // No dead buttons in site-footer__social
    assert.ok(!footerContent.includes('onClick={demo('), 'Footer must not use demo button click handlers');

    // Social links have real hrefs and security attributes
    assert.match(footerContent, /href="https:\/\/x\.com"/);
    assert.match(footerContent, /href="https:\/\/instagram\.com"/);
    assert.match(footerContent, /target="_blank"/);
    assert.match(footerContent, /rel="noopener noreferrer"/);
  });

  it('Footer links to real legal and static routes (About, Contact, DMCA, Privacy, Terms, Release Notes)', () => {
    const footerContent = fs.readFileSync(path.join(root, 'src/components/Footer.tsx'), 'utf8');

    assert.ok(footerContent.includes('to="/about"'), 'Must link to /about');
    assert.ok(footerContent.includes('to="/contact"'), 'Must link to /contact');
    assert.ok(footerContent.includes('to="/dmca"'), 'Must link to /dmca');
    assert.ok(footerContent.includes('to="/privacy"'), 'Must link to /privacy');
    assert.ok(footerContent.includes('to="/terms"'), 'Must link to /terms');
    assert.ok(footerContent.includes('href="https://github.com/Mohit12441/anihubstream/releases"'), 'Must link to Release Notes');
  });

  it('All static pages exist on disk with valid content and useSEO calls', () => {
    const pages = ['About.tsx', 'Contact.tsx', 'Dmca.tsx', 'Privacy.tsx', 'Terms.tsx'];

    for (const page of pages) {
      const pagePath = path.join(root, 'src/pages', page);
      assert.ok(fs.existsSync(pagePath), `${page} must exist in src/pages`);
      const content = fs.readFileSync(pagePath, 'utf8');
      assert.ok(content.includes('useSEO'), `${page} must invoke useSEO`);
      assert.ok(content.includes('export function'), `${page} must export a component`);
    }
  });

  it('App.tsx defines routes for all static pages', () => {
    const appContent = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');

    assert.ok(appContent.includes('path="/about"'), 'Route /about must be configured in App.tsx');
    assert.ok(appContent.includes('path="/contact"'), 'Route /contact must be configured in App.tsx');
    assert.ok(appContent.includes('path="/dmca"'), 'Route /dmca must be configured in App.tsx');
    assert.ok(appContent.includes('path="/privacy"'), 'Route /privacy must be configured in App.tsx');
    assert.ok(appContent.includes('path="/terms"'), 'Route /terms must be configured in App.tsx');
  });
});
