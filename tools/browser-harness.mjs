// @ts-check
/**
 * Browser harness — drives a real Chrome over CDP: launch, navigate, click, type, screenshot,
 * collect console errors. It lives in the repo so a runtime claim about the site can be checked
 * by anyone who clones it, not only by whoever made the change.
 *
 *   node tools/verify-runtime.mjs          uses this
 *
 * Chrome is started headless with its own throwaway profile under logs/browser/, so it never
 * touches the operator's browsing state and two runs cannot share a profile.
 *
 *   CDP_PORT  debug port (default 9333)
 *   CHROME    path to chrome.exe
 */
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const OUT = join(ROOT, 'logs', 'browser');
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = Number(process.env.CDP_PORT || 9333);
const PROFILE = join(ROOT, 'logs', 'browser', `profile-${process.pid}`);

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch() {
  /* a previous run's Chrome can still hold the debug port while it shuts down, and the new
     instance then exits on "port in use" — wait for the port to go quiet before spawning */
  for (let i = 0; i < 80; i++) {
    let live = false;
    try {
      live = (await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok;
    } catch {
      live = false;
    }
    if (!live) break;
    await sleep(250);
    if (i === 79) throw new Error(`port ${PORT} is still held after 20s — a harness Chrome is wedged`);
  }
  rmSyncProfile();
  mkdirSync(OUT, { recursive: true });
  const proc = spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${PROFILE}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--allow-file-access-from-files',
      '--autoplay-policy=no-user-gesture-required',
      '--window-size=1440,900',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'ignore'] },
  );
  let info;
  for (let i = 0; i < 60; i++) {
    try {
      info = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
      break;
    } catch {
      await sleep(250);
    }
  }
  if (!info) throw new Error(`chrome did not come up — is ${CHROME} installed? (CHROME= overrides it)`);
  return { proc, info };
}

function rmSyncProfile() {
  try {
    rmSync(PROFILE, { recursive: true, force: true });
  } catch {
    /* a profile that will not go away only means this run reuses it */
  }
}

