# HiAnime Isolated API & Performance Benchmark

## Problem Statement
How might we architect and benchmark HiAnime as a fully isolated streaming and catalog subsystem alongside AniKoto — with dedicated endpoints, independent catalog indexing, and sub-second playback startup?

---

## Recommended Direction

We implement **hard decoupling with edge-native fast-path acceleration**:
1. **Dedicated HiAnime Endpoints (`/api/hianime/*`)**:
   Provide clean, self-contained REST routes for HiAnime:
   - `GET /api/hianime/home` — Spotlight and trending carousels sourced strictly from HiAnime.
   - `GET /api/hianime/search?q=:query` — HiAnime catalog search with native IDs, poster art, and audio flags.
   - `GET /api/hianime/anime/:id` — Detail view with HiAnime episode lists (mongo IDs, episode numbers, and audio availability).
   - `GET /api/hianime/play?id=:id&ep=:n&audio=:sub|dub` — Direct HiAnime stream extractor targeting ZokoAnime and MegaPlay embeds.

2. **Catalog Partitioning in Cloudflare D1**:
   Keep HiAnime catalog rows and provider mappings isolated under `provider_id = 'hianime'`. Slugs take the canonical form `hianime:<slug>` to guarantee zero collisions, zero data overwrites, and no cross-provider leakage with AniKoto.

3. **Edge-Direct Zoko Resolution & Manifest Caching**:
   Execute ZokoAnime's base64 + XOR decryption (`otaku-embed-v1`) directly inside Cloudflare Pages Functions (`functions/api/hianime/_zoko.js`). Cache resolved manifests in D1 `stream_cache` with a 20-minute TTL, bringing repeat playback startup time down from ~1,400ms to <30ms.

4. **Automated Benchmark & Diagnostics CLI (`tools/benchmark-hianime.mjs`)**:
   A deterministic test suite measuring:
   - Endpoint TTFB and payload sizing across `home`, `search`, `details`, and `sources`.
   - Host extraction latency: ZokoAnime (`dramahot.top` 1080p/720p/360p) vs MegaPlay (`nexabloom.top` multi-subtitles).
   - Video segment throughput and proxy rewrite integrity.

---

## Key Assumptions to Validate

- [ ] **ZokoAnime Payload Stability**: Zoko embeds continue using the `otaku-embed-v1` XOR key without unannounced cipher rotations.
  - *Validation*: Run automated hourly cipher verification in the test runner.
- [ ] **Edge Compatibility**: Cloudflare Workers environment can fetch `animehot.cc` and embed iframes without encountering Cloudflare Turnstile or IP egress blocks.
  - *Validation*: Benchmark live requests from local Wrangler Pages dev (`127.0.0.1:8899`).
- [ ] **Subtitle Multiplexing on MegaPlay**: When users require non-English subtitles (French, German, Spanish, Arabic), MegaPlay VTT tracks load seamlessly through the proxy.
  - *Validation*: Verify CORS and Content-Type headers on all 9 VTT subtitle tracks.

---

## MVP Scope

### What's In
- **`tools/benchmark-hianime.mjs`**: CLI utility with quantitative latency metrics (mean, p95, error rates) across top 10 anime.
- **`functions/api/hianime/` Route Tree**:
  - `home.js`: HiAnime trending & spotlight.
  - `search.js`: HiAnime title search.
  - `[id].js`: HiAnime media details & episode catalog.
  - `play.js`: Provider-strict playback resolver with 1 ready server.
- **`functions/api/hianime/_zoko.js`**: Edge-native XOR decryptor for ZokoAnime embeds.
- **Provider Isolation Verification Tests**: Automated suite in `api/hianime-isolated.test.mjs` proving zero cross-talk with AniKoto.

### What's Out (Not Doing & Why)
- **Unified Mixed Catalog Search**: *Not doing in this phase.* Mixing HiAnime and AniKoto results causes card duplication and conflicting episode counts; catalogs remain strictly separate.
- **Torrent / Peer-to-Peer Fallback for HiAnime**: *Not doing.* Direct HLS manifests on `dramahot.top` and `nexabloom.top` already deliver full-speed 1080p without P2P complexity.
- **Full Historical Catalog Scrape**: *Not doing.* HiAnime provides an instant dynamic search API (`POST /api/filter` & `animehot.cc/api/anime`); pre-scraping millions of rows is unnecessary and wastes database storage.

---

## Open Questions

1. **Audio Default**: Should the isolated `/api/hianime/play` default to `sub` or `dub` when both are present, or read from user playback preferences? *(Recommendation: Respect `playerPrefs.audio` with fallback to `sub`).*
2. **Embed Fallback Order**: When both ZokoAnime and MegaPlay are returned for an episode, should the resolver always try Zoko first for speed, or inspect requested subtitles first? *(Recommendation: Zoko first for speed unless audio/subtitle demands MegaPlay).*
