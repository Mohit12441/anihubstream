# AniKoto Isolated Provider Architecture

## Problem Statement
How might we establish a symmetric, modular provider architecture across AniHubStream that decouples AniKoto into a dedicated, edge-native micro-catalog (`/api/anikoto/*`) with sub-50ms WebCrypto stream resolution while keeping the unified `/api/*` aggregator fast and resilient?

## Recommended Direction
Adopt the **Unified Provider Pattern** mirroring `functions/api/hianime/`:
- Create an isolated `functions/api/anikoto/` directory with dedicated endpoints (`home.js`, `search.js`, `[id].js`, `play.js`).
- Use pure Edge-native WebCrypto (`crypto.subtle`) for MegaPlay AES-256-CBC decryption and HMAC-SHA256 token signing directly on Cloudflare Pages Functions without external Node dependencies.
- Leverage D1 `stream_cache` with a 20-minute sliding window to deliver <50ms warm hits.
- Use a hybrid metadata model: query indexed D1 `anime_provider_mapping` and `anime_id_map` first (<5ms), falling back to live `anikoto.cz` HTML scraping when a title is missing.

## Key Assumptions to Validate
- [ ] MegaPlay AES keys and HMAC token secret (`MpCdnT0k3n!9f2K#xQ7vL5mR8wN1pY4s`) decrypt live AniKoto streams directly on Cloudflare Edge.
- [ ] D1 indexed lookup resolves AniKoto slugs to MAL IDs in under 10ms.
- [ ] Subtitles and multi-audio (Sub/Dub) streams proxy cleanly via `/api/proxy` without CORS or Referer rejection.

## MVP Scope (Slice 1)
- `functions/api/anikoto/play.js`: Dedicated MegaPlay edge stream resolver with D1 cache.
- `functions/api/anikoto/[id].js`: Anime details + episode list resolver via D1 / anikoto HTML.
- `functions/api/anikoto/search.js`: Fast title search querying D1 `anime_provider_mapping` + fallback.
- `functions/api/anikoto/home.js`: Shelf feeds (Trending, Top Rated, Latest) from D1.
- `functions/api/anikoto/_megaplay.js`: Pure WebCrypto decryptor/signer module.

## Not Doing (and Why)
- **Node.js Bridge Dependency**: No reliance on `api/bridge.mjs` for AniKoto playback — pure edge WebCrypto eliminates cold-start overhead and external hosting constraints.
- **Provider-specific UI rewrites**: The React frontend (`AdvancedPlayer.tsx`, `Watch.tsx`) continues consuming standard server objects `{ id, name, provider, status, streamUrl, type, quality }`, ensuring zero UI component divergence.
- **Bulk SQLite backfills during request handling**: Live scraping only queries and inserts single requested titles, avoiding long-running locks on D1.

## Open Questions
- Does `anikoto.cz` implement Cloudflare turnstile on search queries when accessed from Cloudflare Edge IP ranges? (Mitigated by D1 primary search).
