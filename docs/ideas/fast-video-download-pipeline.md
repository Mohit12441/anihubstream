# Fast Video Download Pipeline: Single-Stream Direct Pipe & Turbo Assembly

## Problem Statement
How Might We deliver instantaneous, high-speed anime episode downloads directly to desktop and mobile devices without multi-minute chunk assembly delays or browser memory crashes?

---

## Recommended Direction: Hybrid Streaming Pipe with Turbo Fallback

We recommend a **Single-Stream Direct Pipe** as the primary download engine, paired with an **In-Browser Turbo Assembler** as an edge fallback:

1. **Primary: Single-Stream Server/Edge Pipe (`GET /api/download/pipe`)**:
   - Instead of forcing the client's JavaScript to fetch 200+ individual segments over single-threaded sequential HTTP requests and hold 350MB+ in browser memory:
   - The user triggers a standard browser download link (`<a href="/api/download/pipe?id=...&ep=...&quality=1080p">`).
   - The server/bridge resolves the master `.m3u8`, parses segment URIs, and streams the binary segments sequentially into a chunked `ReadableStream` response with:
     ```http
     HTTP/1.1 200 OK
     Content-Type: video/mp2t
     Content-Disposition: attachment; filename="Solo_Leveling_EP1_1080p.ts"
     Transfer-Encoding: chunked
     ```
   - **User Experience**: The browser's native download manager immediately pops up in the browser's download shelf. The browser streams bytes straight to disk with zero JavaScript memory overhead, native pause/resume, and maximum single-connection bandwidth.

2. **Secondary / Edge Fallback: Turbo In-Browser Assembler**:
   - For environments where edge subrequest limits exist, the in-browser downloader scales concurrency from 4 to 12 parallel connections, using persistent keep-alive and direct streaming chunk writing, cutting assembly time from ~3 minutes down to 10–18 seconds.

---

## Key Assumptions to Validate
- [ ] **Assumption 1**: Cloudflare Pages / local Miniflare allows streaming a `ReadableStream` of concatenated upstream segments with `Content-Disposition: attachment`.
  - *Validation*: Test a prototype endpoint piping 5 consecutive segments into a single `ReadableStream` and verify browser download manager behavior.
- [ ] **Assumption 2**: Upstream CDNs (MegaPlay / Nexabloom / Dramahot) don't throttle or IP-ban the server when streaming 150-250 segments in rapid succession.
  - *Validation*: Measure latency and throughput when pulling a full episode sequence through the edge proxy with 3-segment lookahead buffering.
- [ ] **Assumption 3**: Standard desktop (Windows Media Player, VLC) and mobile video players (Android, iOS) play the resulting streamed `.ts` file seamlessly.
  - *Validation*: Test playback of full assembled file on Windows Movies & TV, VLC, and mobile player.

---

## MVP Scope

### In Scope
1. **Streaming Endpoint (`functions/api/download/pipe.js`)**:
   - Accepts `id`, `provider`, `ep`, `quality`, and `audio`.
   - Resolves the decrypted master playlist for AniWatch (`_megaplay.js`), HiAnime (`_zoko.js`), or AniKoto.
   - Selects the target rendition (1080p, 720p, 360p).
   - Pipes media segments in order into a continuous `ReadableStream`.
   - Sends `Content-Disposition: attachment; filename="[Anime]_EP[n]_[quality].ts"`.
2. **Turbo Assembler Upgrade (`src/lib/hlsDownloader.ts`)**:
   - Increase concurrency to 8-12 parallel workers.
   - Pre-allocate chunk arrays and optimize buffer transfer.
3. **Modal UI (`src/components/player/DownloadModal.tsx`)**:
   - Primary button: **Direct Browser Download** (triggers `/api/download/pipe`).
   - Secondary button: **In-Browser Assembler** (runs client-side with progress bar).
   - Tertiary button: **Copy Link for IDM / 1DM / VLC**.

### Out of Scope (Not Doing & Why)
- **Heavy Server-Side FFMPEG Transcoding (Edge)**:
  - *Reason*: Cloudflare Workers have a 50ms CPU limit. Real-time re-encoding of H.264 video to MP4 container is computationally prohibitive on Edge. Raw MPEG-2 TS container (`.ts`) is natively supported by all media players with 0ms transcoding delay.
- **Client-Side Heavy WASM FFMPEG**:
  - *Reason*: Loading a 30MB `ffmpeg.wasm` bundle on mobile devices causes 10+ second startup freezes and out-of-memory errors on mid-range phones.
- **Requiring Desktop App Installations**:
  - *Reason*: Defeats the requirement of working seamlessly across mobile (Android/iOS) and desktop browsers with 0 friction.

---

## Open Questions & Next Decisions
1. Do you want the primary "Download" button to trigger the **Single-Stream Direct Pipe** immediately in the browser download shelf, with the in-browser progress bar as an optional advanced fallback?
2. Should we implement the `GET /api/download/pipe` endpoint right now and benchmark its speed against the client-side assembler?
