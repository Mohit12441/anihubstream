# Automatic Pre-Flight Audit Standard (Loopholes & Limitations Gate)

## Problem Statement
How Might We ensure that Antigravity automatically detects plan loopholes, circular dependencies, edge cases, and platform limitations on EVERY given task BEFORE implementing code, guaranteeing bug-free and resilient solutions without requiring the user to prompt `/idea-refine` manually each time?

## Recommended Direction
Codify the **Mandatory Pre-Flight Audit Gate** into `AGENTS.md` (Phase 4 of the EAF Workflow). Whenever an agent is assigned any non-trivial task, feature, or refactor:
1. It is bound by system instructions to execute a 3-part pre-mortem:
   - **Plan Loopholes & Traps**: Edge-case bypasses, race conditions, stale cache locks, thundering herds.
   - **Hard Platform Limitations**: Free-tier quotas (Cloudflare D1, Pages limits, GitHub Actions minutes), browser storage eviction (Safari ITP), worker memory caps.
   - **Pre-Emptive Solutions**: Concrete safeguards included in the implementation plan before touching code.
2. The user receives early clarity and risk mitigation before code is committed.

## Key Assumptions to Validate
- [x] AGENTS.md is automatically loaded into the system prompt across every new session and restart.
- [x] Hard gate halts naive coding until the pre-mortem analysis is presented.
- [x] Zero-read edge caching and regression tests act as executable safety nets.

## MVP Scope
1. Update `AGENTS.md` Phase 4 (PLAN) to mandate the 3-part Pre-Flight Audit Gate.
2. Enforce standard reporting:
   - ⚠️ Plan Loopholes / Traps
   - 🛑 Platform Limitations
   - 💡 Pre-Emptive Solutions
3. Regression verification with `npm run test:cache` and `npm run build`.

## Not Doing (and Why)
- Not running full multi-page audits for simple 1-line typo fixes (restricted to non-trivial tasks, features, and refactors to maintain velocity).
- Not blocking user execution with endless questioning when requirements are already clear.
