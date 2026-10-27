# Federated Search & Provider-First Playback Full Architecture Implementation Plan

> **Status:** Implementation Complete & Verified. (Layer 3 player component implemented as `AdvancedPlayer.tsx`).

**Goal:** Implement the complete end-to-end Federated Search + Provider-First Playback architecture with pluggable provider adapters, federated search fan-out, lazy server stream resolution, edge m3u8 proxy, 4-layer decoupled Universal Player, and ServerSwitcher with AniSkip integration.

**Architecture:**
- **Edge & Backend Layer**:
  - `functions/api/play/resolve.js`: Lazy server resolution endpoint (`GET /api/play/resolve?title=...&ep=...&audio=...&provider=...&server=...`).
  - `functions/api/search.js`: Edge federated search endpoint fanning out to providers in parallel and returning grouped results per provider.
  - `functions/api/proxy.js`: Universal m3u8 playlist & segment proxy edge handler with Referer/Origin rewriting and CORS headers.
  - `schema.sql`: Ensure `anime_id_map` has `confidence` column and `stream_cache`/`anime_provider_mapping` tables.
- **Frontend Layer**:
  - `src/components/player/PlayerInput.ts` (Layer 2): Deterministic TypeScript mapper converting backend server JSON to clean `PlayerInput`.
  - `src/components/player/AdvancedPlayer.tsx` (Layer 3): HLS.js + progressive player component with clean source swapping, timestamp persistence, error cascades, and zero third-party knowledge.
  - `src/components/player/ServerSwitcher.tsx` (Layer 4): Multi-server switcher with status badges (`loading...` -> `ready ✅`) and lazy resolution.
  - `src/components/player/AniSkipButton.tsx` (Layer 4): Floating Skip Intro & Skip Ending buttons synced with playhead.
  - `src/pages/Search.tsx` & routing: Federated search results page grouped by provider.

**Tech Stack:** React 18, TypeScript 5, Vite 5, HLS.js, Cloudflare Pages Functions (Edge Workers), SQLite/D1, Node.js HTTP Stream Bridge.

## Global Constraints
- Frontend NEVER communicates directly with third-party providers; all traffic flows through our backend.
- Provider layer is completely decoupled via adapters.
- All existing unit tests must continue to pass with 0 regressions.
- Strict TypeScript type-checking with 0 errors (`npm run typecheck`).
- Production Cloudflare Pages build must succeed (`npm run build:pages`).

---

## Tasks

### Task 1: Layer 2 Player Input Adapter (`PlayerInput.ts`)
- [x] Define `PlayerInput`, `SubtitleTrack`, `AudioTrack`, `SkipInterval`, and `PlayServer` interfaces in `src/components/player/PlayerInput.ts`.
- [x] Implement `toPlayerInput(server, aniskip, position)` deterministic mapper.
- [x] Write hermetic unit tests in `src/components/player/PlayerInput.test.ts` or `api/playerInput.test.mjs`.

### Task 2: Layer 3 Universal Video Player Component (`AdvancedPlayer.tsx`)
- [x] Implement `AdvancedPlayer.tsx` supporting HLS (via `hls.js`) and direct MP4/MKV.
- [x] Implement smooth source swapping: `hls.stopLoad()` -> `hls.loadSource()` -> restore `currentTime`.
- [x] Implement subtitle track loading and audio track selection.
- [x] Implement automatic fallback cascade when `Hls.Events.ERROR` occurs.
- [x] Emit standardized player events (`onTimeUpdate`, `onDuration`, `onEnded`, `onError`).

### Task 3: Layer 4 Server Switcher & Floating AniSkip Button
- [x] Create `src/components/player/ServerSwitcher.tsx` with server list, provider badges, and lazy status indicator.
- [x] Create `src/components/player/AniSkipButton.tsx` displaying floating "Skip Intro" / "Skip Ending" buttons when playhead enters interval.

### Task 4: Backend Lazy Server Resolution & M3U8 Proxy Edge Handlers
- [x] Create `functions/api/play/resolve.js` for lazy resolution of secondary servers.
- [x] Create `functions/api/proxy.js` edge handler for proxying `.m3u8` playlists and rewriting child segment/key URLs.
- [x] Update `schema.sql` `anime_id_map` to include `confidence` REAL DEFAULT 1.0.

### Task 5: Federated Search Edge Endpoint & Frontend Search Page
- [x] Create `functions/api/search.js` fanning out queries to providers in parallel (4s timeout) and returning grouped provider results.
- [x] Create `src/pages/Search.tsx` rendering grouped results by provider with direct link to `/watch/:id`.
- [x] Register `/search` route in `src/App.tsx`.

### Task 6: Watch Page Orchestration Integration & Verification
- [x] Wire `ServerSwitcher` and `AniSkipButton` into `src/pages/Watch.tsx`.
- [x] Implement lazy background resolution of alternate servers when episode loads.
- [x] Run full test suite (`npm test`), type check (`npm run typecheck`), and production build (`npm run build:pages`).
