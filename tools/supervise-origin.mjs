// @ts-check
/**
 * Origin supervisor — keeps the three local services the hosted site depends on running,
 * and writes down in one log what happened when one of them did not.
 *
 *   node tools/supervise-origin.mjs
 *
 * Before this, AniHubOrigin.cmd started each process in its own window at logon and nothing
 * looked after them: a bridge that threw on start-up, a tunnel that dropped its connection,
 * or a static server that hung with its socket open all stayed exactly as the operator left
 * them until the next reboot, while the site served visitors an error nobody saw.
 *
 * What it does, once per tick:
 *   - a service whose port this supervisor started is probed, not just watched for exit. A
 *     live process that answers nothing is the failure a plain "did it exit?" supervisor misses.
 *   - a service already answered by something else (the copy the old Startup script launched,
 *     or a second supervisor) is adopted and re-checked, never duplicated — a second server on
 *     the same port can only crash-loop on EADDRINUSE.
 *   - a service that exits comes back after a capped backoff, and after a run of crashes that
 *     never lasted a few seconds it stops trying and says so: a bad build is for an operator,
 *     not for a retry loop that grows the log forever.
 *   - only one supervisor can run: it holds a loopback port as a lock, so a stray second copy
 *     exits with a line saying who to look at instead of fighting the first over the ports.
 *
 *   ANIKOTO_CLOUDFLARED     path to cloudflared.exe (the copy this machine uses today)
 *   ANIKOTO_TUNNEL_CONFIG   the named-tunnel config it runs
 *   ANIKOTO_ORIGIN_PORT     static origin port (default 8787)
 *   ANIKOTO_BRIDGE_PORT     bridge port (default 8795)
 *   ANIKOTO_SUPERVISOR_PORT loopback lock port (default 8794)
 *   ANIKOTO_ORIGIN_LOG      where to append (default logs/origin.log beside this repo)
 */

