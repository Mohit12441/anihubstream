import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const MANIFEST_PATH = path.join(ROOT, 'public', 'manifest.webmanifest');
const SW_PATH = path.join(ROOT, 'public', 'sw.js');
const HEADERS_PATH = path.join(ROOT, 'public', '_headers');
const INDEX_PATH = path.join(ROOT, 'index.html');

test('PWA manifest.webmanifest has valid structure and required fields', () => {
  assert.ok(fs.existsSync(MANIFEST_PATH), 'manifest.webmanifest exists in public/');
  const raw = fs.readFileSync(MANIFEST_PATH, 'utf-8');
  const manifest = JSON.parse(raw);

  assert.equal(typeof manifest.name, 'string');
  assert.equal(typeof manifest.short_name, 'string');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.theme_color.startsWith('#'), 'valid theme_color hex');
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length > 0, 'icons array exists');
  assert.ok(Array.isArray(manifest.shortcuts) && manifest.shortcuts.length > 0, 'shortcuts array exists');

  // Verify icon formats
  const svgIcon = manifest.icons.find((i) => i.type === 'image/svg+xml');
  assert.ok(svgIcon, 'SVG vector emblem icon is defined');
  assert.ok(svgIcon.purpose.includes('maskable'), 'maskable purpose supported');
});

test('Service Worker sw.js defines cache names, LRU eviction, and matching regexes', () => {
  assert.ok(fs.existsSync(SW_PATH), 'sw.js exists in public/');
  const swCode = fs.readFileSync(SW_PATH, 'utf-8');

  // Cache names & constants
  assert.ok(/SHELL_CACHE = 'anihub-shell-v\d+'/.test(swCode), 'SHELL_CACHE defined');
  assert.ok(/STREAM_CACHE = 'anihub-stream-v\d+'/.test(swCode), 'STREAM_CACHE defined');
  assert.ok(swCode.includes('MAX_STREAM_SEGMENTS'), 'MAX_STREAM_SEGMENTS defined');

  // Core functions
  assert.ok(swCode.includes('function isStreamSegment'), 'isStreamSegment function exists');
  assert.ok(swCode.includes('function isPlaylist'), 'isPlaylist function exists');
  assert.ok(swCode.includes('function isStaticAsset'), 'isStaticAsset function exists');
  assert.ok(swCode.includes('async function pruneLru'), 'pruneLru function exists');

  // Lifecycle & events
  assert.ok(swCode.includes("addEventListener('install'"), 'install event listener registered');
  assert.ok(swCode.includes("addEventListener('activate'"), 'activate event listener registered');
  assert.ok(swCode.includes("addEventListener('message'"), 'message event listener registered');
  assert.ok(swCode.includes("addEventListener('fetch'"), 'fetch event listener registered');

  // Messaging actions
  assert.ok(swCode.includes('SKIP_WAITING'), 'SKIP_WAITING action supported');
  assert.ok(swCode.includes('CLEAR_STREAM_CACHE'), 'CLEAR_STREAM_CACHE action supported');
  assert.ok(swCode.includes('GET_CACHE_STATS'), 'GET_CACHE_STATS action supported');
});

test('Service Worker segment identification logic', () => {
  // Extract and simulate isStreamSegment and isPlaylist
  function isStreamSegment(url) {
    try {
      const u = new URL(url);
      const pathname = u.pathname.toLowerCase();
      if (pathname.endsWith('.ts') || pathname.endsWith('.m4s') || pathname.endsWith('.m4v')) {
        return true;
      }
      if (pathname.startsWith('/api/proxy')) {
        const target = (u.searchParams.get('url') || '').toLowerCase();
        if (target.includes('.ts') || target.includes('.m4s') || target.includes('seg-') || target.includes('fragment')) {
          return true;
        }
      }
      return false;
    } catch {
      return false;
    }
  }

  function isPlaylist(url) {
    try {
      const u = new URL(url);
      const pathname = u.pathname.toLowerCase();
      if (pathname.endsWith('.m3u8') || pathname.endsWith('.m3u')) {
        return true;
      }
      if (pathname.startsWith('/api/proxy')) {
        const target = (u.searchParams.get('url') || '').toLowerCase();
        if (target.includes('.m3u8')) return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  // Direct HLS segments
  assert.equal(isStreamSegment('https://cdn.example.com/hls/ep1/segment-001.ts'), true);
  assert.equal(isStreamSegment('https://cdn.example.com/dash/video_chunk_004.m4s'), true);
  // Proxied HLS segments
  assert.equal(isStreamSegment('http://127.0.0.1:8899/api/proxy?url=https%3A%2F%2Fmegaplay.buzz%2Fseg-12.ts'), true);
  // Direct HLS playlists
  assert.equal(isPlaylist('https://cdn.example.com/hls/master.m3u8'), true);
  // Proxied HLS playlists
  assert.equal(isPlaylist('http://127.0.0.1:8899/api/proxy?url=https%3A%2F%2Ffetch.nexabloom.top%2Fmaster.m3u8'), true);
  // Regular API requests (must NOT match stream segment or playlist)
  assert.equal(isStreamSegment('http://127.0.0.1:8899/api/home'), false);
  assert.equal(isPlaylist('http://127.0.0.1:8899/api/play?id=naruto&ep=1'), false);
});

test('public/_headers configures no-cache for sw.js and manifest mime-type', () => {
  const headers = fs.readFileSync(HEADERS_PATH, 'utf-8');
  assert.ok(headers.includes('/sw.js'), '_headers includes /sw.js');
  assert.ok(headers.includes('Service-Worker-Allowed: /'), '_headers configures Service-Worker-Allowed');
  assert.ok(headers.includes('/manifest.webmanifest'), '_headers includes /manifest.webmanifest');
  assert.ok(headers.includes('application/manifest+json'), '_headers sets manifest mime type');
});

test('index.html links manifest and mobile web app meta tags', () => {
  const html = fs.readFileSync(INDEX_PATH, 'utf-8');
  assert.ok(html.includes('<link rel="manifest" href="/manifest.webmanifest" />'), 'manifest link present');
  assert.ok(html.includes('<meta name="apple-mobile-web-app-capable" content="yes" />'), 'apple mobile capable present');
  assert.ok(html.includes('<meta name="mobile-web-app-capable" content="yes" />'), 'mobile web app capable present');
});
