/**
 * Cloudflare Worker: anihubstream-sync-dispatcher
 *
 * Dispatches repository_dispatch events to GitHub Actions (Mohit12441/anihubstream)
 * with dedicated staggered schedules:
 *   - "7,37 * * * *"  -> event_type: "anilist-sync"
 *   - "17,47 * * * *" -> event_type: "kitsu-sync"
 *
 * Security:
 *   - Unauthenticated /trigger route has been removed. All non-health endpoints return 404.
 *   - /health is strictly read-only GET/HEAD and exposes no credentials or secrets.
 *   - Failed scheduled runs (missing token, network failure, non-204) throw errors
 *     so Cloudflare Workers records them as failed scheduled executions.
 *   - Authentication token (GH_DISPATCH_TOKEN) is never printed or logged.
 */

const GITHUB_REPO = 'Mohit12441/anihubstream';
const DISPATCH_URL = `https://api.github.com/repos/${GITHUB_REPO}/dispatches`;
const USER_AGENT = 'AniHubStream-Cloudflare-Cron-Dispatcher/1.0';

export default {
  /**
   * Scheduled cron handler: triggered by Cloudflare edge cron daemon.
   */
  async scheduled(event, env, ctx) {
    const cron = event.cron;
    const cronId = `${event.scheduledTime || Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const utcHour = new Date(event.scheduledTime || Date.now()).getUTCHours();
    
    // Select event type and execution target based on schedule:
    // - 02:00 & 14:00 UTC -> Full deep catalog sync (event: 'catalog-sync', target: 'all')
    // - Hourly ticks -> Fast 45-second pulse (event: 'pulse', target: 'pulse')
    let eventType = 'pulse';
    let target = 'pulse';

    if (cron === '0 2,14 * * *' || (cron === '0 * * * *' && (utcHour === 2 || utcHour === 14))) {
      eventType = 'catalog-sync';
      target = 'all';
    } else if (cron === '0 * * * *') {
      eventType = 'pulse';
      target = 'pulse';
    } else if (cron === '45 */6 * * *') {
      eventType = 'providers-sync';
      target = 'providers';
    } else if (cron === '27,57 * * * *') {
      eventType = 'hianime-sync';
      target = 'hianime';
    } else if (cron === '17,47 * * * *') {
      eventType = 'kitsu-sync';
      target = 'kitsu';
    } else if (cron === '7,37 * * * *') {
      eventType = 'anilist-sync';
      target = 'anilist';
    } else {
      eventType = 'pulse';
      target = 'pulse';
    }

    console.log(`[cron:${cronId}] Triggered cron: "${cron}" -> Dispatching event_type: "${eventType}" (target: "${target}")`);

    const result = await triggerDispatch(env, cronId, eventType, target);

    if (!result.success) {
      const errMsg = `Scheduled dispatch failed for "${eventType}": ${result.error || `HTTP ${result.status}`}`;
      console.error(`[cron:${cronId}] EXECUTION_FAILED: ${errMsg}`);
      // Throwing causes Cloudflare Workers runtime to record this run as a failed scheduled execution
      throw new Error(errMsg);
    }

    console.log(`[cron:${cronId}] EXECUTION_SUCCESS: Dispatched "${eventType}" (target: "${target}") (HTTP 204)`);
    return result;
  },

  /**
   * HTTP handler: strictly read-only health checks. All other paths/methods return 404/405.
   */
  async fetch(request, env) {
    const url = new URL(request.url);

    // Strictly read-only health check endpoint
    if (url.pathname === '/health') {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
          status: 405,
          headers: {
            'content-type': 'application/json',
            'allow': 'GET, HEAD',
          },
        });
      }

      return new Response(JSON.stringify({
        status: 'ok',
        worker: 'anihubstream-sync-dispatcher',
        supported_events: ['pulse', 'catalog-sync', 'anilist-sync', 'kitsu-sync', 'hianime-sync', 'providers-sync'],
        schedules: ['0 * * * * (hourly pulse on :00, deep sync on 02:00/14:00 UTC)'],
      }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'cache-control': 'no-store',
        },
      });
    }

    // All other routes, including /trigger, return 404 Not Found
    return new Response(JSON.stringify({ error: 'Not Found' }), {
      status: 404,
      headers: {
        'content-type': 'application/json',
      },
    });
  },
};

/**
 * Sends a repository_dispatch event to GitHub Actions.
 * Never logs credentials or secrets.
 */
export async function triggerDispatch(env, execId, eventType = 'pulse', target = '') {
  const token = env?.GH_DISPATCH_TOKEN?.trim();

  if (!token) {
    console.error(`[dispatch:${execId}] ERROR: GH_DISPATCH_TOKEN secret is not configured`);
    return { success: false, error: 'Missing GH_DISPATCH_TOKEN environment secret' };
  }

  const payload = {
    event_type: eventType,
    client_payload: {
      source: 'cloudflare-worker-cron',
      execId,
      eventType,
      target: target || (eventType === 'pulse' ? 'pulse' : (eventType === 'catalog-sync' ? 'all' : eventType)),
      timestamp: new Date().toISOString(),
    },
  };

  try {
    const res = await fetch(DISPATCH_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': USER_AGENT,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify(payload),
    });

    if (res.status === 204) {
      console.log(`[dispatch:${execId}] SUCCESS: GitHub accepted repository_dispatch for "${eventType}" (HTTP 204)`);
      return { success: true, status: 204, event_type: eventType, message: 'Event accepted by GitHub Actions' };
    }

    let errorDetail = '';
    try {
      const json = await res.json();
      errorDetail = json.message || JSON.stringify(json);
    } catch {
      errorDetail = await res.text().catch(() => '');
    }

    console.error(`[dispatch:${execId}] FAILED: GitHub responded with HTTP ${res.status}: ${errorDetail.slice(0, 300)}`);
    return { success: false, status: res.status, error: errorDetail.slice(0, 300) };
  } catch (err) {
    console.error(`[dispatch:${execId}] NETWORK_ERROR: Failed to contact GitHub API: ${err.message}`);
    return { success: false, error: err.message };
  }
}
