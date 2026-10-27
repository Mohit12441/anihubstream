# Full-Stack GitHub & Cloudflare Ecosystem Audit & Glitch Remediation

## Problem Statement
How Might We systematically audit, diagnose, stress-test, and eliminate latent bugs, edge regressions, and UI glitches across all four tiers of AniHubStream (GitHub Actions CI/Pipelines, Cloudflare Pages Edge Functions, D1 SQLite Schemas, and the React Player Interface) using automated MCP tools and hermetic verification suites?

## Recommended Direction
A multi-vector automated audit and remediation loop:
1. **Edge API & Contract Verification**: Audit all Cloudflare Pages Functions (`functions/api/*`) for strict schema compliance (`ApiResponse<T>`), error envelope safety, 50-byte D1 LIKE/GLOB ceiling enforcement, and zero unhandled rejections.
2. **Code Cortex Graph Analysis**: Inspect module boundaries, trace unused/unreachable imports or dead symbols, and verify cross-provider fallback mappings (`anikoto` -> `hianime` -> `aniwatch`).
3. **Siteprobe Automated Edge & SEO Audit**: Run live audits against the local Miniflare edge runtime (`http://127.0.0.1:8899`) to evaluate SSR fallbacks, semantic crawler shells, response headers, sitemap compliance, and mobile responsive layout integrity.
4. **Immediate Surgical Remediation**: Automatically patch confirmed safe defects, run hermetic regression tests (`npm test` and `npm run typecheck`), and isolate any architectural trade-offs for review.

## Key Assumptions to Validate
- [ ] Miniflare D1 emulation matches remote Cloudflare D1 behavior on statement size limits (90 parameters / 90KB SQL limit).
- [ ] Edge API handlers gracefully degrade when third-party upstream providers (HiAnime, AniKoto, AniWatch) are slow or return non-200.
- [ ] React SPA crawler shell (`index.html` + `functions/_middleware.js`) preserves rich metadata for social crawlers (OpenGraph, Twitter Cards, JSON-LD) without breaking client hydration.
- [ ] All 4 active GitHub Actions workflows (`catalog-sync`, `tests`, `health-canary`, `ops`) have valid secrets/variables mapping and zero concurrency deadlocks.

## MVP Scope
- Full-suite static and graph analysis of edge functions and UI components.
- Live probe against `http://127.0.0.1:8899` endpoints (`/api/health`, `/api/anime`, `/api/schedule`, `/api/play/resolve`, `/sitemap.xml`).
- Direct patching of any detected uncaught promise rejections, type ambiguities, stale headers, or broken error handling.
- Full verification through `tsc --noEmit` and all 457 unit/integration tests.

## Not Doing (and Why)
- Deploying directly to remote Cloudflare production (`wrangler pages deploy`) — strictly prohibited by EAF Protocol Principle 6 without explicit command.
- Introducing heavy third-party testing dependencies that complicate the lightweight Miniflare/Node.js test runner.
- Modifying remote D1 production tables without prior D1 Time Travel snapshots.

## Open Questions
- None. Full-stack scope and immediate surgical remediation were selected.
