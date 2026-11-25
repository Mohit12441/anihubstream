// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  submitUrlsToBing,
  broadcastToDiscord,
  notifySearchEnginesOfNewEpisodes,
  DEFAULT_SITE_URL,
} from './auto-push-new-episodes.mjs';

test('auto-push: handles missing API key gracefully without throwing', async () => {
  const prevKey = process.env.BING_WEBMASTER_API_KEY;
  try {
    delete process.env.BING_WEBMASTER_API_KEY;
    const res = await submitUrlsToBing(['https://anihubstream.com/watch/solo-leveling/1'], { ignoreEnvFile: true });
    assert.equal(res.success, false);
    assert.equal(res.error, 'missing_api_key');
    assert.equal(res.count, 0);
  } finally {
    if (prevKey) process.env.BING_WEBMASTER_API_KEY = prevKey;
  }
});

test('auto-push: handles empty array cleanly', async () => {
  const res = await submitUrlsToBing([], { apiKey: 'dummy-key' });
  assert.equal(res.success, true);
  assert.equal(res.count, 0);
});

test('auto-push: deduplicates URLs before sending', async () => {
  const origFetch = globalThis.fetch;
  let sentPayload = null;
  // @ts-ignore
  globalThis.fetch = async (url, opts) => {
    sentPayload = JSON.parse(opts.body);
    return new Response(JSON.stringify({ d: null }), { status: 200 });
  };

  try {
    const urls = [
      'https://anihubstream.com/watch/solo-leveling/1',
      'https://anihubstream.com/watch/solo-leveling/1',
      'https://anihubstream.com/watch/solo-leveling/2',
    ];
    const res = await submitUrlsToBing(urls, { apiKey: 'mock-key', siteUrl: DEFAULT_SITE_URL });
    assert.equal(res.success, true);
    assert.equal(res.count, 2);
    assert.equal(sentPayload.urlList.length, 2);
    assert.deepEqual(sentPayload.urlList, [
      'https://anihubstream.com/watch/solo-leveling/1',
      'https://anihubstream.com/watch/solo-leveling/2',
    ]);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('auto-push: notifySearchEnginesOfNewEpisodes calls Bing and IndexNow', async () => {
  const origFetch = globalThis.fetch;
  const calls = [];
  // @ts-ignore
  globalThis.fetch = async (url, opts) => {
    calls.push({ url: String(url), body: JSON.parse(opts.body) });
    return new Response(JSON.stringify({ d: null, success: true }), { status: 200 });
  };

  try {
    const urls = ['https://anihubstream.com/watch/blue-box/5'];
    const res = await notifySearchEnginesOfNewEpisodes(urls, {
      bypassLedger: true,
    });
    assert.ok(res.bingCount >= 0);
    assert.ok(res.indexNowCount >= 0);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('auto-push: broadcastToDiscord skips cleanly when no webhook is set', async () => {
  const res = await broadcastToDiscord(['https://anihubstream.com/watch/solo-leveling/1'], { ignoreEnvFile: true });
  assert.equal(res.success, true);
  assert.equal(res.skipped, true);
  assert.equal(res.count, 0);
});

test('auto-push: broadcastToDiscord sends rich webhook payload when configured', async () => {
  const origFetch = globalThis.fetch;
  let sentPayload = null;
  // @ts-ignore
  globalThis.fetch = async (url, opts) => {
    sentPayload = JSON.parse(opts.body);
    return new Response(null, { status: 204 });
  };

  try {
    const urls = [
      'https://anihubstream.com/watch/solo-leveling/1',
      'https://anihubstream.com/watch/solo-leveling/2',
    ];
    const res = await broadcastToDiscord(urls, {
      discordWebhookUrl: 'https://discord.com/api/webhooks/mock/test',
    });
    assert.equal(res.success, true);
    assert.equal(res.count, 2);
    assert.ok(sentPayload);
    assert.equal(sentPayload.username, 'AniHubStream Episode Bot');
    assert.ok(sentPayload.embeds[0].description.includes('solo-leveling/1'));
    assert.ok(sentPayload.embeds[0].description.includes('solo-leveling/2'));
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('auto-push: broadcastToDiscord sends via Bot Token and Channel ID', async () => {
  const origFetch = globalThis.fetch;
  let targetUrl = '';
  let authHeader = '';
  // @ts-ignore
  globalThis.fetch = async (url, opts) => {
    targetUrl = String(url);
    authHeader = opts.headers['Authorization'];
    return new Response(JSON.stringify({ id: 'msg-123' }), { status: 200 });
  };

  try {
    const res = await broadcastToDiscord(['https://anihubstream.com/watch/solo-leveling/1'], {
      discordBotToken: 'mock-bot-token',
      discordChannelId: '987654321',
      ignoreEnvFile: true,
    });
    assert.equal(res.success, true);
    assert.equal(res.count, 1);
    assert.equal(targetUrl, 'https://discord.com/api/v10/channels/987654321/messages');
    assert.equal(authHeader, 'Bot mock-bot-token');
  } finally {
    globalThis.fetch = origFetch;
  }
});
