# Local Sandbox Environment (AniHubStream Local Mirror)

## Problem Statement
How might we establish an isolated local development environment in `C:\Users\My\anihubstream-local` with full GitHub repository code, Cloudflare Pages edge functions, stream bridge, and pre-seeded D1 database state so changes can be tested safely without corrupting the primary repository?

## Recommended Direction
A clean, independent mirror in `C:\Users\My\anihubstream-local`:
1. Copy all project source code, configurations (`functions/`, `src/`, `api/`, `wrangler.toml`, `package.json`, etc.), and environment presets.
2. Exclude bulky cache directories (`node_modules`, `.vite`, `.cache`).
3. Copy the local Cloudflare D1 database state (`.wrangler/state/v3/d1/`) so all anime catalog data and mappings are instantly available in the new folder.
4. Provide independent scripts to launch dev servers without port collision.

## Key Assumptions to Validate
- [ ] Local D1 SQLite files in `.wrangler/state/` copy cleanly without lock errors.
- [ ] Running `npm install` in the new folder succeeds cleanly on Windows.
- [ ] Cloudflare Pages functions and Miniflare correctly recognize the copied D1 database in the new directory.

## MVP Scope
- **Included:**
  - Complete project source files (`src/`, `functions/`, `api/`, `public/`, `tools/`, `workers/`, `sync-worker/`).
  - Configuration files (`package.json`, `package-lock.json`, `wrangler.toml`, `vite.config.ts`, `tsconfig.json`, `.dev.vars`, `.env`).
  - Database schemas and seeds (`schema.sql`, `seed.sql`).
  - Seeded D1 SQLite database from `.wrangler/state/v3/d1/`.
  - Independent Git repository initialization in `C:\Users\My\anihubstream-local`.
- **Not Included:**
  - Copying 200MB+ `node_modules` (a clean `npm install` in the destination is faster and prevents corrupt Windows file links).
  - Production Cloudflare deployment hooks (remains 100% local).

## Not Doing (and Why)
- **Not doing live two-way sync:** Two-way sync risks accidental overwrites between experimental and stable code.
- **Not copying live lockfiles without verification:** Prevents locked SQLite file copy errors on Windows.

## Open Questions
- Should the local dev ports in the sandbox run on alternative ports (e.g., 8898 / 8794) to allow simultaneous testing alongside the original repository?
