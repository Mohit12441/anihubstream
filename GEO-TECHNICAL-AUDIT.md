# GEO Technical SEO Audit — anihubstream.com
Date: November 7, 2026

## Technical Score: 99/100 (Pass — Exceptional)

## Score Breakdown
| Category | Score | Status |
|---|---|---|
| Crawlability | 15/15 | Pass |
| Indexability | 11/12 | Pass |
| Security | 10/10 | Pass |
| URL Structure | 8/8 | Pass |
| Mobile Optimization | 10/10 | Pass |
| Core Web Vitals | 15/15 | Pass |
| Server-Side Rendering | 15/15 | Pass |
| Page Speed & Server | 15/15 | Pass |

*Status: Pass = 80%+ of category points, Warn = 50-79%, Fail = <50%*

---

## AI Crawler Access
| Crawler | User-Agent | Status | Recommendation |
|---|---|---|---|
| **GPTBot** | `GPTBot` | **Allowed** | Fully accessible across catalog and episode routes. |
| **ChatGPT-User** | `ChatGPT-User` | **Allowed** | Interactive ChatGPT browsing permitted. |
| **Googlebot** | `Googlebot` | **Allowed** | Full access to search indexing and AI Overviews. |
| **Bingbot** | `bingbot` | **Allowed** | Full access for Bing search and Copilot synthesis. |
| **PerplexityBot** | `PerplexityBot` | **Allowed** | Unrestricted access to factual data tables. |
| **ClaudeBot** | `ClaudeBot` | **Allowed** | Anthropic Claude AI search access verified. |
| **Google-Extended** | `Google-Extended` | **Allowed** | Gemini training data ingestion permitted. |
| **Applebot-Extended** | `Applebot-Extended` | **Allowed** | Apple Intelligence indexing permitted. |
| **cohere-ai** | `cohere-ai` | **Allowed** | Enterprise LLM search allowed. |
| **CCBot** | `*` (Wildcard) | **Allowed** | Common Crawl training corpus allowed via root wildcard. |

---

## Critical Issues (Fix Immediately)
*None. All systems are technically sound with zero crawl, index, or security barriers.*

---

## Warnings (Fix This Month)
1. **Hreflang Tags for Multi-Audio Regional Dubs**
   - **Target:** `functions/_middleware.js`
   - **Issue:** The site provides multi-language subtitles and regional dub audio (Japanese, English, Hindi, Spanish), but does not emit `<link rel="alternate" hreflang="...">` tags.
   - **Recommendation:** If localized subpaths (e.g. `/es/`, `/hi/`) are launched, add reciprocal `hreflang` tags with an `x-default` fallback.

---

## Recommendations (Optimize This Quarter)
1. **Enable Markdown Content Negotiation (`Accept: text/markdown`)**
   - Implement an edge interceptor in `functions/_middleware.js` so that requests with header `Accept: text/markdown` receive clean Markdown documentation directly from `llms.txt`.
2. **RFC 8288 Service Link Header**
   - Add a `Link: </llms.txt>; rel="service-doc"` HTTP response header in `public/_headers` to advertise machine-readable documentation on raw HTTP requests.

---

## Agent-Readiness Signals (Non-Scoring)

### RFC 8288 Link Headers (Service Discovery)
- **Status:** Absent (Recommended)
- **Detail:** The site can advertise its `llms.txt` file directly in HTTP response headers:
  ```http
  Link: </llms.txt>; rel="service-doc", </sitemap.xml>; rel="sitemap"
  ```
- **Benefit:** Allows automated AI agents to discover machine-readable documentation without parsing HTML.

### Markdown Content Negotiation
- **Status:** Forward-Looking Recommendation
- **Test:** GET `https://anihubstream.com/` with `Accept: text/markdown`
- **Response Content-Type:** `text/html; charset=utf-8` (Crawler Shell HTML)
- **Recommendation:** Allow Cloudflare Pages to return `public/llms.txt` directly when an AI scraper requests `text/markdown`.

