# Catalog-Strict Single Streaming Server Architecture

## Problem Statement
How Might We eliminate redundant multi-provider server bloat and latency by binding playback strictly to the anime's catalog-mapped primary provider, serving and displaying a single, instant, zero-confusion streaming server?

---

## Recommended Direction
**Catalog-Strict Single Server Architecture with Silent Edge Fallback:**
1. **Edge Scoping ([`functions/api/play.js`](file:///C:/Users/My/anihubstream/functions/api/play.js))**:
   - Determine the anime's authoritative primary provider from `anime_provider_mapping` or `anime_id_map` (e.g. `anikoto` with confidence 1.0).
   - Stop multi-provider fanning: Only resolve streams from the designated catalog provider. Do not generate or return servers from unrelated providers (e.g., if mapped to AniKoto, do not query or append HiAnime servers).
   - Return strictly the single best ready server matching the user's audio preference (`sub` / `dub`), with 0 redundant duplicates.
2. **Frontend Simplification ([`ServerSwitcher.tsx`](file:///C:/Users/My/anihubstream/src/components/player/ServerSwitcher.tsx) & [`AdvancedPlayer.tsx`](file:///C:/Users/My/anihubstream/src/components/player/AdvancedPlayer.tsx))**:
   - Replace the 5-card server grid and provider tabs with a streamlined, high-performance status bar: single active server indicator (`⚡ AniKoto · HD-1 · 1080p`).
   - If a stream experiences a fatal error, the player transparently triggers backup server resolution in the background without requiring user micro-management.

---

## Key Assumptions to Validate
- [ ] **Catalog Provider Reliability**: The mapped provider (`anikoto` or `hianime`) has >99% stream uptime so users rarely need manual server hopping.
  - *Validation*: Monitor error telemetry on `/api/play` and player error callbacks.
- [ ] **Sub/Dub Parity**: The primary provider provides both sub and dub tracks, or the catalog provider mapping accounts for dub availability (`dub_available` flag in `anime_provider_mapping`).
  - *Validation*: Verify that switching audio (`sub` <-> `dub`) continues to work seamlessly within the primary provider.
- [ ] **Player Fallback Safety**: If the single primary server URL 403s or fails, player error handler can trigger a fallback resolution.
  - *Validation*: Simulate server failure and confirm smooth recovery.

---

## MVP Scope

### In Scope
- **Backend (`functions/api/play.js`)**:
  - Check `anime_provider_mapping` / `anime_id_map` for the canonical provider.
  - Filter `servers` payload to return strictly 1 primary ready server for the active audio mode (`sub` or `dub`).
  - Remove generation of default cross-provider fallback arrays when the primary provider resolves successfully.
- **Frontend (`src/components/player/ServerSwitcher.tsx`)**:
  - When 1 server is active, present a clean, compact server badge with status indicator (`Ready · 1080p`) instead of 5 multi-server tiles.
  - Hide multi-provider tabs ("All", "AniKoto", "HiAnime") when an anime is locked to its catalog provider.
  - Keep audio track switching (`sub` / `dub`) instant and uncluttered.

### Out of Scope (Not Doing & Why)
- **Not Doing Manual 5-Server Matrix**: Do not show duplicate servers (HD-1, HD-2, Vidstream-1, Vidstream-2) that point to identical CDNs.
- **Not Doing Cross-Provider Probing on Initial Load**: Do not probe both AniKoto and HiAnime simultaneously on page load; only probe secondary providers if the primary provider fails.
- **Not Doing Complex User-Facing CDN Selectors**: Users want to watch anime with zero friction, not debug CDN endpoints.

---

## Open Questions & Next Steps
- When the user confirms this refined plan, we will surgically apply the catalog-strict scoping to `functions/api/play.js` and streamline `ServerSwitcher.tsx`.
