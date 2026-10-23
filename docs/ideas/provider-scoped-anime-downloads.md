# Provider-Scoped Anime Video Download Architecture

## Problem Statement
How Might We deliver an authentic, provider-locked episode download experience on the Watch page that exclusively serves verified download links (direct MP4/MKV, mirrors, or download portals) matching the user's active provider (AniKoto, HiAnime, WatchAnimeWorld, AniWatch) with zero cross-provider pollution?

---

## Recommended Direction: Provider-Locked Dynamic Downloads

1. **Provider-Aware Download Modal (`DownloadModal.tsx`)**:
   - The modal automatically locks to the active anime provider (e.g. if watching via **AniKoto**, the modal exclusively queries and displays **AniKoto** downloads).
   - Includes a sleek **Provider Tab Switcher** (AniKoto, HiAnime, WatchAnimeWorld, AniWatch) allowing users to switch providers if the anime is multi-mapped in `anime_provider_mapping`.
   - Prevents the confusing bug where clicking an AniKoto title displayed mismatched or broken download links from other unrelated scrapers.

2. **Dedicated Cloudflare Edge Endpoint (`/api/download`)**:
   - `GET /api/download?provider=:provider&id=:id&ep=:ep&audio=:audio`
   - Resolves provider-specific downloads cleanly server-side without CORS or token leakage:
     - **AniKoto (`anikoto`)**:
       - Queries `mapper.nekostream.site` via MAL ID to retrieve direct mirror downloads (Pahe, NekoStream) in 1080p, 720p, and 360p.
       - Returns direct MP4 download links and HLS stream link for IDM/VLC.
     - **HiAnime (`hianime`)**:
       - Executes token-authenticated handshake against `zokoanime.video/api/downloads/token/...`.
       - Returns direct multi-quality MP4 downloads (1080p, 720p, 480p, 360p) and web download portal URL fallback.
     - **WatchAnimeWorld (`watchanimeworld`)**:
       - Extracts progressive direct MP4 files with multi-audio selection (Hindi Dub, English Dub, Japanese Sub).
     - **AniWatch (`aniwatch`)**:
       - Generates authenticated MegaPlay master stream URL with token signing and download portal.

3. **User Experience & Direct Browser Download**:
   - For direct files (MP4/MKV), clicking "Download" triggers the native browser save dialog (`Content-Disposition: attachment` or `<a download>`).
   - For stream links, provides 1-click **Copy URL for Download Managers** (IDM, 1DM, VLC, aria2).
   - If direct CDN links are expired or rate-limited, offers 1-click **Open Web Portal** in a new tab.

---

## Key Assumptions to Validate
- [ ] **Assumption 1**: `mapper.nekostream.site` consistently returns download mirrors for AniKoto mapped MAL IDs.
  - *Validation*: Test with top 5 popular anime titles (e.g. Solo Leveling, Demon Slayer, Frieren).
- [ ] **Assumption 2**: `zokoanime.video` download tokens can be fetched cleanly from Cloudflare Workers without Cloudflare Turnstile blocks.
  - *Validation*: Test edge fetch with realistic User-Agent and referer headers.
- [ ] **Assumption 3**: WatchAnimeWorld provides direct progressive MP4 download parts for titles with Hindi/multi-audio dubs.
  - *Validation*: Verify with Naruto or Dragon Ball multi-audio entries.

---

## MVP Scope (Thin Vertical Slice)

### In-Scope (Phase 1):
1. **Edge Route `functions/api/download.js`**:
   - Single unified endpoint accepting `provider`, `id` (or `title`), `ep`, `audio`.
   - Dispatches to provider-specific extractor (`extractAnikotoDownloads`, `extractHianimeDownloads`, `extractWawDownloads`).
   - Caches responses in D1 (`stream_cache`) with 20-minute TTL to ensure fast repeat requests.
2. **Refactored `DownloadModal.tsx`**:
   - Pass `activeProvider` from `Watch.tsx`.
   - Display active provider banner with provider badge and color.
   - Provider tab switcher when title is available on multiple providers.
   - Clean download quality grid (1080p, 720p, 480p, 360p) with direct download action.
3. **1-Click Copy & Portal Fallback**:
   - Secondary action to copy stream link for external download tools (VLC/IDM).

### Not Doing (and Why):
- **Server-Side FFmpeg Transcoding/Merging on Edge Workers**: Cloudflare Pages Functions have CPU limits of 50ms (or 30s in Node); transcode/merging multi-GB files on Workers is not possible and violates Edge rules. Direct provider MP4s and HLS playlists are served instead.
- **Bulk Entire-Season Zip Download**: Generating multi-gigabyte ZIP archives would exhaust memory and bandwidth. Downloads operate episode-by-episode.

---

## Open Questions & Verification
- Ready to proceed with implementing `functions/api/download.js` and updating `DownloadModal.tsx`?
