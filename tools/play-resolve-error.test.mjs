import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet as resolveGet } from '../functions/api/play/resolve.js';

test('Resolve API returns episode_not_yet_available (404) for ongoing anime with no uploaded stream', async () => {
  const mockEnv = {
    ANIHUB: {
      prepare: (sql) => ({
        bind: () => ({
          first: async () => ({
            id: 'ongoing-test-anime',
            title: 'Ongoing Test Anime',
            status: 'Ongoing',
            sched_day: 1,
            sched_time: '14:00',
            mal_id: 9999999,
            anilist_id: 9999999,
          }),
        }),
      }),
    },
    STREAM_BRIDGE_URL: 'http://127.0.0.1:9999', // unreachable
  };

  const req = new Request('http://localhost/api/play/resolve?anime_id=ongoing-test-anime&ep=6&provider=anikoto');
  const res = await resolveGet({ request: req, env: mockEnv, waitUntil: () => {} });

  assert.equal(res.status, 404, 'Must return 404 instead of 502/500');
  const body = await res.json();
  assert.equal(body.error, 'episode_not_yet_available', 'Error code must be episode_not_yet_available');
  assert.match(body.message, /not yet available|processing/i);
});

test('Resolve API returns upstream failure (504 or 502) for finished anime when bridge unreachable', async () => {
  const mockEnv = {
    ANIHUB: {
      prepare: (sql) => ({
        bind: () => ({
          first: async () => ({
            id: 'finished-test-anime',
            title: 'Finished Test Anime',
            status: 'Finished',
            mal_id: 8888888,
            anilist_id: 8888888,
          }),
        }),
      }),
    },
    STREAM_BRIDGE_URL: 'http://127.0.0.1:9999', // unreachable
  };

  const req = new Request('http://localhost/api/play/resolve?anime_id=finished-test-anime&ep=1&provider=anikoto');
  const res = await resolveGet({ request: req, env: mockEnv, waitUntil: () => {} });

  assert.ok(res.status === 502 || res.status === 504, `Status was ${res.status}`);
  const body = await res.json();
  assert.ok(body.error === 'provider_error' || body.error === 'upstream_timeout');
});