import { execFile, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { appendFile, mkdir, rename } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LOG_FILE = process.env.ANIKOTO_ORIGIN_LOG ?? join(ROOT, 'logs', 'origin.log');
const MAX_LOG_BYTES = 2_000_000;
const CLOUDFLARED =
  process.env.ANIKOTO_CLOUDFLARED ?? 'C:\\Users\\My\\qoder_scratch\\cloudflared\\cloudflared.exe';
const TUNNEL_CONFIG = process.env.ANIKOTO_TUNNEL_CONFIG ?? 'C:\\Users\\My\\.cloudflared\\config.yml';
const ORIGIN_PORT = Number(process.env.ANIKOTO_ORIGIN_PORT ?? 8787);
const BRIDGE_PORT = Number(process.env.ANIKOTO_BRIDGE_PORT ?? 8795);
const LOCK_PORT = Number(process.env.ANIKOTO_SUPERVISOR_PORT ?? 8794);

const TICK_MS = 15_000;
const PROBE_TIMEOUT_MS = 8_000;
/** consecutive unanswered probes before a running child is considered hung */
const HUNG_AFTER_PROBES = 3;
/** how long to wait before re-testing a port someone else is answering */
const RECHECK_MS = 60_000;
/** uptime past which a crash counts as a fresh problem rather than a bad build */
const STABLE_AFTER_MS = 60_000;
const MAX_BACKOFF_MS = 60_000;
/** crashes in a row, none of them lasting a minute, before the operator is needed */
const GIVE_UP_AFTER = 8;

/** `probe` is what "alive" means for this child: a port that answers, not just a PID. */
const SPECS = [
  {
    name: 'origin',
    file: process.execPath,
    args: [join(ROOT, 'tools', 'serve-static.mjs')],
    env: { PORT: String(ORIGIN_PORT) },
    probe: `http://127.0.0.1:${ORIGIN_PORT}/`,
  },
  {
    name: 'bridge',
    file: process.execPath,
    args: [join(ROOT, 'api', 'bridge.mjs')],
    env: { ANIKOTO_BRIDGE_PORT: String(BRIDGE_PORT) },
    probe: `http://127.0.0.1:${BRIDGE_PORT}/health`,
  },
  {
    name: 'tunnel',
    file: CLOUDFLARED,
    args: ['tunnel', '--config', TUNNEL_CONFIG, 'run'],
    env: {},
    probe: null,
  },
];

let logBytes = 0;
async function log(line) {
  const text = `${new Date().toISOString()} ${line}\n`;
  try {
    await mkdir(dirname(LOG_FILE), { recursive: true });
    if (logBytes >= MAX_LOG_BYTES) {
      await rename(LOG_FILE, `${LOG_FILE}.1`).catch(() => {});
      logBytes = 0;
    }
    await appendFile(LOG_FILE, text);
    logBytes += Buffer.byteLength(text);
  } catch {
    /* a log that cannot be written must not take the services down with it */
  }
  process.stdout.write(text);
}

/** The lock is held by binding a loopback port: whoever wins it is the only supervisor. */
const holdLock = () =>
  new Promise((done) => {
    const srv = createServer();
    srv.once('error', (/** @type {any} */ e) => done(e.code === 'EADDRINUSE' ? null : srv));
    srv.once('listening', () => done(srv));
    srv.listen(LOCK_PORT, '127.0.0.1');
  });

const answer = async (/** @type {any} */ spec) => {
  if (!spec.probe) return false;
  try {
    const res = await fetch(spec.probe, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    await res.body?.cancel().catch(() => {});
    return res.ok;
  } catch {
    return false;
  }
};

const processRunning = (/** @type {string} */ image) =>
  new Promise((done) => {
    execFile(
      'tasklist.exe',
      ['/NH', '/FO', 'CSV', '/FI', `IMAGENAME eq ${image}`],
      { windowsHide: true },
      (_err, out) => done(String(out).toLowerCase().includes(image.toLowerCase())),
    );
  });

/** Something outside this supervisor already provides the service, so starting ours adds a crash. */
const servedElsewhere = (/** @type {any} */ spec) =>
  spec.probe ? answer(spec) : processRunning(basename(spec.file));

const watched = SPECS.map((spec) => ({
  spec,
  /** @type {import('node:child_process').ChildProcess | null} */
  proc: null,
  startedAt: 0,
  nextAt: 0,
  tries: 0,
  misses: 0,
  watching: false,
  killing: false,
  givenUp: false,
  stopping: false,
}));

async function tick(c) {
  if (c.stopping || c.givenUp) return;
  if (c.proc) {
    if (!c.spec.probe || c.killing) return;
    if (await answer(c.spec)) {
      c.misses = 0;
      return;
    }
    c.misses += 1;
    if (c.misses < HUNG_AFTER_PROBES) {
      await log(`${c.spec.name}: probe ${c.misses}/${HUNG_AFTER_PROBES} did not answer`);
      return;
    }
    await log(`${c.spec.name}: not answering after ${c.misses} probes — restarting it`);
    c.misses = 0;
    c.killing = true;
    c.proc.kill();
    return;
  }

  if (Date.now() < c.nextAt) return;
  if (await servedElsewhere(c.spec)) {
    c.nextAt = Date.now() + RECHECK_MS;
    if (!c.watching) {
      c.watching = true;
      await log(`${c.spec.name}: already answered from outside — watching its port, not duplicating it`);
    }
    return;
  }
  if (c.watching) {
    c.watching = false;
    await log(`${c.spec.name}: stopped answering from outside — starting ours`);
  }
  start(c);
}

function start(c) {
  const p = spawn(c.spec.file, c.spec.args, {
    cwd: ROOT,
    env: { ...process.env, ...c.spec.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  c.proc = p;
  c.startedAt = Date.now();
  c.misses = 0;
  c.killing = false;
  const relay = (/** @type {any} */ chunk) =>
    String(chunk)
      .trim()
      .split('\n')
      .forEach((l) => void log(`${c.spec.name}: ${l}`));
  p.stdout.on('data', relay);
  p.stderr.on('data', relay);
  const gone = (/** @type {string} */ why) => {
    if (c.proc !== p) return;
    c.proc = null;
    if (c.stopping) return;
    const up = Date.now() - c.startedAt;
    const byUs = c.killing;
    c.killing = false;
    void log(`${c.spec.name}: ${why} after ${Math.round(up / 1000)}s`);
    /* A crash inside the first seconds is a bad build, not a blip: back off before trying
       again, so a port already taken cannot spin this process into a giant log. */
    if (up > STABLE_AFTER_MS) c.tries = 0;
    else if (!byUs) c.tries += 1;
    if (c.tries >= GIVE_UP_AFTER) {
      c.givenUp = true;
      void log(`${c.spec.name}: gave up after ${c.tries} crashes in a row — needs an operator`);
      return;
    }
    const delay = byUs ? TICK_MS : Math.min(MAX_BACKOFF_MS, 2_000 * 2 ** Math.min(c.tries, 5));
    c.nextAt = Date.now() + delay;
  };
  /* A missing executable never fires 'exit' — it only errors — so it has to reach the same
     backoff or the loop would retry a binary that cannot start once per tick forever. */
  p.on('error', (/** @type {any} */ e) => gone(`spawn failed ${e?.message ?? e}`));
  p.on('exit', (code, sig) => gone(`exited code=${code} sig=${sig}`));
  /* A missing executable fails asynchronously, so "started" is only worth writing once the
     child is still here — otherwise every attempt logs a start the machine never had. */
  setTimeout(() => {
    if (c.proc === p)
      void log(`${c.spec.name}: started pid=${p.pid} on ${c.spec.probe ?? basename(c.spec.file)}`);
  }, 250);
}

const lock = await holdLock();
if (!lock) {
  await log(`not starting: another supervisor already holds 127.0.0.1:${LOCK_PORT}`);
  process.exit(1);
}
await log(
  `supervisor up — ${SPECS.map((s) => s.name).join(', ')} — log ${LOG_FILE} — tick ${TICK_MS / 1000}s`,
);

for (const c of watched) void tick(c);
const driver = setInterval(() => {
  for (const c of watched) void tick(c);
}, TICK_MS);

const shutdown = (/** @type {string} */ signal) => {
  void log(`supervisor stopping on ${signal}`);
  for (const c of watched) {
    c.stopping = true;
    c.proc?.kill();
  }
  clearInterval(driver);
  lock?.close();
  setTimeout(() => process.exit(0), 800);
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
