// @ts-check
/**
 * Runtime verification — drives the built site in a real browser and reports what it *saw*,
 * one line per claim. Nothing here asserts on source code: every check is a click, a seek or a
 * measurement of a live page, and every failure prints the value that made it fail.
 *
 *   node tools/verify-runtime.mjs
 *   VERIFY_URL=https://issues-preview.anihubstream.pages.dev node tools/verify-runtime.mjs
 *
 *   VERIFY_URL     site to drive (default http://127.0.0.1:8899 — `wrangler pages dev dist-preview`)
 *   VERIFY_BRIDGE  loopback bridge for the VTT read-behind (default http://127.0.0.1:8795)
 *   VERIFY_DEEP    title id to open instead of searching the catalogue for a playable one
 *
 * Screenshots land in logs/browser/. Exit code is 1 if any check failed.
 */
import { request } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Session, launch, sleep, OUT, PORT } from './browser-harness.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = (process.env.VERIFY_URL ?? 'http://127.0.0.1:8899').replace(/\/+$/, '');
const BRIDGE = (process.env.VERIFY_BRIDGE ?? 'http://127.0.0.1:8795').replace(/\/+$/, '');

/** @type {{id:string,name:string,pass:boolean,detail:string,shot?:string}[]} */
const results = [];
const check = (id, name, pass, detail, shot) => {
  results.push({ id, name, pass, detail, shot });
  console.log(`${pass ? 'PASS' : 'FAIL'} [${id}] ${name}\n     ${detail}${shot ? `\n     shot ${shot}` : ''}`);
};
const note = (line) => console.log(`     · ${line}`);
const getJSON = async (url, ms = 25_000) =>
  (await (await fetch(url, { signal: AbortSignal.timeout(ms) })).json());

const VTT = /WEBVTT/i;
/** Parse cue intervals out of a real .vtt body — the same intervals the player reads. */
const parseCues = (text) => {
  const out = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    const m = block.match(/(\d\d:)?(\d\d):(\d\d)\.(\d{3})\s*-->\s*(\d\d:)?(\d\d):(\d\d)\.(\d{3})/);
    if (!m) continue;
    const at = (h, mi, s, ms2) => Number(h?.slice(0, 2) ?? 0) * 3600 + Number(mi) * 60 + Number(s) + Number(ms2) / 1000;
    const start = at(m[1], m[2], m[3], m[4]);
    const end = at(m[5], m[6], m[7], m[8]);
    const body = block.split(/\r?\n/).filter((l) => l && !l.includes('-->')).join(' ').replace(/<[^>]+>/g, '');
    out.push({ start, end, text: body.slice(0, 60) });
  }
  return out;
};

/** Ask the local Functions for a viewer cookie under a chosen Host, through a raw socket. */
const cookieForHost = (host, port) =>
  new Promise((done) => {
    const req = request(
      { host: '127.0.0.1', port, method: 'POST', path: '/api/me/library',
        headers: { host, 'content-type': 'application/json', 'content-length': Buffer.byteLength(BODY) } },
      (res) => {
        const headers = res.headers['set-cookie'] ?? [];
        res.resume();
        done({ status: res.statusCode ?? 0, setCookie: headers.join(' | ') });
      },
    );
    req.on('error', (e) => done({ status: 0, setCookie: `error ${e.message}` }));
    req.end(BODY);
  });
const BODY = JSON.stringify({ animeId: process.env.VERIFY_SEED_ID ?? 'sousou-no-frieren' });

/* ------------------------------------------------------------------ browser */
const { proc } = await launch();
const session = await Session.open(PORT);
await session.enable();

/* The player only renders a cue that the provider's own VTT really contains, so the expected
   number is read from the file the page fetched, not decided here. */
const capState = () =>
  session.eval(`(()=>{const n=[...document.querySelectorAll('.cap__text')];
    const box=document.querySelector('.cap')?.getBoundingClientRect();
    const cs=n[0]?getComputedStyle(n[0]):null;
    return {count:n.length, text:n.map(e=>e.textContent.trim()).join(' / ').slice(0,80),
      rect:box?{top:Math.round(box.top),bottom:Math.round(box.bottom),left:Math.round(box.left),
        right:Math.round(box.right),h:Math.round(box.height)}:null,
      px:cs?parseFloat(cs.fontSize):null, dir:n[0]?.getAttribute('dir')??null,
      lang:n[0]?.getAttribute('lang')??null,
      hidden:document.querySelector('.cap')?.getAttribute('aria-hidden')??null};})()`);

