/**
 * Cloudflare Worker: anihubstream-sync-dispatcher
 *
 * Dispatches repository_dispatch events to GitHub Actions (Mohit12441/anihubstream)
 * every 30 minutes via Cloudflare Worker Cron Triggers.
 *
 * Authentication: Reads GH_DISPATCH_TOKEN from Worker environment secrets.
 */

const GITHUB_REPO = 'Mohit12441/anihubstream';
const DISPATCH_URL = `https://api.github.com/repos/${GITHUB_REPO}/dispatches`;
const USER_AGENT = 'AniHubStream-Cloudflare-Cron-Dispatcher/1.0';

export default {
  /**
   * Scheduled cron handler: triggered every 30 minutes by Cloudflare edge cron daemon.
   */
  async scheduled(event, env, ctx) {
    const cronId = `${event.scheduledTime || Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    console.log(`[cron:${cronId}] Triggered scheduled dispatch for cron: ${event.cron}`);
    ctx.waitUntil(triggerDispatch(env, cronId));
  },

  /**
   * HTTP handler: enables authenticated manual pings or health-checks.
   */
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', worker: 'anihubstream-sync-dispatcher' }), {
        headers: { 'content-type': 'application/json' },
      });
    }

    if (url.pathname === '/trigger' && request.method === 'POST') {
      const pingId = `manual-${Date.now()}`;
      const result = await triggerDispatch(env, pingId);
      return new Response(JSON.stringify(result), {
        status: result.success ? 200 : result.status || 500,
        headers: { 'content-type': 'application/json' },
      });
    }

    return new Response('AniHubStream Sync Dispatcher (Cloudflare Cron Worker)', { status: 200 });
  },
};

/**
 * Sends a repository_dispatch event to GitHub Actions.
 */
async function triggerDispatch(env, execId) {
  const token = env.GH_DISPATCH_TOKEN?.trim();

  if (!token) {
    console.error(`[dispatch:${execId}] ERROR: GH_DISPATCH_TOKEN secret is not set in environment`);
    return { success: false, error: 'Missing GH_DISPATCH_TOKEN environment secret' };
  }

  const payload = {
    event_type: 'anilist-sync',
    client_payload: {
      source: 'cloudflare-worker-cron',
      execId,
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
      console.log(`[dispatch:${execId}] SUCCESS: GitHub accepted repository_dispatch (HTTP 204)`);
      return { success: true, status: 204, message: 'Event accepted by GitHub Actions' };
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
