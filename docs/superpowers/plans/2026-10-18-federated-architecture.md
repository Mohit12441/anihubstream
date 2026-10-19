# Federated Search & Provider-First Playback Full Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the complete end-to-end Federated Search + Provider-First Playback architecture with pluggable provider adapters, federated search fan-out, lazy server stream resolution, edge m3u8 proxy, 4-layer decoupled UniversalPlayer, and ServerSwitcher with AniSkip integration.

**Architecture:**
- **Edge & Backend Layer**:
  - `functions/api/play/resolve.js`: Lazy server resolution endpoint (`GET /api/play/resolve?title=...&ep=...&audio=...&provider=...&server=...`).
  - `functions/api/search.js`: Edge federated search endpoint fanning out to providers in parallel and returning grouped results per provider.
  - `functions/api/proxy.js`: Universal m3u8 playlist & segment proxy edge handler with Referer/Origin rewriting and CORS headers.
  - `schema.sql`: Ensure `anime_id_map` has `confidence` column.
- **Frontend Layer**:
  - `src/components/player/PlayerInput.ts` (Layer 2): Deterministic TypeScript mapper converting backend server JSON to clean `PlayerInput`.
  - `src/components/player/UniversalPlayer.tsx` (Layer 3): Vidstack/HLS.js player component with clean source swapping, timestamp persistence, error cascades, and zero third-party knowledge.
  - `src/components/player/ServerSwitcher.tsx` (Layer 4): Multi-server switcher with status badges (`loading...` -> `ready ✅`) and lazy resolution.
  - `src/components/player/AniSkipButton.tsx` (Layer 4): Floating Skip Intro & Skip Ending buttons synced with playhead.
  - `src/pages/Search.tsx` & routing: Federated search results page grouped by provider.

**Tech Stack:** React 18, TypeScript 5, Vite 5, HLS.js, Cloudflare Pages Functions (Edge Workers), SQLite/D1, Node.js HTTP Stream Bridge.

## Global Constraints
- Frontend NEVER communicates directly with third-party providers; all traffic flows through our backend.
- Provider layer is completely decoupled via adapters.
- All existing 412 unit tests must continue to pass with 0 regressions.
- Strict TypeScript type-checking with 0 errors (`npm run typecheck`).
- Production Cloudflare Pages build must succeed (`npm run build:pages`).

---

## Tasks

### Task 1: Layer 2 Player Input Adapter (`PlayerInput.ts`)
- [ ] Define `PlayerInput`, `SubtitleTrack`, `AudioTrack`, `SkipInterval`, and `PlayServer` interfaces in `src/components/player/PlayerInput.ts`.
- [ ] Implement `toPlayerInput(server, aniskip, position)` deterministic mapper.
- [ ] Write hermetic unit tests in `src/components/player/PlayerInput.test.ts` or `api/playerInput.test.mjs`.

### Task 2: Layer 3 Universal Video Player Component (`UniversalPlayer.tsx`)
- [ ] Implement `UniversalPlayer.tsx` supporting HLS (via `hls.js`) and direct MP4/MKV.
- [ ] Implement smooth source swapping: `hls.stopLoad()` -> `hls.loadSource()` -> restore `currentTime`.
- [ ] Implement subtitle track loading and audio track selection.
- [ ] Implement automatic fallback cascade when `Hls.Events.ERROR` occurs.
- [ ] Emit standardized player events (`onTimeUpdate`, `onDuration`, `onEnded`, `onError`).

### Task 3: Layer 4 Server Switcher & Floating AniSkip Button
- [ ] Create `src/components/player/ServerSwitcher.tsx` with server list, provider badges, and lazy status indicator.
- [ ] Create `src/components/player/AniSkipButton.tsx` displaying floating "Skip Intro" / "Skip Ending" buttons when playhead enters interval.

### Task 4: Backend Lazy Server Resolution & M3U8 Proxy Edge Handlers
- [ ] Create `functions/api/play/resolve.js` for lazy resolution of secondary servers.
- [ ] Create `functions/api/proxy.js` edge handler for proxying `.m3u8` playlists and rewriting child segment/key URLs.
- [ ] Update `schema.sql` `anime_id_map` to include `confidence` REAL DEFAULT 1.0.

### Task 5: Federated Search Edge Endpoint & Frontend Search Page
- [ ] Create `functions/api/search.js` fanning out queries to providers in parallel (4s timeout) and returning `{ query, count, providers: { anikoto: [], hianime: [], aniwatch: [], animedubhindi: [], watchanimeworld: [] } }`.
- [ ] Create `src/pages/Search.tsx` rendering grouped results by provider with direct link to `/watch/:id`.
- [ ] Register `/search` route in `src/App.tsx`.

### Task 6: Watch Page Orchestration Integration & Verification
- [ ] Wire `ServerSwitcher` and `AniSkipButton` into `src/pages/Watch.tsx`.
- [ ] Implement lazy background resolution of alternate servers when episode loads.
- [ ] Run full test suite (`npm test`), type check (`npm run typecheck`), and production build (`npm run build:pages`).
