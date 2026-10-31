# DevFlow Project Audit & Inspection Report: AniHubStream

**Date:** 2026-10-31  
**Checkpoint Commit Hash:** `63fe6ab2626e2a225ee4b0c74828f7312aa219fb` (`63fe6ab`)  
**Branch:** `agent-workflow-baseline`  
**Standard:** Enterprise Agent Framework (EAF) & DevFlow Autonomous Protocol  

---

## 1. Executive Summary

A comprehensive architectural and code-level inspection was performed on **AniHubStream** across all tiers:
1. **Edge Workers Layer** (`functions/api/`): Cloudflare Pages Functions & D1 SQLite data access.
2. **Stream Bridge & Upstream Extractors** (`api/`): Node.js provider extractors (HiAnime, AniKoto, Gogoanime, etc.).
3. **Frontend Application** (`src/`): React 18, TypeScript, Vite, HLS player controls, and data layer.
4. **Tooling & Orchestration** (`tools/`): Server supervisor, local dev harnesses, and offline sync utilities.

All unit and integration tests (478 tests across 113 suites) and the Zero-Read D1 cache suite are passing. However, the audit uncovered **8 notable issues**, including **2 critical Cloudflare D1 quota risks**, **1 architectural boundary mutation leak**, and **machine-specific hardcoded paths**.

---

## 2. Categorized Findings: Bugs, Drawbacks & Architectural Violations

### Critical Severity

