# Provider Download Availability & Smart Error Recovery

## Problem Statement
How Might We clearly communicate provider catalog availability and guide users when an anime episode cannot be downloaded from a specific provider, without dead ends or broken links?

---

## Recommended Direction: Smart Error Card with 1-Click Provider Switcher

When a user selects a provider tab (AniKoto, HiAnime, AniWatch, or WatchAnimeWorld) and that provider has no verified video streams or mirrors for the requested episode:

1. **Strict Backend Availability Contract (`functions/api/download.js`)**:
   - Never fabricate dummy fallback streams pointing to HTML pages or dead ends.
   - If a provider has no genuine stream or mirror, return `downloads: []`, `available: false`, and an explicit diagnostic error message.
   - Return `availableProviders: string[]` indicating which providers actually map to this anime title in D1.

2. **Frontend Smart Error Card (`src/components/player/DownloadModal.tsx`)**:
   - Replaces the generic empty box with a high-visibility, informative Error Card:
     - Warning/Alert iconography (`AlertTriangle` / `ShieldAlert`).
     - Header: `Episode [N] is not available on [Provider]`.
     - Context: `"[Title]" does not currently have verified download streams on this provider.`
     - **1-Click Recovery Action**:
       - Automatically detects if another provider in `availableProviders` has active sources (e.g., switches from AniWatch to AniKoto or HiAnime).
       - Renders a prominent primary button: `Switch to [Other Provider] (Available)`.
       - Clicking the button instantly switches tabs, fetches sources, and displays the ready download options.

---

## Key Assumptions to Validate
- [ ] **Assumption 1**: D1's `anime_provider_mapping` and `anime_id_map` reliably identify which other providers have mappings for the anime.
- [ ] **Assumption 2**: A user encountering a missing episode on one provider prefers switching to an alternate provider with 1 click over leaving the site.
- [ ] **Assumption 3**: The error state does not show broken yt-dlp commands or empty copy buttons.

---

## MVP Scope

### In Scope
- Remove all dummy fallback items from `functions/api/download.js` when streams do not resolve.
- Return `available: false` and `message` in `/api/download` when `downloads.length === 0`.
- Design and implement the Smart Error Card in `src/components/player/DownloadModal.tsx`.
- Provide the 1-click provider switcher button inside the error state.
- Suppress stream URL copy & yt-dlp buttons when `downloads.length === 0`.

### Out of Scope
- Guessing or inventing torrents/external links from unverified scrapers.
- Auto-redirecting without user consent (users should see why the provider failed and click to switch).

---

## Open Questions & Next Steps
- Ready to implement immediately across backend and frontend.