export class Session {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.wait = new Map();
    this.events = [];
    ws.addEventListener('close', () => {
      /* a pending send would never settle and Node exits with "unsettled top-level await",
         which reads like a hang in the script rather than a dead browser */
      for (const { bad, method } of this.wait.values()) bad(new Error(`${method}: browser socket closed`));
      this.wait.clear();
    });
    ws.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id && this.wait.has(msg.id)) {
        const { ok, bad, method } = this.wait.get(msg.id);
        this.wait.delete(msg.id);
        msg.error ? bad(new Error(`${method}: ${msg.error.message}`)) : ok(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
      }
    });
  }
  static async open(port) {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = list.find((t) => t.type === 'page');
    const s = new Session(new WebSocket(page.webSocketDebuggerUrl));
    await sleep(150);
    return s;
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((ok, bad) => {
      this.wait.set(id, { ok, bad, method });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  close() {
    try { this.ws.close(); } catch { /* already gone */ }
  }
  async enable() {
    for (const domain of ['Page', 'Runtime', 'Log']) await this.send(`${domain}.enable`);
  }
  async eval(expression, awaitPromise = false) {
    const r = await this.send('Runtime.evaluate', {
      expression, awaitPromise, returnByValue: true,
    });
    if (r.exceptionDetails)
      throw new Error('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  }
  /** Runs an async expression in the page and waits for its promise. */
  async evalAsync(expression) {
    return this.eval(`(async()=>{${expression}})()`, true);
  }
  async goto(url, settle = 1400) {
    const prev = this.events.length;
    await this.send('Page.navigate', { url });
    for (let i = 0; i < 80; i++) {
      if (this.events.slice(prev).some((e) => e.method === 'Page.loadEventFired')) break;
      await sleep(100);
    }
    await sleep(settle);
  }
  async viewport(w, h, mobile = false, dsf = 1, touch = false) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width: w, height: h, deviceScaleFactor: dsf, mobile,
    });
    /* maxTouchPoints is only valid while touch is enabled — 0 is rejected outright */
    await this.send('Emulation.setTouchEmulationEnabled',
      touch ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
    await this.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  }
  /** Waits until `predicate` (an in-page expression) is true. Returns the value it settled on. */
  async wait4(predicate, { timeout = 30_000, every = 400 } = {}) {
    const until = Date.now() + timeout;
    for (;;) {
      const value = await this.eval(`(()=>{${predicate}})()`);
      if (value) return value;
      if (Date.now() > until) throw new Error(`timed out after ${timeout}ms waiting for: ${predicate.slice(0, 70)}`);
      await sleep(every);
    }
  }
  async shot(name, { full = true } = {}) {
    /** @type {{w:number,h:number}} */
    let size;
    let params;
    if (full) {
      const metrics = await this.send('Page.getLayoutMetrics');
      const css = metrics.cssContentSize ?? metrics.contentSize;
      const w = Math.round(css.width);
      const h = Math.round(Math.min(css.height, 5000));
      size = { w, h };
      /* a clip is rejected outright under mobile device emulation ("Invalid parameters"),
         so the full-page path only clips when it is not emulating a phone */
      params = { format: 'jpeg', quality: 68, captureBeyondViewport: true, clip: { x: 0, y: 0, width: w, height: h, scale: 1 } };
    } else {
      size = await this.eval(`({w:window.innerWidth,h:window.innerHeight})`);
      /* the viewport-only case does not need a clip — the default capture *is* the viewport */
      params = { format: 'jpeg', quality: 68 };
    }
    const { data } = await this.send('Page.captureScreenshot', params);
    const p = join(OUT, `${name}.jpg`);
    writeFileSync(p, Buffer.from(data, 'base64'));
    return `${p} (${size.w}x${size.h})`;
  }
  /* NOTE: the app sets `scroll-behavior: smooth`, so a plain scrollIntoView() is
     still animating when getBoundingClientRect() runs — coordinates would be stale
     and clicks would land on whatever scrolled into that point. Force instant. */
  async box(sel) {
    return this.eval(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});
      if(!e) return null; e.scrollIntoView({block:'center',inline:'center',behavior:'instant'});
      const r=e.getBoundingClientRect();
      return {x:r.x+r.width/2,y:r.y+r.height/2,w:Math.round(r.width),h:Math.round(r.height),
        text:(e.innerText||'').replace(/\\s+/g,' ').trim().slice(0,90)};})()`);
  }
  /* a display:none element still matches a selector but has a zero rect — its centre is
     (0,0), so an unguarded tap would land on whatever sits in the corner of the page and
     the check would pass or fail for entirely the wrong reason */
  async target(sel) {
    const b = await this.box(sel);
    if (!b) throw new Error('no element: ' + sel);
    if (b.w < 1 || b.h < 1) throw new Error('element has no size (not rendered): ' + sel);
    return b;
  }
  async click(sel, opts = {}) {
    const b = await this.target(sel);
    await sleep(180);
    const x = b.x + (opts.dx || 0), y = b.y + (opts.dy || 0);
    for (const [type, button, clickCount] of [
      ['mouseMoved', 'none', 0],
      ['mousePressed', 'left', 1],
      ['mouseReleased', 'left', 1],
    ]) {
      await this.send('Input.dispatchMouseEvent', { type, x, y, button, clickCount });
    }
    await sleep(opts.wait ?? 700);
    return b;
  }
  /* Real touch taps (phone-style pointerType='touch'). Mouse clicks differ in the
     player: the app's stage-tap logic wakes the chrome on mouse events only. */
  async tap(sel, opts = {}) {
    const b = await this.target(sel);
    await sleep(180);
    const x = b.x + (opts.dx || 0), y = b.y + (opts.dy || 0);
    const pt = { x, y, radiusX: 12, radiusY: 12, force: 1 };
    await this.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pt] });
    await sleep(70);
    await this.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(opts.wait ?? 700);
    return b;
  }
  async type(sel, text, { submit = false } = {}) {
    await this.click(sel, { wait: 250 });
    await this.send('Input.insertText', { text });
    if (submit) await this.enter();
    await sleep(900);
  }
  async enter() {
    for (const kind of ['keyDown', 'char', 'keyUp']) {
      await this.send('Input.dispatchKeyEvent', {
        type: kind, key: 'Enter', code: 'Enter', text: kind === 'char' ? '\r' : '',
        windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
      });
    }
  }
  async key(key, code, vk) {
    for (const type of ['keyDown', 'keyUp']) {
      await this.send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
    }
    await sleep(400);
  }
  logs() {
    const out = [];
    for (const e of this.events) {
      if (e.method === 'Log.entryAdded' && ['error', 'warning'].includes(e.params.entry.level)) {
        out.push(`[${e.params.entry.level}] ${e.params.entry.source}: ${e.params.entry.text.slice(0, 200)}`);
      }
      if (e.method === 'Runtime.exceptionThrown') {
        const d = e.params.exceptionDetails;
        out.push('[exception] ' + (d.exception?.description || d.text).slice(0, 300));
      }
      if (e.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(e.params.type)) {
        out.push(`[console.${e.params.type}] ` + e.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ').slice(0, 700));
      }
    }
    return [...new Set(out)];
  }
  clearLogs() { this.events.length = 0; }
  async mediaReducedMotion(on) {
    await this.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: on ? 'reduce' : 'no-preference' }],
    });
    await sleep(400);
  }
  async kill() {
    /* Browser.close kills the socket underneath the reply, so the send never settles on its own */
    try { await Promise.race([this.send('Browser.close'), sleep(1500)]); } catch { /* closed */ }
    this.close();
  }
}

export { PORT, PROFILE };
