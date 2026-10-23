# AGENTS.md — AniHubStream Engineering Standards & EAF Protocol

This repository is governed by the Enterprise Agent Framework (EAF) engineering standards. All agents operating within this workspace MUST strictly adhere to these 10 principles and workflow gates.

---

## 1. System Architecture & Boundaries

AniHubStream is a hybrid Edge + Dispatcher streaming architecture:
- **Edge Layer (`functions/api/`)**: Cloudflare Pages Functions running on local Miniflare D1 (`127.0.0.1:8899`). Handles routing, catalog resolution, provider fallback, and caching.
- **Stream Bridge (`api/bridge.mjs`)**: Dedicated Node.js microservice (`127.0.0.1:8795`) for upstream extraction, header spoofing, decrypting streams, and HLS manifest proxying.
- **Frontend SPA (`src/`)**: React + TypeScript + Vite responsive streaming interface (`127.0.0.1:8899`).
- **Offline / Sync Tools (`tools/`)**: Standalone Node.js utilities for scraping, provider mapping, sitemap auditing, and database backfills.

**Strict Boundary Rule**:
- Never merge stream decryption logic into Cloudflare edge workers (which lack full Node streaming primitives).
- Never leak database writes directly to client UI components; all writes must route through verified `/api/` endpoints.

---

## 2. Clear Module Responsibilities
- `functions/api/`: Edge API routes (`/api/anime`, `/api/play`, `/api/search`, `/api/schedule`, `/api/home`).
- `api/`: Local stream bridge extractors (`api/hianime.mjs`, `api/bridge.mjs`).
- `src/components/`: Pure, reusable presentation and interactive components (Player, Sidebar, Cards).
- `src/data/`: Data models (`model.ts`), API clients (`api.ts`), and server configuration (`servers.ts`).
- `src/pages/`: Page routing views (`Home.tsx`, `Watch.tsx`, `Search.tsx`, `AnimeDetail.tsx`).

---

## 3. Consistent API Request and Response Contracts
All API endpoints in `functions/api/` must return a standardized JSON contract:
```typescript
interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
  source?: 'd1' | 'cache' | 'upstream' | 'bridge';
}
```
- Success: `{ ok: true, data: ..., source: ... }` with HTTP 200.
- Failure: `{ ok: false, error: "Descriptive message" }` with appropriate status code (400, 404, 500, 502).
- Caching headers: Edge endpoints must specify appropriate `Cache-Control` (`public, max-age=...`, `s-maxage=...`).

---

## 4. Database Schemas & Data-Access Boundaries
- Primary database: Cloudflare D1 SQLite (`.wrangler/state/v3/d1/miniflare-D1DatabaseObject/`).
- Tables: `anime`, `anime_id_map`, `anime_provider_mapping`, `episodes`, `schedule_cache`, `user_library`, `playback_positions`.
- Invariant: Never use string interpolation for SQL queries. Always use parameterized queries (`prepare(...).bind(...)`).
- Multi-provider mapping: HiAnime (`hianime`), AniKoto (`anikoto`), AniWatch (`aniwatch`) slugs must resolve through `anime_provider_mapping` and `anime_id_map`.

---

## 5. Appropriate Validation & Error Handling
- Validate all incoming parameters (`id`, `ep`, `provider`, `server`, `q`) at the start of every endpoint handler.
- Always implement graceful fallbacks across providers (`anikoto` -> `hianime` -> `aniwatch`).
- Never allow unhandled promise rejections to crash the bridge or dev server.

---

## 6. Secure Authentication & Environment Variables
- Local secrets and environment variables belong strictly in `.dev.vars` or `.env`.
- Never commit access tokens, Cloudflare tokens, or GitHub PATs to code or logs.
- Never deploy to remote Cloudflare or execute `wrangler pages deploy` unless explicitly commanded. All work remains local.

---

## 7. Reusable Frontend Components
- Maintain component modularity: Player controls, server switchers, and episode sidebars must remain decoupled.
- Avoid duplicate state between components; rely on shared context or single-source props.

---

## 8. Separation of UI, Business Logic, and Persistence
- UI components (`src/components/`, `src/pages/`) MUST NOT contain direct DB queries or hardcoded network fetch strings.
- Network operations must route through typed helper functions in `src/data/api.ts`.

---

## 9. Automated Regression Testing & Verification
Before claiming any bug fix or feature complete:
1. Run TypeScript compilation check (`npm run build` or `npx tsc --noEmit`).
2. Verify local server health: `curl -s http://127.0.0.1:8899/api/health`.
3. Test edge endpoints directly against `127.0.0.1:8899` or bridge `127.0.0.1:8795`.
4. Provide tangible output logs as evidence before asserting success.

---

## 10. EAF 7-Phase Workflow & Hard Gate Progression
Whenever executing non-trivial features, refactors, or bug fixes:
1. **DISCOVER**: Map files, schema, and contracts.
2. **RESEARCH**: Identify unknowns and authoritative references.
3. **REASON**: Propose at least 2 solution approaches with tradeoffs.
4. **PLAN**: Architecture approval gate.
5. **IMPLEMENT**: Minimal surgical diffs.
6. **VERIFY**: Deterministic builds and test runs.
7. **REVIEW**: 13-point adversarial review against regressions.
