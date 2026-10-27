/* ============================================================
   AniHubStream — sync health endpoint (Cloudflare Worker).

   The hourly AniList refresh this file used to run on a cron trigger now
   runs from the operator machine (tools/hourly-refresh.mjs, Windows task
   "AniHubHourlyRefresh"): AniList answers 403 "You have been manually
   blocked" to Cloudflare's shared datacenter egress (verified 2026-10-13).
   Both writers publish into the same D1.

   This worker has no trigger and exports no scheduled handler; it only
   reports, read-only, what the last refresh recorded in sync_meta.
   ============================================================ */

export default {
  async fetch(request, env) {
    const row = await env.ANIHUB.prepare("SELECT value FROM sync_meta WHERE key = 'hourly_sync'").first();
    let last = null;
    try {
      last = row ? JSON.parse(row.value) : null;
    } catch {
      last = row?.value ?? null;
    }
    return Response.json({ service: 'anihub-sync', role: 'health (refresh runs on the operator machine)', last });
  },
};
