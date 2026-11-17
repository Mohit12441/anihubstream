import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SITE_URL,
  getArg,
  resolveSiteProperty,
  siteToInspectUrl,
  printInspectionResult,
  getAccessToken,
  inspectUrl,
  queryAnalytics,
  listSitemaps,
  submitSitemap,
  deleteSitemap,
} from './gsc-telemetry.mjs';

describe('GSC Telemetry Client Contract', () => {
  it('exports expected telemetry inspection methods and constants', () => {
    assert.equal(typeof getAccessToken, 'function');
    assert.equal(typeof inspectUrl, 'function');
    assert.equal(typeof queryAnalytics, 'function');
    assert.equal(typeof listSitemaps, 'function');
    assert.equal(typeof submitSitemap, 'function');
    assert.equal(typeof deleteSitemap, 'function');
    assert.equal(typeof getArg, 'function');
    assert.equal(typeof resolveSiteProperty, 'function');
    assert.equal(typeof siteToInspectUrl, 'function');
    assert.equal(typeof printInspectionResult, 'function');
    assert.equal(DEFAULT_SITE_URL, 'sc-domain:anihubstream.com');
  });

  it('getArg resolves both equals-syntax and space-separated syntax', () => {
    const mockArgs = ['node', 'tools/gsc-telemetry.mjs', '--inspect=https://anihubstream.com/anime', '--days', '14', '--limit', '25'];
    assert.equal(getArg('--inspect', mockArgs), 'https://anihubstream.com/anime');
    assert.equal(getArg('--days', mockArgs), '14');
    assert.equal(getArg('--limit', mockArgs), '25');
    assert.equal(getArg('--missing', mockArgs), null);

    const spaceArgs = ['node', 'tools/gsc-telemetry.mjs', '--inspect', 'https://anihubstream.com/watch/frieren'];
    assert.equal(getArg('--inspect', spaceArgs), 'https://anihubstream.com/watch/frieren');
  });

  it('printInspectionResult prints all relevant fields without throwing', () => {
    const logs = [];
    const origLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));

    try {
      printInspectionResult({
        indexStatusResult: {
          verdict: 'NEUTRAL',
          coverageState: 'Soft 404',
          pageFetchState: 'SUCCESSFUL',
          crawledAs: 'MOBILE',
          robotsTxtState: 'ALLOWED',
          indexingState: 'INDEXING_ALLOWED',
          lastCrawlTime: '2026-11-17T03:26:15Z',
          userCanonical: 'https://anihubstream.com/',
          googleCanonical: 'https://anihubstream.com/',
          referringUrls: ['https://anihubstream.com/anime', 'https://anihubstream.com/genres'],
        },
        richResultsResult: { verdict: 'PASS' },
      });
      const output = logs.join('\n');
      assert.match(output, /Page Fetch:\s*SUCCESSFUL/);
      assert.match(output, /Crawled As:\s*MOBILE/);
      assert.match(output, /Referring URLs:/);
      assert.match(output, /Rich Results:\s*PASS/);
    } finally {
      console.log = origLog;
    }
  });

  it('resolveSiteProperty correctly maps URLs to GSC property types', () => {
    const sites = ['sc-domain:anihubstream.com', 'https://old.domain.com/'];
    assert.equal(resolveSiteProperty('https://anihubstream.com/anime', sites), 'sc-domain:anihubstream.com');
    assert.equal(resolveSiteProperty('https://www.anihubstream.com/genres', sites), 'sc-domain:anihubstream.com');
    assert.equal(resolveSiteProperty('https://old.domain.com/', sites), 'https://old.domain.com/');
    assert.equal(resolveSiteProperty('https://unknown.com', sites), 'sc-domain:anihubstream.com');
    assert.equal(resolveSiteProperty('https://unknown.com', []), 'sc-domain:anihubstream.com');
  });

  it('siteToInspectUrl normalizes sc-domain and trailing slashes', () => {
    assert.equal(siteToInspectUrl('sc-domain:anihubstream.com'), 'https://anihubstream.com/');
    assert.equal(siteToInspectUrl('https://anihubstream.com'), 'https://anihubstream.com/');
    assert.equal(siteToInspectUrl('https://anihubstream.com/'), 'https://anihubstream.com/');
  });

  it('inspectUrl handles HTTP 429 quota exhaustion gracefully', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response('Quota exceeded', { status: 429 });

    try {
      await assert.rejects(
        () => inspectUrl('https://anihubstream.com/', 'dummy-token', 'sc-domain:anihubstream.com'),
        (err) => {
          assert.match(err.message, /quota exceeded \(HTTP 429\)/i);
          return true;
        }
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

