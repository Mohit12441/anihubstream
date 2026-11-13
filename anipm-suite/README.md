# AniPM / Ume.to / Ani.nz — Full Reverse Engineering & API Specification

Comprehensive reverse-engineering report and client test suite for **AniPM**, its active SPA mirror **Ume.to**, the legacy domain **Ani.nz**, the video delivery engine **Settlar**, and the direct HLS CDN **Beta Cno.to**.

---

## 1. Network Topology & Domain Roles

| Domain | Role | Cloudflare Status | Primary Protocols |
| :--- | :--- | :--- | :--- |
| **`https://ani.pm`** | Primary backend API, embed host, and nonce generator | HTTP 200 (Open API) | REST, Embed HTML (`/embed/ani/...`) |
| **`https://ume.to`** | Modern React SPA mirror of ani.pm | HTTP 200 (Zero WAF on API) | REST via `/ani-api/...`, Vite bundle |
| **`https://ani.nz`** | Legacy domain | HTTP 403 (Cloudflare Turnstile) | Replaced by `ume.to` / `ani.pm` |
| **`https://embed.settlar.io`** | Settlar video player iframe & session exchange | HTTP 403 on direct curl, 200 inside iframe | Session exchange API (`/api/embed/session?t=...`) |
| **`https://media.settlar.io`** | Settlar HLS master playlists and `.ts` video chunks | 200 inside iframe / browser with session token | HLS (m3u8, MPEG-TS chunks) |
| **`https://beta.cno.to`** | Direct raw HLS video server | HTTP 200 / Token authenticated | HLS multi-audio master playlists |

---

## 2. API Endpoints

All endpoints on `https://ume.to` are prefixed with `/ani-api/` and appended with `k=1`:

### 1. Catalog Search
```http
GET https://ume.to/ani-api/anime/search?q={query}&k=1
```
- **Returns:** List of matching anime with `id`, `source` (`"settlar"` or `"anilist"`), `slug`, `title`, `poster`, and `score`.

### 2. Series & Episode Listing
```http
GET https://ume.to/ani-api/partner/v1/series/{anilistId}?adult=1&k=1
```
- **Returns:** Complete episode list with runtime, aired date, and embed URLs:
  - `embed.sub`: `https://ani.pm/embed/ani/{anilistId}/{episodeNumber}/sub`
  - `embed.dub`: `https://ani.pm/embed/ani/{anilistId}/{episodeNumber}/dub`
  - `available`: `{ sub: true, dub: true, subHard: true, dubHard: true }`

### 3. Beta Server & Multi-Audio Track Matrix
```http
GET https://ani.pm/api/anime/beta-server/{anilistId}
```
- **Returns:**
  - `origin`: `"https://beta.cno.to"`
  - `audio`: List of available audio languages: `["eng", "hin", "jpn", "mal", "tam"]`
  - `subs`: List of available subtitle languages: `["eng"]`
  - `episodeLangs.runs`: Exact range of episodes with regional dubs (e.g., Hindi, Tamil, Malayalam).

### 4. Quality Ladder API
```http
GET https://ani.pm/api/anime/beta-server/{anilistId}/qualities?ep={episodeNumber}
```
- **Returns:**
  - `heights`: `[1080, 720, 480, 360, 240]`
  - `rungs`: Bitrate per quality level (e.g., 1080p at 1617 kbps).

### 5. Player Nonce & Partner Session Token
1. **Fetch Embed HTML:**
   ```http
   GET https://ani.pm/embed/ani/{anilistId}/{episodeNumber}/{sub|dub}
   ```
   Extract nonce from:
   ```html
   <script id="anipm-embed-config">{"v":1,"nonce":"...","playerOrigin":"https://embed.settlar.io"}</script>
   ```
2. **Obtain Session Token:**
   ```http
   GET https://ani.pm/api/partner/v1/session?n={nonce}&id={anilistId}&ep={ep}&lang={sub|dub}&adult=1
   ```
   Returns `embedUrl` and signed partner `token`.

---

## 3. Cryptographic API Protocol (Octet-Stream Decryption)

When `Content-Type: application/octet-stream` is returned by ani.pm, the payload is encrypted with AES-GCM and compressed with Deflate:

1. **Master Key Derivation (HKDF SHA-256):**
   ```javascript
   const SEED_CHUNKS = ['1230f6e600d3f093', '6630aef67a5caefd', '4ddb8f6ce317f3d5', '8b904c8f68d1160b'];
   // Reverse each 16-hex string, concatenate, and parse as 32-byte Uint8Array
   // Derive AES-GCM 256-bit key using HKDF with info = "api-seal|v1"
   ```
2. **Payload Structure:**
   - Byte `0`: Version header (must equal `1`)
   - Bytes `1` to `12`: 12-byte Initialization Vector (IV)
   - Bytes `13` to End: AES-GCM Ciphertext + Auth Tag
3. **Decompression:**
   - The decrypted plaintext is piped through `DecompressionStream('deflate')`.
   - The resulting text is parsed as JSON.

---

## 4. Player Architecture & Communication Protocol

The web player on `ume.to` and `ani.pm` uses an isolated `<iframe>` element pointing to Settlar:

```html
<iframe
  src="https://ani.pm/embed/ani/{anilistId}/{ep}/{sub|dub}?api=1&adult=0&autoplay=1&autonext=1&autoskip=0&theater=0"
  title="Episode {ep} — Settlar"
  allow="autoplay; fullscreen; picture-in-picture; encrypted-media; screen-wake-lock"
  allowfullscreen
  referrerpolicy="strict-origin-when-cross-origin">
</iframe>
```

### postMessage Protocol:
- **Parent to Iframe:**
  - `hello` — handshake initiation
  - `getState` — queries player time, duration, pause state, audio, quality
  - `play` / `pause` / `seek`
  - `setQuality` — switches resolution (`1080p`, `720p`, etc.)
  - `setAudio` — switches language track (`jpn`, `eng`, `hin`, `tam`, `mal`)
- **Iframe to Parent:**
  - `data-player-loaded` — player initialized
  - `timeupdate` — `{ position, duration }`
  - `state` — playback state (`playing`, `paused`, `buffering`)
  - `qualityChange` / `audioChange`

---

## 5. How to Run the Test Suite

```bash
cd github
node anipm-suite/test-all.mjs
```

### Verified Test Outputs:
- **Test 1:** HKDF API-Seal Key derivation (AES-GCM 256-bit).
- **Test 2:** Search API (`Solo Leveling`, `Naruto`).
- **Test 3:** Episode catalogue and embed URL generation.
- **Test 4:** Beta multi-audio stream mapping (`["eng", "hin", "jpn", "mal", "tam"]`).
- **Test 5:** Quality ladder resolution (`[1080, 720, 480, 360, 240]`).
- **Test 6:** Live Nonce extraction and Settlar token signing.
- **Test 7:** Cross-domain topology and HTTP status check.
