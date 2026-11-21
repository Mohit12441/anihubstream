// @ts-check
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as hindiflix from './adapters/hindiflix.mjs';

describe('HindiFlix Native Adapter & Resolver Suite', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      const urlStr = String(url);
      if (urlStr.includes('/wp-admin/admin-ajax.php')) {
        const body = opts?.body ? String(opts.body) : '';
        if (body.includes('xyznonexistentanimexyz9999')) {
          return new Response(JSON.stringify({ anime: [{ all: [] }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify({
          anime: [
            {
              all: [
                {
                  ID: 101,
                  post_title: 'Solo Leveling Season 1 (Hindi Dub)',
                  post_link: 'https://hindiflix.cc/watch/solo-leveling-season-1-hindi-dub/',
                  post_image: 'https://hindiflix.cc/wp-content/uploads/solo.jpg',
                  post_genres: 'Action, Fantasy',
                  post_type: 'TV',
                  post_latest: '12'
                }
              ]
            }
          ]
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      if (urlStr.includes('/watch/solo-leveling-season-1-hindi-dub/')) {
        const html = `
          <!DOCTYPE html>
          <html>
            <head><title>Solo Leveling Season 1 (Hindi Dub) - HindiFlix</title></head>
            <body>
              <a href="https://hindiflix.cc/solo-leveling-episode-1-hindi-dub/">Episode 1</a>
              <a href="https://hindiflix.cc/solo-leveling-episode-2-hindi-dub/">Episode 2</a>
            </body>
          </html>
        `;
        return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html' } });
      }

      if (urlStr.includes('/solo-leveling-episode-1-hindi-dub/')) {
        const html = `
          <!DOCTYPE html>
          <html>
            <body>
              <video src="https://storage.hindiflix.cc/anime/solo-leveling-ep1-1080p.mp4"></video>
            </body>
          </html>
        `;
        return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html' } });
      }

      if (urlStr.includes('/non-existent-episode-url-404/')) {
        return new Response('Not found', { status: 404 });
      }

      return originalFetch(url, opts);
    };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('searches for anime titles and returns normalized results', async () => {
    const hits = await hindiflix.search('Solo Leveling');
    assert.ok(Array.isArray(hits), 'Expected hits to be an array');
    assert.ok(hits.length > 0, 'Expected at least 1 hit for Solo Leveling');
    const first = hits[0];
    assert.ok(first.title.toLowerCase().includes('solo leveling'));
    assert.ok(first.link.startsWith('http'));
    assert.ok(first.genres.length > 0);
  });

  it('fetches series details and extracts canonical episodes list', async () => {
    const details = await hindiflix.details('https://hindiflix.cc/watch/solo-leveling-season-1-hindi-dub/');
    assert.ok(details !== null);
    assert.ok(details.episodes.length > 0);
    assert.equal(details.episodes[0].epNum, 1);
    assert.ok(details.episodes[0].url.includes('episode-1'));
  });

  it('extracts direct stream payload with valid CORS and MP4 type', async () => {
    const stream = await hindiflix.sources('https://hindiflix.cc/solo-leveling-episode-1-hindi-dub/');
    assert.ok(stream !== null);
    assert.equal(stream.type, 'mp4');
    assert.equal(stream.audio, 'dub');
    assert.ok(stream.streamUrl.startsWith('https://storage.hindiflix.cc/'));
    assert.ok(stream.audioTracks.some((t) => t.language === 'hi'));
  });

  it('handles unknown anime query gracefully with empty array', async () => {
    const hits = await hindiflix.search('xyznonexistentanimexyz9999');
    assert.deepEqual(hits, []);
  });

  it('handles invalid episode URL gracefully with null', async () => {
    const stream = await hindiflix.sources('https://hindiflix.cc/non-existent-episode-url-404/');
    assert.equal(stream, null);
  });
});

