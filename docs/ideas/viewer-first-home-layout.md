# Viewer-First Home Page Layout

## Problem Statement
How Might We transform AniHubStream's Home page from a technical multi-provider catalog into a high-retention streaming hub that lets users resume their active shows in 1 click, hides internal provider complexity, and maximizes discovery speed?

## Recommended Direction: Viewer-First Streaming Hub
We select the **Viewer-First Streaming Hub** direction. This architecture prioritizes user playback continuity and clean content discovery over internal scraping mechanics:

1. **Continue Watching Shelf (Priority Tier)**:
   - Positioned immediately below the Hero Banner.
   - Powered by the existing anonymous D1 `position` table and `GET /api/me/positions` endpoint.
   - Each card displays the anime cover, episode number, progress bar (percentage watched), and remaining time.
   - Gracefully hidden when a viewer has no active watch history.

2. **Provider Invisibility (Clean Abstraction)**:
   - Remove the three separate "Live Provider Streams" carousels (`AniKoto`, `HiAnime`, `AniWatch`) from the public home view.
   - Multi-provider failover, HD/HLS stream selection, and audio language choices remain accessible inside the player (`ServerSwitcher` & `PlayerSettings`), where technical decisions actually belong.

3. **Streamlined Discovery Shelves (5 Focused Rows)**:
   - **Hero Spotlight**: Dynamic banner featuring top trending series with instant "Play Ep 1" or "Resume" CTA.
   - **Continue Watching**: Active in-progress episodes with progress indicators.
   - **Trending Now**: Top-ranked titles with rich badges (Sub, Dub, Score, Season).
   - **Airing This Season**: Currently releasing episodes linked to schedules.
   - **Top Rated & Curated Shelves**: Evergreen classics, highest-rated titles, and quick genre filters.

---

## Key Assumptions to Validate
- [ ] `GET /api/me/positions` already returns hydrated anime metadata, runtime seconds, and timestamp (verified in `functions/api/me/positions.js`).
- [ ] Eliminating the 3 duplicate provider carousels reduces DOM node count by ~40% and speeds up initial render on mobile devices.
- [ ] Viewers prefer seeing an anime once on the home page with automated provider fallback rather than choosing between identical posters under different provider names.

---

## MVP Scope
- **Continue Watching Component**: Create `src/components/ContinueWatchingRow.tsx` that fetches `/api/me/positions?limit=10` and renders responsive cards with progress bars. [Completed]
- **Home Layout Restructure**: In `src/pages/Home.tsx`, mount `ContinueWatchingRow` at the top of the content shell, and position provider rows lower as an auxiliary exploration shelf. [Completed]
- **Responsive Layout Polish**: Implemented `src/styles/continue-watching.css` with 16:9 thumbnail ratio, progress track, hover play badge, and 1-click episode resumption. [Completed]

## Execution Results & Verification
- **Compilation Check**: `npx tsc --noEmit` and `npm run build:pages` passed with 0 errors across 1,757 modules.
- **Unit & Regression Tests**: 172/172 tests passed (`node --test api/*.test.mjs`).
- **Positions Endpoint**: Verified live round-trip (`PUT /api/me/positions` -> `GET /api/me/positions`) with HttpOnly viewer cookie; returns saved time, episode number, and hydrated anime metadata in < 10ms.
- **Client Zero-Overhead**: `ContinueWatchingRow` unmounts completely with 0px spacing when no watch history exists, and displays instantly when an episode is in progress.

---

## Not Doing (and Why)
- **Not removing multi-provider support**: We are only hiding the provider brand rows from the home catalog; the multi-provider resolver (`AniKoto`, `HiAnime`, `MegaPlay`, `AniWatch`) remains 100% active inside the playback engine.
- **Not requiring user accounts**: Playback continuity continues to work anonymously via HttpOnly viewer cookies in Cloudflare D1 without login walls.
- **Not auto-playing video trailers on hover**: Heavy bandwidth consumption, unwanted audio interrupts, and unnecessary load on Cloudflare edge workers.

---

## Open Questions & Verification
- How should completed episodes (progress > 90%) behave?
  *Recommendation*: Auto-advance the card to prompt the next episode (`Ep N + 1`).
