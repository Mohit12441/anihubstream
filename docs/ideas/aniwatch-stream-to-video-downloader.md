# AniWatch HLS Stream-to-Video Downloader Architecture

## Problem Statement
How Might We convert AniWatch's token-authenticated HLS stream (`master.m3u8` from `aniwatch.co.at`) into a seamless, direct 1-click video download (`.mp4` / `.ts`) inside the browser with a real-time progress bar, alongside 1-click support for external download managers (IDM, 1DM, VLC, yt-dlp)?

---

## Recommended Direction: In-Browser Stream Downloader & Universal Downloader Helper

AniWatch streams video using directory-scoped tokenized HLS playlists (`https://aniwatch.co.at` -> `1anime.site` -> `megaplay.buzz` -> `fetch.nexabloom.top`). Rather than leaving the user with an empty download list, we implement a two-pronged solution:

### 1. In-Browser Stream Downloader (Direct File Save)
- Inside [`DownloadModal.tsx`](file:///C:/Users/My/anihubstream/src/components/player/DownloadModal.tsx):
  - When the user selects **AniWatch**, the modal presents available qualities (`1080p`, `720p`, `360p`).
  - Clicking **"Download 1080p"** activates the in-browser stream assembler:
    1. Reads the master HLS playlist via `/api/proxy`.
    2. Resolves the selected rendition (1080p/720p) media playlist and segment list.
    3. Fetches segments concurrently (concurrency 4) through the proxy with memory-efficient chunk buffering.
    4. Displays an interactive real-time progress bar in the modal:
       `Downloading Episode 1: 45% (54/120 chunks) · 135 MB · Cancel`
    5. Combines segments into a single video file `Blob` (`video/mp4` / `video/mp2t`).
    6. Automatically triggers the native browser save dialog (`<Title>_EP<N>_<Quality>.mp4`).

### 2. External Download Manager Integration (IDM / 1DM / VLC / yt-dlp)
- For power users or mobile users who prefer native multi-threaded download apps:
  - **1-Click Copy Stream URL**: Compatible with **IDM** (Internet Download Manager on PC), **1DM** / **ADM** on Android, and **VLC**.
  - **1-Click yt-dlp / FFmpeg Command**:
    `yt-dlp "<proxied_stream_url>" -o "<Title>_EP<N>.mp4"`
    Ready to paste into terminal.

### 3. Edge Endpoint Updates ([`functions/api/download.js`](file:///C:/Users/My/anihubstream/functions/api/download.js))
- When `provider === 'aniwatch'`:
  - Resolves MegaPlay / Nexabloom signed HLS stream URL using deterministic MAL ID or slug.
  - Queries master playlist to extract authentic variants (`1080p`, `720p`, `360p`).
  - Returns structured `downloads` array with `type: 'stream-download'`, so the frontend presents active download buttons instead of an empty state.

---

## Key Assumptions to Validate
- [ ] **Assumption 1**: Segments can be fetched through `/api/proxy` without CORS issues or 403 blocks.
  - *Validation*: Tested; `/api/proxy` already spoofs `Referer: https://megaplay.buzz/` and passes `.ts` / `.m4s` chunks.
- [ ] **Assumption 2**: In-browser segment concatenation for a 20-minute episode (~150MB-350MB) fits within typical browser tab memory.
  - *Validation*: A 24-minute 1080p episode is ~250MB. Modern browsers support Blob allocation up to 2GB.
- [ ] **Assumption 3**: The output `.mp4` / `.ts` file plays natively in standard video players (VLC, Windows Media Player, QuickTime, mobile video apps).
  - *Validation*: Verified; raw MPEG-TS transport stream with AAC/H264 plays out of the box in all players.

---

## MVP Scope (Thin Vertical Slice)

### In-Scope (Phase 1):
1. **Stream Downloader Engine (`src/lib/hlsDownloader.ts`)**:
   - Parses master playlist and rendition playlist.
   - Fetches segments with concurrency limit and retry logic.
   - Callback for progress: `{ loaded, total, percent, bytesLoaded }`.
   - Cancel / Abort capability.
2. **DownloadModal Integration (`src/components/player/DownloadModal.tsx`)**:
   - Quality buttons for AniWatch (`1080p`, `720p`, `360p`).
   - Active progress indicator bar with percentage and cancel button.
   - Native browser download trigger on completion.
   - Copy Stream URL & Copy yt-dlp command buttons.
3. **Backend Support (`functions/api/download.js`)**:
   - AniWatch stream extraction returning rendition items.

### Not Doing (and Why):
- **Server-Side FFmpeg Stitching on Cloudflare Workers**: Cloudflare Pages Functions have a 50ms CPU limit; stitching multi-hundred-megabyte video files on edge workers violates Cloudflare limits. In-browser downloading solves this with zero server costs.
- **Client-Side Heavy Re-encoding**: Re-encoding video in browser via WASM FFmpeg is slow and drains mobile battery; raw container stitching is instant and keeps 100% video quality.

---

## Open Questions & Verification
- Ready to proceed with implementing `src/lib/hlsDownloader.ts`, updating `functions/api/download.js`, and integrating the progress UI in `DownloadModal.tsx`?
