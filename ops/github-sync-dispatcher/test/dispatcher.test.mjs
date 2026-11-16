import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker, { triggerDispatch } from '../src/index.mjs';

describe('github-sync-dispatcher worker', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('HTTP Handler (fetch)', () => {
    it('returns HTTP 404 for unauthenticated POST /trigger', async () => {
      const req = new Request('https://anihubstream-sync-dispatcher.workers.dev/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_type: 'anilist-sync' }),
      });
      const env = { GH_DISPATCH_TOKEN: 'test-token-123' };

      const res = await worker.fetch(req, env);
      assert.equal(res.status, 404);
      const data = await res.json();
      assert.equal(data.error, 'Not Found');
    });

    it('returns HTTP 404 for GET /trigger', async () => {
      const req = new Request('https://anihubstream-sync-dispatcher.workers.dev/trigger', {
        method: 'GET',
      });
      const env = { GH_DISPATCH_TOKEN: 'test-token-123' };

      const res = await worker.fetch(req, env);
      assert.equal(res.status, 404);
    });

    it('returns HTTP 404 for root / or arbitrary paths', async () => {
      const req = new Request('https://anihubstream-sync-dispatcher.workers.dev/', {
        method: 'GET',
      });
      const env = { GH_DISPATCH_TOKEN: 'test-token-123' };

      const res = await worker.fetch(req, env);
      assert.equal(res.status, 404);
    });

    it('/health returns HTTP 200 with read-only metadata and NO secrets', async () => {
      const req = new Request('https://anihubstream-sync-dispatcher.workers.dev/health', {
        method: 'GET',
      });
      const secretToken = 'ghp_super_secret_token_never_expose_9999';
      const env = { GH_DISPATCH_TOKEN: secretToken };

      const res = await worker.fetch(req, env);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('content-type'), 'application/json');

      const bodyText = await res.text();
      assert.ok(!bodyText.includes(secretToken), 'Response must not contain secret token');
      assert.ok(!bodyText.includes('GH_DISPATCH_TOKEN'), 'Response must not mention secret name');

      const data = JSON.parse(bodyText);
      assert.equal(data.status, 'ok');
      assert.equal(data.worker, 'anihubstream-sync-dispatcher');
      assert.deepEqual(data.supported_events, ['pulse', 'catalog-sync', 'anilist-sync', 'kitsu-sync', 'hianime-sync', 'providers-sync']);
      assert.ok(Array.isArray(data.schedules));
    });

    it('/health rejects non-GET/HEAD methods with HTTP 405 Method Not Allowed', async () => {
      for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
        const req = new Request('https://anihubstream-sync-dispatcher.workers.dev/health', {
          method,
          body: method === 'GET' || method === 'HEAD' ? undefined : JSON.stringify({ ping: true }),
        });
        const env = { GH_DISPATCH_TOKEN: 'test-token' };

        const res = await worker.fetch(req, env);
        assert.equal(res.status, 405, `Expected 405 for ${method}`);
        assert.equal(res.headers.get('allow'), 'GET, HEAD');
      }
    });
  });

  describe('Scheduled Cron Handler', () => {
    it('dispatches pulse for hourly cron ticks (target: "pulse")', async () => {
      let capturedUrl = null;
      let capturedOpts = null;

      globalThis.fetch = async (url, opts) => {
        capturedUrl = url;
        capturedOpts = opts;
        return new Response(null, { status: 204 });
      };

      // Set scheduledTime to Wednesday 05:00 UTC
      const date = new Date('2026-10-21T05:00:00Z');
      const event = { cron: '7 * * * *', scheduledTime: date.getTime() };
      const env = { GH_DISPATCH_TOKEN: 'secret-token-xyz' };
      const ctx = { waitUntil: (p) => p };

      const result = await worker.scheduled(event, env, ctx);
      assert.equal(result.success, true);
      assert.equal(result.status, 204);
      assert.equal(result.event_type, 'pulse');

      assert.equal(capturedUrl, 'https://api.github.com/repos/Mohit12441/anihubstream/dispatches');
      assert.equal(capturedOpts.method, 'POST');
      assert.equal(capturedOpts.headers['Authorization'], 'Bearer secret-token-xyz');
      assert.equal(capturedOpts.headers['Accept'], 'application/vnd.github+json');
      assert.equal(capturedOpts.headers['User-Agent'], 'AniHubStream-Cloudflare-Cron-Dispatcher/1.0');

      const payload = JSON.parse(capturedOpts.body);
      assert.equal(payload.event_type, 'pulse');
      assert.equal(payload.client_payload.eventType, 'pulse');
      assert.equal(payload.client_payload.target, 'pulse');
      assert.equal(payload.client_payload.source, 'cloudflare-worker-cron');
    });

    it('dispatches daily-sync for 24-hour daily runs at 00:00 and 12:00 UTC (target: "daily")', async () => {
      let capturedOpts = null;

      globalThis.fetch = async (url, opts) => {
        capturedOpts = opts;
        return new Response(null, { status: 204 });
      };

      // Set scheduledTime to Wednesday 00:00 UTC
      const date = new Date('2026-10-21T00:00:00Z');
      const event = { cron: '7 * * * *', scheduledTime: date.getTime() };
      const env = { GH_DISPATCH_TOKEN: 'secret-token-xyz' };
      const ctx = { waitUntil: (p) => p };

      const result = await worker.scheduled(event, env, ctx);
      assert.equal(result.success, true);
      assert.equal(result.status, 204);
      assert.equal(result.event_type, 'daily-sync');

      const payload = JSON.parse(capturedOpts.body);
      assert.equal(payload.event_type, 'daily-sync');
      assert.equal(payload.client_payload.eventType, 'daily-sync');
      assert.equal(payload.client_payload.target, 'daily');
    });

    it('dispatches providers-sync on Sunday at 03:00 UTC (target: "providers")', async () => {
      let capturedOpts = null;

      globalThis.fetch = async (url, opts) => {
        capturedOpts = opts;
        return new Response(null, { status: 204 });
      };

      // Set scheduledTime to Sunday 03:00 UTC (2026-10-25 was Sunday)
      const date = new Date('2026-10-25T03:00:00Z');
      const event = { cron: '7 * * * *', scheduledTime: date.getTime() };
      const env = { GH_DISPATCH_TOKEN: 'secret-token-xyz' };
      const ctx = { waitUntil: (p) => p };

      const result = await worker.scheduled(event, env, ctx);
      assert.equal(result.success, true);
      assert.equal(result.status, 204);
      assert.equal(result.event_type, 'providers-sync');

      const payload = JSON.parse(capturedOpts.body);
      assert.equal(payload.event_type, 'providers-sync');
      assert.equal(payload.client_payload.eventType, 'providers-sync');
      assert.equal(payload.client_payload.target, 'providers');
    });

    it('throws error when GH_DISPATCH_TOKEN is missing (records as failed execution)', async () => {
      const event = { cron: '7 * * * *', scheduledTime: Date.now() };
      const env = {}; // No token
      const ctx = { waitUntil: (p) => p };

      await assert.rejects(
        async () => {
          await worker.scheduled(event, env, ctx);
        },
        /Scheduled dispatch failed for ".*": Missing GH_DISPATCH_TOKEN/
      );
    });

    it('throws error when GitHub responds with non-204 status (e.g. 401)', async () => {
      globalThis.fetch = async () => {
        return new Response(JSON.stringify({ message: 'Bad credentials' }), { status: 401 });
      };

      const event = { cron: '7 * * * *', scheduledTime: Date.now() };
      const env = { GH_DISPATCH_TOKEN: 'invalid-token' };
      const ctx = { waitUntil: (p) => p };

      await assert.rejects(
        async () => {
          await worker.scheduled(event, env, ctx);
        },
        /Scheduled dispatch failed for ".*": Bad credentials/
      );
    });

    it('throws error on network failure (records as failed execution)', async () => {
      globalThis.fetch = async () => {
        throw new Error('Connection reset by peer');
      };

      const event = { cron: '7,37 * * * *', scheduledTime: Date.now() };
      const env = { GH_DISPATCH_TOKEN: 'valid-token' };
      const ctx = { waitUntil: (p) => p };

      await assert.rejects(
        async () => {
          await worker.scheduled(event, env, ctx);
        },
        /Connection reset by peer/
      );
    });

    it('never leaks token in thrown errors', async () => {
      const sensitiveToken = 'ghp_sensitive_secret_token_ABC_123';
      globalThis.fetch = async () => {
        return new Response(JSON.stringify({ message: 'Validation Failed' }), { status: 422 });
      };

      const event = { cron: '7,37 * * * *', scheduledTime: Date.now() };
      const env = { GH_DISPATCH_TOKEN: sensitiveToken };
      const ctx = { waitUntil: (p) => p };

      try {
        await worker.scheduled(event, env, ctx);
        assert.fail('Should have thrown');
      } catch (err) {
        assert.ok(!err.message.includes(sensitiveToken), 'Error message must not leak token');
        assert.ok(!err.stack?.includes(sensitiveToken), 'Error stack must not leak token');
      }
    });
  });
});
