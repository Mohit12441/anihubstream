# Google Search Console (GSC) Integration & Telemetry Architecture

## Problem Statement
How might we integrate Google Search Console telemetry into AniHubStream so that we can inspect live URL indexing status, crawl errors, click impressions, search queries, and sitemap coverage for `https://anihubstream.pages.dev` directly within the assistant environment?

---

## Recommended Direction

### 1. Zero-Friction Service Account Authentication
Google Search Console provides two official APIs:
1. **Search Analytics API (`/webmasters/v3/sites/.../searchAnalytics/query`)**: Clicks, impressions, CTR, rankings, top queries, and landing pages.
2. **URL Inspection API (`/v1/urlInspection/index:inspect`)**: Real-time Googlebot crawl status, canonical URL verification, indexing verdict, robots.txt status, and mobile friendliness.

Using a **Google Cloud Service Account** with a downloaded private key (`gsc-key.json`) allows completely headless, autonomous querying without requiring interactive browser OAuth logins every session.

### 2. Dual Access Architecture: Native CLI Tool + MCP Server
- **Layer 1: Native In-Tree Tool (`tools/gsc-telemetry.mjs`)**:
  A zero-dependency Node.js script using Google's JWT REST auth that queries URL inspection and analytics directly. Can be run instantly via `npm run gsc:status` or `node tools/gsc-telemetry.mjs --url=https://anihubstream.pages.dev/anime/attack-on-titan`.
- **Layer 2: Antigravity MCP Server (`mcp-gsc`)**:
  Registers custom tools (`gsc_inspect_url`, `gsc_query_analytics`, `gsc_list_sitemaps`) so the AI assistant can check site status conversationally on demand.

---

## Step-by-Step Setup Guide

### Step 1: Create a Google Cloud Project & Enable API
1. Open the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project (e.g., `anihubstream-seo`).
3. Navigate to **APIs & Services → Library**.
4. Search for **Google Search Console API** and click **Enable**.

### Step 2: Create a Service Account & Download Key
1. Go to **APIs & Services → Credentials**.
2. Click **Create Credentials → Service Account**.
3. Name the service account (e.g., `anihubstream-gsc-reader`).
4. Click **Create and Continue**, skip role assignments (GSC manages permissions inside Search Console itself), and click **Done**.
5. Click on the created service account email (e.g. `anihubstream-gsc-reader@anihubstream-seo.iam.gserviceaccount.com`).
6. Navigate to the **Keys** tab → **Add Key → Create new key**.
7. Select **JSON** and download the file.
8. Save this file locally in a secure location (e.g. `C:\Users\My\.secrets\gsc-key.json` or `.gsc-key.json` added to `.gitignore`).

### Step 3: Grant Access in Google Search Console
1. Open [Google Search Console](https://search.google.com/search-console).
2. Select your property: `https://anihubstream.pages.dev` (or URL prefix/Domain property).
3. In the left sidebar, click **Settings** (⚙️) → **Users and permissions**.
4. Click **Add user**.
5. Paste your Service Account email:
   `anihubstream-gsc-reader@<project-id>.iam.gserviceaccount.com`
6. Set Permission to **Full** (or **Restricted** for read-only analytics & URL inspection).
7. Click **Add**.

---

## MVP Scope

### Phase 1: In-Tree GSC Inspector (`tools/gsc-telemetry.mjs`)
- Authenticate via Google OAuth2 Service Account JWT without heavy external dependencies.
- Command: `node tools/gsc-telemetry.mjs --inspect <url>` to check index status.
- Command: `node tools/gsc-telemetry.mjs --analytics --days 28` to view top queries, impressions, and CTR.

### Phase 2: SiteProbe Pre-Crawl Auditing
- Leverage the existing `siteprobe` MCP server already installed in Antigravity to audit SSR rendering, meta tags, and crawler readability on `https://anihubstream.pages.dev` before submitting to Google.

### Phase 3: Headless MCP Registration
- Configure `@modelcontextprotocol/server-google-search-console` or custom tool definitions in Antigravity MCP directory.

---

## Key Assumptions to Validate
- [ ] Property `https://anihubstream.pages.dev` is already added and verified in Google Search Console under your Google account.
- [ ] Cloudflare Pages headers (`robots.txt`, `x-robots-tag`) allow Googlebot indexing on production.
- [ ] Service account has been added under **Settings → Users and permissions** in GSC.

---

## Not Doing (and Why)
- **Not Doing User-Interactive OAuth 2.0**: Requires running local web servers for OAuth callback redirects and frequent token re-authentication; Service Account JSON keys are permanent and automated.
- **Not Committing Service Account Keys to Git**: The `.gsc-key.json` file must strictly reside in `.gitignore` or local secrets directory.
- **Not Doing Bulk Indexing API spam**: Google Indexing API is strictly reserved for JobPosting and BroadcastEvent metadata; using it for bulk anime pages risks algorithmic penalties. Standard Search Console Sitemap submission is the approved Google standard.