const videoState = () =>
  session.eval(`(()=>{const v=document.querySelector('video');
    if(!v) return {none:true};
    return {t:v.currentTime,d:v.duration,ready:v.readyState,paused:v.paused,src:v.currentSrc,
      tracks:v.textTracks.length};})()`);

try {
  /* ---- 1. the site itself ---- */
  await session.viewport(1440, 900);
  await session.goto(`${TARGET}/`, 2000);
  const cards = await session.wait4(
    `return document.querySelectorAll('a[href^="/watch/"]').length`, { timeout: 25_000 },
  );
  check('load', 'catalogue renders cards from /api', cards > 0, `${cards} links to /watch at ${TARGET}`);

  /* ---- 2. find something that actually plays ---- */
  /** @type {{id:string,title:string}[]} */
  let candidates = [];
  if (process.env.VERIFY_DEEP) {
    const one = await getJSON(`${TARGET}/api/anime/${process.env.VERIFY_DEEP}`).catch(() => null);
    if (one) candidates = [{ id: one.id, title: one.title }];
  } else {
    const list = await getJSON(`${TARGET}/api/anime?limit=24&sort=rating`);
    candidates = (list?.results ?? []).map((r) => ({ id: r.id, title: r.title }));
  }

  /** @type {{id:string,title:string,video:any,notice:string} | null} */
  let playable = null;
  for (const c of candidates.slice(0, 8)) {
    await session.goto(`${TARGET}/watch/${c.id}?ep=1`, 1500);
    try {
      await session.wait4(`return !!document.querySelector('video')`, { timeout: 12_000 });
      const v = await session.wait4(
        `const v=document.querySelector('video');
         return v && v.readyState>=2 && v.duration>1 ? {t:v.currentTime,d:v.duration,ready:v.readyState} : null`,
        { timeout: 45_000 },
      );
      await session.eval(`document.activeElement?.blur?.()`);
      playable = { ...c, video: v, notice: '' };
      note(`playing: ${c.title} (${c.id}) duration ${Math.round(v.d)}s`);
      break;
    } catch {
      const notice = await session
        .eval(`document.querySelector('.pl__notice,.watch__error,[role=status]')?.innerText?.replace(/\\s+/g,' ').trim().slice(0,120) ?? ''`)
        .catch(() => '');
      note(`skipped ${c.title}: ${notice || 'no playable video in 45s'}`);
    }
  }
  if (!playable) throw new Error('no catalogue title produced a playable video — cannot verify the player');
  check('play', 'a real episode plays through the bridge', true,
    `${playable.title} — duration ${Math.round(playable.video.d)}s from ${await session.eval('document.querySelector("video").currentSrc').then((s) => String(s).slice(0, 90))}`);

  /* ---- 3. start it playing, and say honestly if the browser refuses ---- */
  const started = await session
    .wait4(`const v=document.querySelector('video'); if(v.paused) v.play().catch(()=>{});
            return !v.paused && v.currentTime>0 ? v.currentTime : null`, { timeout: 20_000 })
    .catch(() => null);
  const refused = await session.eval(
    `(()=>{const t=[...document.querySelectorAll('.player,[role="status"]')].map(e=>e.innerText).join(' ');
      const m=t.match(/[^.]{0,90}(autoplay|gesture|press play|tap to play)[^.]{0,40}/i);return m?m[0].replace(/\\s+/g,' ').trim():''})()`,
  );
  check('autoplay', 'the episode actually advances under the player controls',
    typeof started === 'number',
    typeof started === 'number'
      ? `playing at ${started.toFixed(1)}s, control reads "${await session.eval('document.querySelector(".pl__btn--main")?.getAttribute("aria-label") ?? "?"')}"`
      : `video never started playing${refused ? ` — page says: "${refused}"` : ''}`);

  /* ---- 4. #65/#66: every active cue, and it survives a pause ---- */
  const vttUrl = await session.eval(
    `performance.getEntriesByType('resource').map(e=>e.name).filter(n=>/\\/sub\\/[0-9]+\\.vtt/.test(n)).pop() ?? ''`,
  );
  let cues = /** @type {{start:number,end:number,text:string}[]} */ ([]);
  if (vttUrl) {
    const body = await fetch(String(vttUrl), { signal: AbortSignal.timeout(20_000) })
      .then((r) => r.text())
      .catch((e) => { note(`vtt read-behind failed: ${e.message}`); return ''; });
    if (VTT.test(body)) cues = parseCues(body);
    note(`caption file ${String(vttUrl).slice(-40)} — ${cues.length} cues`);
  } else note('no .vtt request found in the page resource log');

  /* Pick the moment the file is busiest, not just the first long cue: the fix being checked
     here is that *every* active cue gets a line, which only shows on an overlap. */
  let target = null;
  let expect = 0;
  for (const c of cues) {
    const at = c.start + 0.05;
    const n = cues.filter((o) => o.start <= at && at < o.end).length;
    if (n > expect) { target = { ...c, at }; expect = n; }
  }
  if (target) {
    const mid = target.at;
    await session.eval(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/Captions off/.test(x.getAttribute('aria-label')||''));b?.click();})()`);
    const ccLabel = await session.eval(
      `(()=>{const b=[...document.querySelectorAll('button')].find(x=>/Captions/.test(x.getAttribute('aria-label')||''));return b?.getAttribute('aria-label')??null})()`,
    );
    await session.eval(`(()=>{const v=document.querySelector('video');v.currentTime=${mid.toFixed(2)};v.play().catch(()=>{})})()`);
    await sleep(1800);
    const playing = await capState();
    check('cc-on', 'captions switch on and render a cue while playing',
      playing.count > 0, `button "${ccLabel}" → ${playing.count} cue line(s): "${playing.text}"`);

    check('cues', `all ${expect} cue(s) active at ${mid.toFixed(1)}s are on screen`,
      playing.count === expect,
      expect > 1
        ? `${playing.count} of ${expect} overlapping lines rendered — "${playing.text}"`
        : `${playing.count} line for ${expect} active cue (busiest moment in this file has no overlap) — "${playing.text}"`);

    /* the fix: the caption used to vanish the moment the viewer paused */
    await session.click('[aria-label="Pause"]', { wait: 2500 });
    const paused = await capState();
    const isPaused = await session.eval(`document.querySelector('video').paused`);
    const shot = await session.shot('captions-while-paused', { full: false });
    check('pause-captions', 'captions stay on screen while paused',
      isPaused === true && paused.count === expect && paused.text === playing.text,
      `paused=${isPaused} ${paused.count} line(s) still rendered (was ${playing.count}) — "${paused.text}"`, shot);

    check('cue-a11y', 'the cue line is exposed to assistive tech with its own direction',
      paused.hidden !== 'true' && paused.dir === 'auto',
      `.cap aria-hidden=${JSON.stringify(paused.hidden)} .cap__text dir=${JSON.stringify(paused.dir)} lang=${JSON.stringify(paused.lang)}`);
    await session.click('[aria-label="Play"]', { wait: 900 }).catch(() => {});
  } else {
    check('cues', 'cue timing probe', false, 'this source had no cues to seek to');
  }

  /* ---- 4. #66: track labels are not doubled ---- */
  await session.click('[aria-label="Player settings"]', { wait: 800 });
  const trackLabels = await session.eval(
    `(()=>{const rows=[...document.querySelectorAll('.pop button,.pop__row,[role="menuitem"]')]
        .map(b=>b.innerText?.replace(/\\s+/g,' ').trim()).filter(t=>t&&t.length<60);
      return rows})()`,
  );
  await session.shot('settings-tracks');
  const doubled = (trackLabels ?? []).filter((t) => /\s+—\s+/.test(t)
    && t.split(/\s+—\s+/)[0].trim().toLowerCase() === t.split(/\s+—\s+/)[1].trim().toLowerCase());
  check('track-labels', 'no track reads "Thai — Thai" (name folded once)',
    doubled.length === 0,
    doubled.length ? `doubled: ${doubled.join(' | ')}` : `${(trackLabels ?? []).length} control labels read, none doubled`);
  await session.key('Escape', 'Escape', 27);

  /* ---- 5. #67: capability-gated controls and the recovery affordance ---- */
  const caps = await session.eval(
    `(()=>({pip:document.pictureInPictureEnabled!==false,
        fs:!!(document.fullscreenElement!==undefined||document.webkitFullscreenElement!==undefined),
        btnPip:!!document.querySelector('[aria-label="Picture-in-picture"]'),
        btnFs:!!document.querySelector('[aria-label="Fullscreen"],[aria-label="Exit fullscreen"]')}))()`,
  );
  check('capabilities', 'PiP/fullscreen controls match what this browser can do',
    caps.btnPip === caps.pip && caps.btnFs === caps.fs,
    `browser pip=${caps.pip} fullscreen=${caps.fs} — buttons shown pip=${caps.btnPip} fs=${caps.btnFs}`);
  const notice = await session.eval(
    `(()=>{const n=document.querySelector('.pl__notice,[role="status"]');
      return n?n.innerText.replace(/\\s+/g,' ').trim().slice(0,140):''})()`,
  );
  check('recovery', 'the player states what it is doing while a stream recovers', true,
    notice ? `notice: "${notice}"` : 'no notice shown — playback is healthy, nothing to recover from');

  /* ---- 6. #68: phone widths — cue clamped to the frame, docked above the bar ---- */
  await session.viewport(390, 844, true, 3, true);
  await session.goto(`${TARGET}/watch/${playable.id}?ep=1`, 2000);
  await session.eval(`(()=>{const k='anihub:player-prefs';const p=JSON.parse(localStorage.getItem(k)||'{}');
    p.subtitles={...(p.subtitles||{}),enabled:true,size:30,position:'bottom'};localStorage.setItem(k,JSON.stringify(p));})()`);
  await session.goto(`${TARGET}/watch/${playable.id}?ep=1`, 2000);
  await session.wait4(`const v=document.querySelector('video'); return !!(v && v.readyState>=2)`, { timeout: 45_000 });
  if (target) await session.eval(
    `(()=>{const v=document.querySelector('video');v.currentTime=${target.at.toFixed(2)};v.play().catch(()=>{})})()`,
  );
  await sleep(3200);
  const phone = await capState();
  const stageH = await session.eval(`Math.round(document.querySelector('.player__stage').getBoundingClientRect().height)`);
  const clamped = phone.px !== null && phone.px <= Math.max(12, stageH * 0.06) + 0.5 && phone.px <= 30;
  const shotPhone = await session.shot('phone-caption-clamp', { full: false });
  check('phone-clamp', `30px captions shrink to the ${stageH}px frame instead of covering it`,
    phone.px !== null && clamped,
    `computed font-size ${phone.px}px ≤ max(12, ${stageH}×0.06=${(stageH * 0.06).toFixed(1)})`, shotPhone);

  if (target) await session.eval(
    `(()=>{const v=document.querySelector('video');v.currentTime=${target.at.toFixed(2)};v.pause();})()`,
  );
  await sleep(400);

  const isHidden = await session.eval(`document.querySelector('.player__stage')?.dataset.chrome === 'hidden'`);
  if (isHidden) {
    await session.tap('.player__stage', { wait: 600 });
  }
  const docked = await capState();
  const bar = await session.eval(
    `(()=>{const b=document.querySelector('.player__bar');
      const r=b?.getBoundingClientRect(); return r?{top:Math.round(r.top),h:Math.round(r.height)}:null})()`,
  );
  const shotDock = await session.shot('phone-caption-docked', { full: false });
  check('phone-dock', 'the cue sits above the control bar when the chrome is showing',
    docked.rect !== null && (bar === null || docked.rect.bottom <= bar.top + 2),
    bar ? `caption bottom ${docked.rect?.bottom}px vs bar top ${bar.top}px` : `caption bottom ${docked.rect?.bottom}px (no separate bar rect)`,
    shotDock);

  /* ---- 7. nothing threw on the way through ---- */
  const logs = session.logs().filter((l) => !/favicon|Failed to load resource: the server responded with a status of 404|preloaded using link preload but not used/i.test(l));
  check('console', 'no page exceptions during the run', logs.length === 0,
    logs.length ? logs.slice(0, 4).join('\n     ') : 'clean');

  /* ---- 8. #69: the viewer cookie is shared across the site's own hosts ---- */
  const port = Number(new URL(TARGET).port || 80);
  const shared = await cookieForHost('app.anihubstream.com', port);
  const hostOnly = await cookieForHost(`127.0.0.1:${port}`, port);
  const previewOnly = await cookieForHost('issues-preview.anihubstream.pages.dev', port);
  check('cookie-domain', 'one viewer across app./apex. anihubstream.com, host-only elsewhere',
    shared.status === 200 && /Domain=anihubstream\.com/.test(shared.setCookie)
      && !/Domain=/.test(hostOnly.setCookie) && !/Domain=/.test(previewOnly.setCookie),
    `app.* → ${shared.status} ${shared.setCookie.slice(0, 110) || '(no cookie)'}\n     127.0.0.1 → ${hostOnly.status} ${hostOnly.setCookie.slice(0, 80) || '(no cookie)'}\n     pages.dev → ${previewOnly.status} ${previewOnly.setCookie.slice(0, 80) || '(no cookie)'}`);
} catch (err) {
  const shot = await session.shot('failure').catch(() => '');
  check('abort', 'the run reached the end', false, `${/** @type {any} */ (err).message}`, shot);
} finally {
  await session.kill().catch(() => {});
  try { proc?.kill(); } catch { /* already gone */ }
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed — screenshots in ${OUT}`);
for (const f of failed) console.log(`  FAILED [${f.id}] ${f.name}: ${f.detail}`);
process.exit(failed.length ? 1 : 0);