#### 1. Uncached Full-Table Scans on Public Catalog Endpoint (`functions/api/anime/index.js`)
- **Location:** [`functions/api/anime/index.js`](file:///C:/anihubstream-local/functions/api/anime/index.js#L59-L135)
- **Violation:** Violates **Rule 11 (Zero-Read D1 Edge Caching Law)**.
- **Issue:** Unlike [`functions/api/anime/[id].js`](file:///C:/anihubstream-local/functions/api/anime/[id].js) which uses `withEdgeCache(...)`, the main catalogue listing and filter endpoint `/api/anime` executes direct, unbuffered D1 queries:
  ```javascript
  const countRow = await env.DB.prepare(countSql).bind(...bindParams).first();
  const rows = await env.DB.prepare(querySql).bind(...bindParams).all();
  ```
- **Impact:** Each public visit or search query scans thousands of rows in Cloudflare D1. Under moderate production traffic, this will exhaust Cloudflare's free tier (5,000,000 row reads/day) within days.
- **Remediation:** Wrap the handler inside `withEdgeCache(onRequestGet, { maxAge: 300, sMaxAge: 3600 })` and strip unneeded URL search params (`utm_*`, `fbclid`).

#### 2. Unbounded D1 Scans on Public Stats Endpoint (`functions/api/stats/index.js`)
- **Location:** [`functions/api/stats/index.js`](file:///C:/anihubstream-local/functions/api/stats/index.js#L4-L29)
- **Violation:** Violates **Rule 11 (Zero-Read D1 Edge Caching Law)**.
- **Issue:** The stats endpoint executes three expensive full-table queries on every single request with zero caching:
  - `SELECT count(*) AS total_anime FROM anime`
  - `SELECT count(*) AS ongoing_anime FROM anime WHERE status = 'Ongoing'`
  - `SELECT genre_id, count(*) AS count FROM anime_genre GROUP BY genre_id ORDER BY count DESC LIMIT 15`
- **Impact:** Every stats widget refresh triggers full index scans on the D1 database.
- **Remediation:** Wrap with `withEdgeCache` with a 1-day TTL (`s-maxage=86400`) or store pre-aggregated counter rows in `schedule_cache`.

---

### High Severity

#### 3. Missing `api/bridge.mjs` Reference in Supervisor & Docs
- **Location:** [`tools/supervise-origin.mjs`](file:///C:/anihubstream-local/tools/supervise-origin.mjs#L73) and [`AGENTS.md`](file:///C:/anihubstream-local/AGENTS.md#L9)
- **Issue:** `AGENTS.md` and `tools/supervise-origin.mjs` state that the stream bridge runs via `api/bridge.mjs` on port `8795`. However, `api/bridge.mjs` is missing in the repository (provider extractors are in `api/anikoto.mjs`, `api/hianime.mjs`, etc., and CLI runner is in `api/cli.mjs`). Spawning the supervisor crashes if bridge supervision is enabled:
  ```javascript
  runNodeService({ name: 'Stream Bridge', script: path.join(PROJECT_ROOT, 'api', 'bridge.mjs') });
  ```
- **Remediation:** Either provide `api/bridge.mjs` as the canonical HTTP bridge entry point or update `tools/supervise-origin.mjs` and documentation to reference `api/server.mjs` / `api/cli.mjs`.

#### 4. Hardcoded Machine-Specific Path in `tools/supervise-origin.mjs`
- **Location:** [`tools/supervise-origin.mjs`](file:///C:/anihubstream-local/tools/supervise-origin.mjs#L43-L44)
- **Issue:** Cloudflare tunnel binary and configuration paths are hardcoded to a specific developer's Windows directory:
  ```javascript
  const CLOUDFLARED_EXE = process.env.CLOUDFLARED_EXE || 'C:\\Users\\My\\qoder_scratch\\cloudflared\\cloudflared.exe';
  const TUNNEL_CONFIG = process.env.CLOUDFLARED_CONFIG || 'C:\\Users\\My\\.cloudflared\\config.yml';
  ```
- **Impact:** Fails immediately on any other machine or CI runner unless explicitly overridden with environment variables.
- **Remediation:** Default to PATH lookup (`cloudflared`) and `~/.cloudflared/config.yml` using `os.homedir()`.

#### 5. Database Mutations and Rate-Limit Exposure in GET Handler (`functions/api/play/resolve.js`)
- **Location:** [`functions/api/play/resolve.js`](file:///C:/anihubstream-local/functions/api/play/resolve.js#L236-L264)
- **Violation:** Violates HTTP GET Idempotence and **Rule 1 (System Architecture & Boundaries)**.
- **Issue:** During `GET /api/play/resolve`, if an anime ID is not mapped, the endpoint queries the public Jikan API (`https://api.jikan.moe/v4/anime`) and executes mutations directly into D1:
  ```javascript
  await env.DB.prepare('INSERT OR IGNORE INTO anime_id_map ...').bind(...).run();
  await env.DB.prepare('UPDATE anime SET source_ids = ...').bind(...).run();
  await env.DB.prepare('INSERT OR IGNORE INTO anime_provider_mapping ...').bind(...).run();
  ```
- **Drawbacks:**
  1. The public Jikan API has strict rate limits (3 requests/second). Uncached edge requests trigger HTTP 429 Too Many Requests.
  2. First-result heuristics on title search may map incorrect spinoffs/seasons and permanently persist corrupted mappings into D1.
- **Remediation:** Decouple title resolution into an offline sync tool or queue, and cache Jikan responses in Edge KV/Cache before executing D1 writes.

---

### Medium & Low Severity

#### 6. Bypassing Typed API Helpers in UI Components (`src/pages/Watch.tsx` & `AnimeDetail.tsx`)
- **Location:** [`src/pages/Watch.tsx`](file:///C:/anihubstream-local/src/pages/Watch.tsx#L206) and [`src/pages/AnimeDetail.tsx`](file:///C:/anihubstream-local/src/pages/AnimeDetail.tsx#L41)
- **Violation:** Violates **Rule 8 (Separation of UI, Business Logic, and Persistence)**.
- **Issue:** Both components call direct `fetch('/api/play?id=...')` strings instead of using typed API helper methods from [`src/data/api.ts`](file:///C:/anihubstream-local/src/data/api.ts).
- **Remediation:** Add `fetchPlayMeta(id, ep)` to `src/data/api.ts` and use it within `Watch.tsx` and `AnimeDetail.tsx`.

#### 7. Worker Subrequest and CPU Limits on Large Video Streams (`functions/api/download-pipe.js`)
- **Location:** [`functions/api/download-pipe.js`](file:///C:/anihubstream-local/functions/api/download-pipe.js#L54-L100)
- **Issue:** Downloads complete HLS streams chunk-by-chunk inside a Cloudflare Worker using `TransformStream`. On Cloudflare Pages/Workers free tier, single requests are capped by CPU runtime (50ms) and subrequest counts (50 subrequests). Large 1080p episodes (containing 500+ segments) terminate mid-download with subrequest exhaustion.
- **Remediation:** Offload full video stitching/downloading to client-side Service Worker or a dedicated Node bridge service.

#### 8. Large Bundle Warning for `hls.js` Chunk
- **Location:** Frontend Vite Build Output (`dist-pages/assets/hls-*.js`)
- **Issue:** `hls-DcnIt_wn.js` is bundled at **592.53 kB** (gzip: 185.40 kB), exceeding Vite's 500 kB chunk threshold.
- **Remediation:** Configure `manualChunks` in `vite.config.ts` or dynamically import `Hls` inside `AdvancedPlayer.tsx` only when native HLS is unsupported.

---

## 3. Verification Evidence

All deterministic validation suites were executed against commit `63fe6ab`:

| Verification Gate | Command | Status | Details |
|---|---|---|---|
| **TypeScript & Bundler** | `npm run build` | **PASSED** | 14.51s (Clean TypeScript compile, Vite bundled to `dist-pages/`) |
| **Edge Cache Shield** | `npm run test:cache` | **PASSED** | 5/5 tests passed in 223ms (`functions/api/_lib.js` zero-read contracts) |
| **Unit & Integration Suite**| `npm test` | **PASSED** | 478/478 tests passed across 113 suites in 138.8s |
| **Git Working Tree State** | `git status` | **CLEAN** | Working tree clean on branch `agent-workflow-baseline` |

---

## 4. Known Risks & Production Operational Constraints

1. **Cloudflare D1 Free Tier Quotas:**  
   Public search/filter hits on `/api/anime` will consume read quotas rapidly unless wrapped in `withEdgeCache`.
2. **Third-Party Upstream Drift:**  
   Streaming providers (HiAnime, AniKoto, Gogoanime) frequently alter decryption keys and DOM selectors; fallback chains must remain operational.
3. **Execution Limits for Edge Proxies:**  
   Segment-by-segment streaming in Edge Workers (`download-pipe.js`) is constrained by Cloudflare subrequest limits.
