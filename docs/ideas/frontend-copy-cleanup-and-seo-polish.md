# Frontend Copy Cleanup & Production SEO Polish

## Problem Statement
How Might We eliminate internal developer jargon and architecture leaks across all AniHubStream user-facing pages, replacing awkward backend phrasing ("Federated Search", "stream bridge status", "catalogue database sync", "decoupled 4-layer architecture") with clean, high-converting consumer streaming copy and optimized SEO meta tags for a live production website?

---

## Recommended Direction
Transform AniHubStream from an engineering-prototype voice into a polished, consumer-facing anime streaming platform:

1. **Consumer-Grade Copy Across All UI Layers**:
   - Replace "Federated Anime Search" with "Search Anime".
   - Replace database & bridge status notes in the footer with a clean brand description and standard legal streaming disclaimer.
   - Replace player notifications ("bridge is re-resolving", "caption file could not be fetched through the bridge") with intuitive user notifications ("Switching to {label} audio…", "Unable to load subtitles").
   - Replace developer labels ("read from the catalogue database", "Newest in the Catalogue", "The catalogue service did not answer") with natural consumer language ("Latest Anime Releases", "Explore over {N} anime series", "Unable to load anime").

2. **Full-Spectrum SEO Audit & Optimization**:
   - **`index.html`**: Add targeted meta keywords, refine title and meta descriptions for search queries (free anime, watch anime sub and dub, 1080p HD anime).
   - **Crawler Shell (`index.html`)**: Remove architecture specs ("decoupled 4-layer player architecture") and replace with rich semantic copy focused on viewer features and genres.
   - **Edge Middleware (`functions/_middleware.js`)**: Update dynamic bot SSR meta tags for `/search` and `/anime` from "Federated Multi-Provider" to search-optimized consumer titles.
   - **Pages & Components**: Align `useSEO` titles and descriptions across Home, Search, Catalogue, Genres, Schedule, and Watch pages.

---

## Scope of Changes

| Area | Current Leakage | Production Replacement |
|---|---|---|
| **Footer** | Mentions Kitsu/AniList sync, hourly refresh, AniKoto bridge status | Clean brand mission, copyright, and DMCA disclaimer |
| **Search Page** | "Federated Anime Search", "Federated Multi-Provider" | "Search Anime", "Search thousands of subbed and dubbed anime series and movies" |
| **Index Shell** | "decoupled 4-layer player architecture", "Federated Search" link | High-converting viewer features, clean search link |
| **Player UI** | "Stream quality — resolved by the bridge", "bridge stream is not re-fetched" | "Stream quality", "Playback speed applies immediately" |
| **Subtitles** | "fetched through the bridge", "once this episode resolves through the bridge" | "Loading subtitles…", "Subtitles will appear here when available" |
| **Catalogue / Shelf** | "read from the catalogue database", "Newest in the Catalogue" | "Explore over {N} anime series and movies", "Latest Anime Releases" |
| **Error States** | "This title isn't in the catalogue", "catalogue service did not answer" | "Anime Not Found", "Unable to load anime right now" |
| **About Page** | "Cloudflare D1 SQLite storage", "Title syncs every 30 minutes" | "Next-Generation Streaming Experience", fast global playback |
| **Edge Middleware** | "Federated Multi-Provider Anime Search" | "Search Anime — Watch Subbed & Dubbed Anime Online Free" |

---

## Not Doing (and Why)
- **Do not rename internal code symbols**: Keep TypeScript interfaces and internal filenames (`streamBridge.ts`, `api/bridge.mjs`) untouched. Only user-facing text, DOM attributes, tooltips, toasts, and meta tags are modified.
- **Do not remove data attribution entirely**: Maintain graceful, legal credit to rights holders and community markers without exposing backend cron jobs and sync pipeline scripts.

---

## Key Assumptions to Validate
- [ ] No regression in crawler shell word count or SSR validation (`siteprobe check_ssr`).
- [ ] TypeScript compilation (`npx tsc --noEmit`) passes cleanly with zero errors.
- [ ] Production Vite build and Pages build pass.
- [ ] All 201 automated unit tests pass.
