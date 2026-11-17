# AniHubStream

High-performance, serverless anime streaming platform built on Cloudflare Pages, Workers, D1 (SQLite), and edge KV caching. Delivers high-bitrate video directly from edge CDNs to the browser with zero-read edge shield caching and automatic multi-provider fallback.

---

## Architecture Overview

- **Frontend:** React 18, TypeScript, Tailwind CSS, custom responsive player with AniSkip integration.
- **Edge Layer:** Cloudflare Pages Functions (`functions/api/`), D1 relational database (`env.ANIHUB`), and edge KV store (`STREAM_KV`).
- **CDN Video Delivery:** Browser-direct streaming from source CDNs (Voidboost, MegaPlay, etc.) with `referrerPolicy: 'no-referrer'`, bypassing edge proxies and saving bandwidth.
- **Providers:**
  - **AniKoto / MegaPlay:** Multi-server high-speed Japanese audio with English subtitles.
  - **AniPM Beta:** Direct edge-extracted multi-audio streams (English Dub + Japanese Sub).
  - **HiAnime / AniWatch:** Fast failover mirrors.
  - **HDRezka:** 1080p Ultra MP4 streams with Russian dubbing (Studio Band, AniLibria) and Russian subtitles.
  - **P2P Swarm:** WebTorrent peer-to-peer fallback.

---

## HDRezka Subsystem

### Automatic Flow

HDRezka streams are resolved and served serverless with zero-latency edge caching:

1. **Edge Cache First:** The player checks `STREAM_KV` for `hdrezka:meta:<id>` (6-hour TTL). On hit, 1080p Ultra MP4 streams are served immediately.
2. **Scheduled CI Prefetch:** A GitHub Actions workflow (`.github/workflows/hdrezka.yml`) runs on schedule (`7 */2 * * *`) and runs `npm run rezka:auto` to prefetch metadata for watchlist titles and write them into `STREAM_KV`. The script obtains its own session cookie first: `scripts/anubis.mjs` parses the Anubis proof-of-work challenge, solves it, exchanges it for the `anubis-auth` cookie, and `rezka-auto.mjs` writes that cookie plus its timestamp back to `STREAM_KV` for the edge to reuse. No human step is involved.
3. **Async Dispatch on Miss:** When an uncached title is requested, the edge worker triggers a background `workflow_dispatch` (rate-limited to once every 120s per title) and immediately serves AniKoto or AniPM streams so playback never stalls.
4. **Direct Browser Streaming:** Video bytes stream directly from `stream.voidboost.one` to the user's browser with `206 Partial Content`, bypassing worker bandwidth limits.

---

### Manual Override (Exception Path)

The scheduled prefetch is self-sufficient: it solves the challenge and stores its own cookie, so nothing needs to be pushed by hand during normal operation. The commands below exist only to override a stale or misbehaving cookie by hand, or to inspect/clear what is stored.

1. **Push Cookie to KV:**
   ```bash
   npm run rezka:push "<cookie-value>"
   ```
   Normalizes and probes the cookie upstream before writing to Cloudflare KV (valid for 4 days).

2. **Verify Stored Cookie:**
   ```bash
   npm run rezka:check
   ```
   Probes upstream to ensure the active cookie is recognized and valid.

3. **Clear Stored Cookie:**
   ```bash
   npm run rezka:clear
   ```
   Deletes the cookie and timestamp keys from `STREAM_KV`.

4. **Residential Bridge Fallback:**
   ```bash
   npm run bridge:tunnel
   ```
   Launches the local microservice bridge on `:8795` and exposes a Cloudflare Quick Tunnel as an emergency backup.

---

## Scripts & CLI Commands

| Command | Description |
|---|---|
| `npm run dev` | Start local Vite development server |
| `npm test` | Run full test suite (unit tests, edge mocks, ID mapping) |
| `npm run test:playback` | Diagnostic probe testing upstream connectivity and streams |
| `npm run typecheck` | Run TypeScript type validation (`tsc --noEmit`) |
| `npm run build` | Compile production build into `dist-pages/` |
| `npm run rezka:auto` | Prefetch metadata for watchlist IDs into `STREAM_KV` |
| `npm run rezka:push` | Manual override only: validate and push a session cookie to KV |
| `npm run rezka:check` | Check status of stored KV cookie |
| `npm run rezka:clear` | Remove stored cookie from KV |
| `npm run bridge:tunnel` | Start local bridge and Cloudflare Tunnel together |

---

## Environment Variables & Secrets

### Cloudflare Pages Secrets
- `STREAM_KV`: Cloudflare KV namespace binding for stream metadata and cookies.
- `GH_DISPATCH_TOKEN`: GitHub personal access token with `actions:write` for cold-start cache dispatch.
- `STREAM_BRIDGE_URL`: (Optional) Custom residential bridge or tunnel URL override.

### CI / Local Prefetch
- `CF_API_TOKEN`: Cloudflare API token with `Workers KV:Edit` permissions.
- `CF_ACCOUNT_ID`: Cloudflare Account ID.
- `CF_KV_NAMESPACE`: Namespace ID for `STREAM_KV`.
- `IDS` / `HDREZKA_WATCHLIST`: Comma-separated list of HDRezka anime IDs for automatic prefetching.
- `REZKA_COOKIE`: (Optional) Secret used only when the Anubis solve fails after 3 attempts; the run logs a loud warning when it falls back.
- `REZKA_DISABLED`: Set to `1` to skip the prefetch entirely; checked before any other work so it works even with missing credentials.
