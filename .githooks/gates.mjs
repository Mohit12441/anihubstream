#!/usr/bin/env node
// POLICY (was atlas.yaml, deleted after thea 504):
//   change-firewall:  block if risk_score > 60
//   ckb-impact:       block if blast_radius > 20
//   clenzer-delta:    warn on new dead code (baseline: .clenzer-baseline.json)
//   backend-*:        block on typecheck/build failure (Phase 2 of finalization)
//
// Deterministic pre-commit gate orchestrator.
// Exit 0 = allow commit. Exit 1 = block.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const SKIP = process.env.SKIP_GATES === "1";
if (SKIP) {
  console.warn("⚠️  SKIP_GATES=1 — gates bypassed. CI will still enforce.");
  process.exit(0);
}

const RED = "\x1b[31m", GRN = "\x1b[32m", YEL = "\x1b[33m", RST = "\x1b[0m";
const results = [];

function run(cmd, opts = {}) {
  return spawnSync(cmd, { shell: true, encoding: "utf8", timeout: 30_000, maxBuffer: 50 * 1024 * 1024, ...opts });
}

function changedFiles() {
  const out = run("git diff --cached --name-only --diff-filter=ACMR");
  if (out.status !== 0) return [];
  return out.stdout.split("\n").map(s => s.trim()).filter(Boolean);
}

function gate(name, fn) {
  try {
    const r = fn();
    results.push({ name, status: r.status, detail: r.detail });
  } catch (e) {
    results.push({ name, status: "BLOCK", detail: e.message });
  }
}

const files = changedFiles();
const codeFiles = files.filter(f => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(f));

// ── Gate 1: Change Firewall (TS/JS only) ──────────────────
gate("change-firewall", () => {
  if (codeFiles.length === 0) return { status: "PASS", detail: "no TS/JS changes" };
  const r = run("npx change-firewall analyze --staged --json");
  if (r.status !== 0) return { status: "WARN", detail: "tool error — not blocking" };
  let risk = 0;
  try {
    const j = JSON.parse(r.stdout);
    risk = j.risk?.score ?? j.risk_score ?? j.risk ?? 0;
  } catch { return { status: "WARN", detail: "unparseable output" }; }
  return risk > 60
    ? { status: "BLOCK", detail: `risk ${risk}/100 > 60` }
    : { status: "PASS", detail: `risk ${risk}/100` };
});

// ── Gate 2: CKB impact (all languages) ────────────────────
gate("ckb-impact", () => {
  if (files.length === 0) return { status: "PASS", detail: "no changes" };
  const r = run("ckb impact diff --staged --format=json");
  if (r.status !== 0) return { status: "WARN", detail: "index stale or tool error" };
  let blast = 0;
  try {
    const j = JSON.parse(r.stdout);
    blast = j.blastRadius?.fileCount ?? j.blast_radius ?? j.summary?.directlyAffected ?? 0;
  } catch { return { status: "WARN", detail: "unparseable output" }; }
  return blast > 20
    ? { status: "BLOCK", detail: `blast ${blast} > 20` }
    : { status: "PASS", detail: `blast ${blast}` };
});

// ── Gate 3: clenzer delta (advisory) ──────────────────────
gate("clenzer-delta", () => {
  if (codeFiles.length === 0) return { status: "PASS", detail: "no TS/JS changes" };
  const r = run("npx clenzer scan_dead_code --changed-only --json", { timeout: 10_000 });
  if (r.status !== 0) return { status: "PASS", detail: "no new dead code" };
  let current = [];
  try { current = JSON.parse(r.stdout).issues ?? []; } catch {}
  let baseline = new Set();
  try {
    const b = JSON.parse(readFileSync(".clenzer-baseline.json", "utf8"));
    for (const i of b.issues ?? []) baseline.add(`${i.file}:${i.line}:${i.rule}`);
  } catch {}
  const fresh = current.filter(i => !baseline.has(`${i.file}:${i.line}:${i.rule}`));
  return fresh.length > 0
    ? { status: "WARN", detail: `${fresh.length} NEW dead-code findings` }
    : { status: "PASS", detail: "no new dead code" };
});

// ── Gate 4: backend typecheck (Python) ────────────────────
gate("backend-typecheck", () => {
  const pyFiles = files.filter(f => f.endsWith(".py"));
  if (pyFiles.length === 0) return { status: "PASS", detail: "no Python changes" };
  const r = run("python3 -m mypy " + pyFiles.join(" ") + " --no-error-summary");
  if (r.status === 0) return { status: "PASS", detail: `${pyFiles.length} py files clean` };
  if (/No module named mypy/.test(r.stderr)) return { status: "WARN", detail: "mypy not installed" };
  return { status: "BLOCK", detail: "type errors in changed files" };
});

// ── Report ────────────────────────────────────────────────
console.log("\n── Pre-commit gates ──");
let blocked = false;
for (const r of results) {
  const c = r.status === "PASS" ? GRN : r.status === "WARN" ? YEL : RED;
  console.log(`${c}${r.status.padEnd(5)}${RST} ${r.name.padEnd(18)} ${r.detail}`);
  if (r.status === "BLOCK") blocked = true;
}

if (blocked) {
  console.error(`\n${RED}Commit blocked.${RST} Fix the failing gate(s), or:`);
  console.error(`  SKIP_GATES=1 git commit ...   (CI will still enforce)`);
  process.exit(1);
}
console.log(`\n${GRN}All blocking gates passed.${RST}\n`);
process.exit(0);
