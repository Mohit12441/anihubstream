# Cloud Synchronization & GitHub Actions Setup Guide

This guide walks you through shifting catalog updates from the local background daemon to automated, cloud-based execution via GitHub Actions and remote Cloudflare D1.

---

## 1. Prerequisites

To run catalog synchronization in the cloud, you need:
1. A **GitHub Repository** (Public is recommended to utilize free GitHub Actions minutes without a monthly cap).
2. A **Cloudflare Account** with a D1 SQLite database provisioned (e.g. `anihub`).
3. A **Cloudflare API Token** with D1 Edit permissions.

---

## 2. Linking Your Local Repository to GitHub

If you haven't linked your local repository to GitHub yet:

1. Create a new repository on [GitHub](https://github.com/new) (e.g., `anihubstream`).
2. In your local terminal, add the GitHub remote and push your code:

```bash
# Add the remote repository
git remote add origin https://github.com/<YOUR_GITHUB_USERNAME>/<YOUR_REPO_NAME>.git

# Push the current branch
git branch -M main
git push -u origin main
```

---

## 3. Configuring GitHub Repository Secrets

In your GitHub repository, navigate to **Settings** &rarr; **Secrets and variables** &rarr; **Actions** &rarr; **New repository secret**.

Add the following three required secrets:

| Secret Name | Description | Where to Find It |
|---|---|---|
| `CF_ACCOUNT_ID` | Your Cloudflare Account ID | Cloudflare Dashboard &rarr; Account Details or URL |
| `CF_DATABASE_ID` | Your Cloudflare D1 Database UUID | Cloudflare Dashboard &rarr; Workers & D1 &rarr; D1 &rarr; `anihub` database UUID |
| `CF_API_TOKEN` | API Token with D1 Edit permissions | Cloudflare Dashboard &rarr; My Profile &rarr; API Tokens &rarr; Create Token (Template: D1 Edit) |

---

## 4. GitHub Actions Automated Cadence & Stages

The workflow is defined in [`.github/workflows/catalog-sync.yml`](file:///C:/anihubstream-local/.github/workflows/catalog-sync.yml).

### Automated Schedule
- **Twice Daily**: Runs automatically at `02:00` and `14:00` UTC via cron.
- **Budget-Safe**: Automatically throttles requests and complies with AniList's 90 req/min rate limit and Cloudflare D1's 100,000 daily write quota.

### Manual Dispatch (Targeted Stages)
You can manually trigger the workflow anytime from the **Actions** tab on GitHub:
1. Navigate to **Actions** &rarr; **catalog-sync**.
2. Click **Run workflow**.
3. Select the target stage:
   - `all`: Executes all pipeline phases sequentially.
   - `pulse`: Fast heartbeat check and top trending refresh.
   - `fribb`: Synchronizes 39,000+ cross-referenced IDs from `Fribb/anime-lists` into `anime_id_map`.
   - `anilist`: Updates AniList metadata, ratings, and airing seasons.
   - `kitsu`: Fetches Kitsu artwork and episode counts.
   - `hianime`: Ingests HiAnime streaming slugs and episode listings.
   - `providers`: Synchronizes AniKoto and AniWatch provider maps & franchise relations.
   - `schedule`: Refreshes the ongoing weekly broadcast schedule.
   - `episodes`: Generates missing episode rows and syncs AniSkip opening/ending markers.
   - `maintenance`: Database retention, pruning, and search vector maintenance.
   - `health`: Tests streaming provider mirrors and detects dead links.

---

## 5. Dual-Mode Operations (Local vs. Cloud)

AniHubStream scripts are built to run seamlessly in either environment:

| Mode | Command | Data Store | Credentials Needed? |
|---|---|---|---|
| **Local Sync** | `npm run sync:local` | Local Miniflare D1 (`.wrangler/.../*.sqlite`) | None |
| **Local Fast Growth** | `npm run sync:growth` | Local Miniflare D1 (`.wrangler/.../*.sqlite`) | None |
| **Local Fribb Sync** | `npm run sync:fribb` | Local Miniflare D1 (`.wrangler/.../*.sqlite`) | None |
| **Cloud CI/CD** | GitHub Actions (`catalog-sync.yml`) | Remote Cloudflare D1 (via REST API) | `CF_ACCOUNT_ID`, `CF_DATABASE_ID`, `CF_API_TOKEN` |
| **Remote Fribb Sync** | `node tools/sync-fribb-id-map.mjs --remote` | Remote Cloudflare D1 (via REST API) | `CF_ACCOUNT_ID`, `CF_DATABASE_ID`, `CF_API_TOKEN` |

---

## 6. Verifying Credentials with `doctor-secrets`

Before triggering a remote sync, verify that your credentials are valid without printing them to console:

```bash
node cloud-sync/doctor-secrets.mjs
```

When properly configured, `doctor-secrets` performs a lightweight `SELECT 1` check against your remote D1 database to ensure seamless connectivity.