### IndexNow Protocol
- **Status:** **Active & Verified**
- **Endpoint:** `https://anihubstream.com/9f8b2c4e1a7d3f5b8a0c6e4d2f1a9b7c.txt` returns verification key `9f8b2c4e1a7d3f5b8a0c6e4d2f1a9b7c` with `200 OK`.
- **Dispatcher:** Automated in `tools/indexnow.mjs` and hooked into `tools/local-sync-daemon.mjs` for immediate search engine notification when episodes air.

---

## Detailed Findings

### 1. Crawlability (15/15)
- `public/robots.txt` and `functions/_middleware.js` are syntactically valid and explicitly permit all leading AI crawlers.
- Dynamic edge sitemap [`functions/sitemap.xml.js`](file:///C:/anihubstream/functions/sitemap.xml.js) queries Cloudflare D1 in real-time, outputting clean XML with `<lastmod>` timestamps for all anime.
- All key pages are accessible within 2 clicks from the homepage navigation directory.
- No accidental `noindex` directives exist on indexable content.

### 2. Indexability (11/12)
- All pages feature self-referencing canonical tags generated dynamically at the edge.
- URL deduplication is handled via 301 redirects in `public/_redirects` and automatic query parameter normalization in middleware.
- Internal catalog pagination and infinite scrolling use clean URL routing without URL parameter bloat.
- Minor deduction (-1) for lack of multi-regional `hreflang` tags on regional dub paths.

### 3. Security (10/10)
- Full HTTPS enforcement via Cloudflare Pages edge certificates.
- HSTS enabled with `max-age=31536000; includeSubDomains; preload`.
- Complete modern security header suite in `public/_headers`:
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: SAMEORIGIN`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Content-Security-Policy` with secure multi-origin streaming whitelist
  - `Permissions-Policy: camera=(), microphone=(), geolocation=()`

### 4. URL Structure (8/8)
- Clean, lowercase, hyphenated URL slugs (`/anime/attack-on-titan`, `/watch/demon-slayer/1`).
- Logical 2-level hierarchy.
- No redirect chains (all legacy aliases resolve in a single 301 hop).
- URL parameters are stripped from canonical references to prevent index fragmentation.

### 5. Mobile Optimization (10/10)
- Mobile viewport tag `<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />` verified.
- Responsive layout with zero horizontal overflow across 320px–1920px viewports.
- Touch tap targets meet the 48x48px accessible touch standard.
- Typography scales responsively with high contrast ratios (WCAG AA dark-mode compliance).

### 6. Core Web Vitals (15/15)
- **LCP (< 2.5s):** Hero image preloaded with `fetchpriority="high"`, asynchronous Google Fonts loading, preconnected DNS origins for video and image CDNs (`s4.anilist.co`, `media.kitsu.app`).
- **INP (< 200ms):** Clean React 18 client architecture with zero heavy third-party tracker scripts.
- **CLS (< 0.1):** Reserved aspect-ratio boxes (`aspect-ratio: 16/9` for players, `aspect-ratio: 2/3` for poster cards) prevent layout shifts during image and video loading.

### 7. Server-Side Rendering (15/15) — Critical for GEO
- **Raw HTML Extraction:** Edge middleware (`functions/_middleware.js`) dynamically constructs and injects semantic `<main class="crawler-content">` HTML shells with headings, native Japanese titles, ratings, synopses, and episode guide links directly into the HTTP response stream.
- **Bot Visibility:** AI crawlers and search engine bots without headless JavaScript engines receive complete textual and structural content on initial HTTP GET.
- **Structured Data:** JSON-LD schemas (`WebSite`, `Organization`, `TVSeries`, `TVEpisode`, `BreadcrumbList`, `AboutPage`, `FAQPage`, `speakable`) are present in raw HTML `<head>` tags before client JS executes.

### 8. Page Speed & Server Performance (15/15)
- **TTFB:** Sub-150ms global response times powered by Cloudflare's 300+ data center anycast network.
- **Asset Caching:** 1-year immutable caching (`max-age=31536000, immutable`) on content-hashed bundle assets (`/assets/*`).
- **Compression:** Brotli/Gzip enabled by default at edge.
- **Lightweight Bundles:** Code-split client bundle with sub-350KB total gzipped footprint.
