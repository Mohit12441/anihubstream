#!/usr/bin/env node
// @ts-check
/**
 * AniVerse one-API command line — exercises the exported features one at a time
 * against the live site.  Nothing here needs AniVerse running.
 *
 *   node cli.mjs search "Solo Leveling"
 *   node cli.mjs browse --limit=5 --type=TV          # HiAnime's catalogue route
 *   node cli.mjs episodes <slug>                     # <provider>:<slug>, any of the six
 *   node cli.mjs sources <episode-ref>               # opaque "anikoto|…" / "aniwatch|…" / "animekai|…" / "animewave|…" / "watchanimeworld|…" / "hianime|…"
 *   node cli.mjs resolve <embed-url>
 *   node cli.mjs dub-check <episode-ref> [--quality=360]   # is the site's /dub its own bytes?
 *   node cli.mjs audio-truth <episode-ref> [--quality=480] # what the container's track list says
 *   node cli.mjs download <search-term> <ep#> <out.ts> [--max-segments=N]
 *
 * --provider selects which module runs (default anikoto); the ref a command
 * takes is provider-shaped, so mixing providers in one chain fails loudly
 * rather than parsing the wrong envelope.
 *
 *   node cli.mjs --provider=aniwatch search "Solo Leveling"
 *   node cli.mjs --provider=aniwatch download "Solo Leveling" 1 out.ts --max-segments=3 --audio=dub
 *   node cli.mjs --provider=hianime download "Frieren" 1 out.ts --max-segments=3 --audio=dub
 *   node cli.mjs --provider=animekai dub-check "animekai|1|https://animekai.be/watch/solo-leveling/ep-1|sub"
 *   node cli.mjs --provider=animewave episodes "animewave:solo-leveling-season-2-arise-from-the-shadow-3eukp"
 *   node cli.mjs --provider=watchanimeworld sources "watchanimeworld|naruto|1|1|https://watchanimeworld.one/episode/naruto-1x1/"
 *   node cli.mjs --provider=watchanimeworld download "naruto" 1 out.mp4 --max-parts=2
 *   node cli.mjs --provider=animedubhindi audio-truth "<animedubhindi|slug|1|https://new.adhlinks.com/episode/…/>"
 *   node cli.mjs --provider=animedubhindi download "slime" 1 out.mkv --max-bytes=300000 --quality=480
 *
 * --provider=hianime also takes the `episodes`/`sources` refs that module stamps
 * ("hianime|<mongoId>|<number>|<audioType>|<slug>"), and its downloads pick a
 * rung by height, which the other four cannot offer.  --provider=animekai takes
 * "animekai|<number>|<episodeUrl>|<audioType>" and --provider=animewave takes
 * "animewave|<serverIds>|<audioType>|<episodeUrl>", both the same ref the AniVerse
 * providers stamp, so a ref from the app works here and vice versa.
 *
 * --provider=watchanimeworld is the one without an embed layer: `sources` prints
 * `direct[]` MP4 renditions (2 MiB token-bearing parts) instead of embed URLs,
 * `resolve` has nothing to resolve, and its `download` stitches parts into a real
 * .mp4 — so it takes --max-parts, not --max-segments.
 *
 * --provider=animedubhindi is the one without HLS at all: its `sources` rows are
 * ad-funnel hand-outs (five mirrors × three renditions per episode), `resolve`
 * walks re.php → the filesforever gate → the workers.dev terminal that serves the
 * MKV, and `download` writes a real Matroska cut with --max-bytes.  Its audio
 * truth is not a sub/dub pair — each upload is ONE Multi Audio file carrying both
 * tracks — so `dub-check` has no pair to measure and `audio-truth` reads the
 * container's own track list instead.
 *
 * download without --max-segments pulls the full episode (tens of minutes,
 * ~2-3 GB for 1080p at the measured ~750 KB/s).  With --max-segments=3 it
 * writes a real, short MPEG-TS that plays, which is what verification uses.
 */
import { parseArgs } from "node:util";
import * as anikoto from "./anikoto.mjs";
import * as aniwatch from "./aniwatch.mjs";
import * as animekai from "./animekai.mjs";
import * as animewave from "./animewave.mjs";
import * as watchanimeworld from "./watchanimeworld.mjs";
import * as animedubhindi from "./animedubhindi.mjs";
import * as hianime from "./hianime.mjs";

const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  "max-segments": { type: "string" },
  "max-parts": { type: "string" },
  "max-bytes": { type: "string" },
  "audio": { type: "string" },
  "provider": { type: "string" },
  "quality": { type: "string" },
  "lang": { type: "string" },
  "peer": { type: "string" },
  "page": { type: "string" },
  "limit": { type: "string" },
  "type": { type: "string" },
  "status": { type: "string" },
  "cursor": { type: "string" },
  "head-bytes": { type: "string" },
} });
const cmd = positionals[0];
const arg = (i) => positionals[i + 1];
const maxSegments = values["max-segments"] !== undefined ? Number(values["max-segments"]) : undefined;
const maxParts = values["max-parts"] !== undefined ? Number(values["max-parts"]) : undefined;
const maxBytes = values["max-bytes"] !== undefined ? Number(values["max-bytes"]) : undefined;
const audioType = values["audio"] === "dub" ? "dub" : values["audio"] === "sub" ? "sub" : undefined;
// Only HiAnime publishes a multi-rung master, so --quality is honoured there.
// The other four expose whatever rungs their own master lists, and the ones
// measured here came back with one (AnimeWave: rungs=1080 on every embed probed).
const quality = values["quality"];

const PROVIDERS = {
  anikoto: { api: anikoto, referer: anikoto.defaultAniKotoReferer, honoursAudioFlag: true },
  aniwatch: { api: aniwatch, referer: aniwatch.defaultAniWatchReferer, honoursAudioFlag: true },
  animekai: { api: animekai, referer: animekai.defaultAnimeKaiReferer, honoursAudioFlag: true },
  animewave: { api: animewave, referer: animewave.defaultAnimeWaveReferer, honoursAudioFlag: true },
  // No embeds, no HLS, no resolve(): its sources() rows are already the bytes.
  watchanimeworld: { api: watchanimeworld, referer: watchanimeworld.defaultWatchAnimeWorldReferer, honoursAudioFlag: true },
  // No HLS either, but the other way round: its rows are ad-funnel hand-outs that
  // resolve() walks to one progressive MKV, and its audio truth is a track count
  // inside that file rather than a sub/dub pair.
  animedubhindi: { api: animedubhindi, referer: animedubhindi.defaultAnimeDubHindiReferer, honoursAudioFlag: true },
  hianime: { api: hianime, referer: hianime.defaultHiAnimeReferer, honoursAudioFlag: true },
};
const providerId = values["provider"] ?? "anikoto";
const provider = PROVIDERS[providerId];
if (!provider) {
  console.error(`FAIL  unknown --provider=${providerId} (expected ${Object.keys(PROVIDERS).join(" | ")})`);
  process.exitCode = 1;
}

/** Abort after `ms` so a hung provider shows up as a timeout, not a stall. */
const signal = AbortSignal.timeout(20 * 60 * 1000);

/**
 * Report a failure and stop the command.  `process.exit()` is deliberately NOT
 * used: while a keep-alive fetch socket is still draining it trips libuv's
 * "handle closing" assertion on Windows (a stack dump and exit 127 instead of the
 * printed line), so the code is set and the loop is left to drain — which is what
 * the success path already does, and the 20-minute timeout timer does not pin it.
 */
const STOP = Symbol("stop");
function fail(message) {
  console.error(`FAIL  ${message}`);
  process.exitCode = 1;
  throw Object.assign(new Error(message), { [STOP]: true });
}

const { search, details, sources, resolve, downloadEpisode, audioPairVerdict } = provider?.api ?? {};
// browse() is exported only by hianime.mjs. The other four publish listing ROUTES
// that were never walked into a contract: AniWatch's REST index has no / listing
// route at all, AniKoto's and AnimeWave's /genre/* + /status/* + /filter pages are
// gap 5 of that export and of animewave.mjs, and AnimeKai has rails plus
// /api/search/suggest but no catalogue contract measured here.
const browse = provider?.api?.browse;
// dubPairVerdict(subEmbed, dubEmbed) measures the BYTES behind the site's `/dub`
// name; every provider exports it, all from the same `dubAudio.mjs` rule.
const dubPairVerdict = provider?.api?.dubPairVerdict;
// download() is provider-independent HLS plumbing with the same name in all three
// modules; the CLI never calls it directly, so it is not pulled out here.

async function run({ api }) {
  try {
    switch (cmd) {
      case "search": {
        const term = arg(0) ?? fail('usage: search "<term>"');
        const hits = await search(term, { signal });
        console.log(`${hits.length} hit(s) for "${term}" on ${providerId}`);
        for (const h of hits.slice(0, 10)) console.log(`  ${h.id}  ${h.title}${h.coverUrl ? "  (cover)" : ""}`);
        break;
      }
      case "browse": {
        if (!browse) fail(`browse: ${providerId} publishes no catalogue route in this export`);
        const b = await browse({
          ...(values.page !== undefined ? { page: Number(values.page) } : {}),
          ...(values.limit !== undefined ? { limit: Number(values.limit) } : {}),
          ...(values.type ? { type: values.type } : {}),
          ...(values.status ? { status: values.status } : {}),
          ...(values.cursor ? { cursor: values.cursor } : {}),
          signal,
        });
        console.log(`${b.results.length} row(s)`
          + (b.total !== undefined ? `  total=${b.total} page=${b.page}/${b.totalPages}` : "")
          + (b.pageSize !== undefined ? `  cursor route, pageSize=${b.pageSize}` : ""));
        for (const r of b.results.slice(0, 12)) {
          console.log(`  ${r.nativeId ?? "-"}  ${r.slug}  ${r.title}${r.episodeCount ? ` (${r.episodeCount} ep)` : ""}${r.audioAvailability ? ` [${r.audioAvailability}]` : ""}`);
        }
        if (b.nextCursor) console.log(`  nextCursor=${b.nextCursor} hasNextPage=${b.hasNextPage}`);
        break;
      }
      case "episodes": {
        const id = arg(0) ?? fail(`usage: episodes <${providerId}-slug>`);
        const { media, episodes } = await details(id, { signal });
        console.log(`${media.title} — ${episodes.length} episode(s)`);
        // The ref is untruncated on purpose: it is the exact input `sources`,
        // `dub-check`, `resolve` and `download` take, so a shortened one is output
        // this command cannot feed back into itself.  Quote it when pasting — the
        // `|` separators are shell metacharacters.
        for (const e of episodes.slice(0, 5)) console.log(`  ep ${e.number}  [${e.audioType}]  ${e.title}\n      ref: ${e.id}`);
        break;
      }
      case "sources": {
        const ref = arg(0) ?? fail("usage: sources <episode-ref>");
        // Every provider here takes the audio as a parameter AND stamps a default on
        // the ref, so --audio overrides what the listing row claimed.
        const { embeds, skip, audioType: resolved, available, direct, mirrors } = await sources(ref, audioType ? { audioType, signal } : { signal });
        // `available` is what the page published per group: on a zero-embed answer it
        // is the difference between "this site has no dub" and "the parse missed".
        console.log(`${embeds.length} embed(s)${direct?.length ? ` + ${direct.length} direct MP4 stream(s)` : ""}${skip ? `  skip=${JSON.stringify(skip)}` : ""}${available ? `  available=${JSON.stringify(available)}` : ""}${audioType ? `  audio=${resolved ?? audioType}${provider.honoursAudioFlag ? "" : " (not honoured by this provider)"}` : ""}`);
        for (const e of embeds) console.log(`  ${e}`);
        // WatchAnimeWorld publishes NO embeds: the decrypted manifest's parts are
        // already the stream, so its answer lives in `direct`.  Both URLs print —
        // `url` is what the app's player is handed (stitched, range-served),
        // `partUrl` is the byte-exact first 2 MiB an operator can curl here.
        for (const d of direct ?? []) {
          console.log(`  ${d.quality}p ${d.codec ?? "-"} ${d.languageLabel ?? d.language ?? "-"}  ${d.sizeBytes}B in ${d.parts}x${d.partBytes}B parts  host=${d.host}`);
          console.log(`      url:  ${d.url}`);
          console.log(`      part: ${d.partUrl}`);
        }
        // AnimeDubHindi's rows are the mirrors of ONE file, not streams: five hosts
        // per rendition, and only the re.php class is a walk this chain owns — the
        // drive pages belong to their own extractors and MEGA needs a client.
        const classify = provider?.api?.classifyMirror;
        for (const m of mirrors ?? []) {
          const kind = classify?.(m.url) ?? "unclassified";
          console.log(`  ${m.quality}p  ${m.marker}  ${kind === "adhlinks-re" ? "walkable here" : kind}  ${m.url}`);
        }
        break;
      }
      case "dub-check": {
        // The site names the audio in the embed path; this asks whether the two
        // paths actually carry two files.  One rung, one segment per side.
        const ref = arg(0) ?? fail('usage: dub-check <episode-ref> [--quality=360]');
        const sub = await sources(ref, { audioType: "sub", signal });
        const dub = await sources(ref, { audioType: "dub", signal });
        console.log(`offered: sub=${sub.embeds.length} dub=${dub.embeds.length} embed(s)`);
        if (!sub.embeds.length || !dub.embeds.length) {
          // Name the side that is missing: sub=0/dub=15 means no SUB group, and a
          // label that reads the wrong one sends an operator down the wrong path.
          console.log(`verdict=n/a  the site hands out no ${sub.embeds.length ? "dub" : "sub"} embed, so there is no pair to measure`
            + (audioPairVerdict ? " — this provider labels LANGUAGES, not sub/dub; run lang-check" : "")
            + (provider?.api?.audioTruth ? " — this site ships both languages inside ONE file; run audio-truth" : ""));
          break;
        }
        const host = (u) => { try { return new URL(u).host; } catch { return ""; } };
        // Same player family on both sides, so a 1080p head is never compared to a
        // 360p head across two unrelated servers.
        const dubEmbed = dub.embeds.find((d) => sub.embeds.some((s) => host(s) === host(d))) ?? dub.embeds[0];
        const subEmbed = sub.embeds.find((s) => host(s) === host(dubEmbed)) ?? sub.embeds[0];
        console.log(`  sub: ${subEmbed}`);
        console.log(`  dub: ${dubEmbed}`);
        const v = await dubPairVerdict(subEmbed, dubEmbed, { ...(quality ? { quality } : {}), ...(values["head-bytes"] ? { headBytes: Number(values["head-bytes"]) } : {}), signal });
        console.log(`verdict=${v.verdict}${v.reason ? `  (${v.reason})` : ""}${v.quality !== undefined ? `  rung=${v.quality}` : ""}`);
        if (v.sub) console.log(`  sub head ${v.sub.got}B of ${v.sub.totalBytes ?? "?"} ${v.sub.md5}`);
        if (v.dub) console.log(`  dub head ${v.dub.got}B of ${v.dub.totalBytes ?? "?"} ${v.dub.md5}`);
        break;
      }
      case "lang-check": {
        // The only audio-honesty measurement WatchAnimeWorld permits: its byte
        // groups are LANGUAGE labels (hin/eng/jpn), not sub/dub, so the question is
        // whether two names point at two files.  Same md5 rule as dub-check.
        if (!audioPairVerdict) fail(`lang-check: ${providerId} does not publish per-language streams; its audio question is a sub/dub one — run dub-check`);
        const ref = arg(0) ?? fail('usage: lang-check <episode-ref> [--lang=hindi] [--peer=english] [--quality=1080]');
        const v = await audioPairVerdict(ref, {
          left: values.lang ?? "hin", right: values.peer ?? "eng",
          ...(quality ? { quality } : {}),
          ...(values["head-bytes"] ? { headBytes: Number(values["head-bytes"]) } : {}),
          signal,
        });
        console.log(`verdict=${v.verdict}${v.reason ? `  (${v.reason})` : ""}${v.quality !== undefined ? `  rung=${v.quality}` : ""}${v.rungExact === false ? " (labels differ)" : ""}`);
        for (const side of [v.left, v.right]) {
          if (!side) continue;
          console.log(`  ${side.language ?? "?"} head ${side.got ?? "?"}B of ${side.totalBytes ?? "?"} ${side.md5 ?? side.error ?? ""}`);
        }
        break;
      }
      case "resolve": {
        // A provider without an embed layer has nothing to resolve: its sources()
        // rows already carry the byte-exact part URLs.
        if (!resolve) fail(`resolve: ${providerId} publishes no embeds — read its sources() direct[] rows instead`);
        const url = arg(0) ?? fail("usage: resolve <embed-url>");
        const r = await resolve(url, { referer: provider.referer, signal });
        console.log(`master: ${r.master.url.slice(0, 120)}…`);
        // A progressive answer says which gate was walked and what the worker's own
        // file name claims, because that claim is the thing audio-truth measures.
        if (r.kind) console.log(`kind: ${r.kind}${r.route ? `  route=${r.route}` : ""}${r.gate ? `  gate=${r.gate}` : ""}`);
        if (r.fileName) console.log(`file: ${r.fileName}${r.audioClaim ? `  claims=${r.audioClaim}` : ""}`);
        for (const v of r.variants) {
          console.log(`  variant ${v.quality}${v.container ? ` ${v.container}` : ""}${v.sizeBytes ? ` ${v.sizeBytes}B` : ""}${v.host ? `  host=${v.host}` : ""}`);
        }
        console.log(`subtitles: ${r.subtitles.length}${r.subtitles.length ? ` (${r.subtitles.map((s) => s.language).join(", ")})` : ""}`);
        if (r.audio) console.log(`audio: ${r.audio}`);
        if (r.skip) console.log(`skip: ${JSON.stringify(r.skip)}`);
        break;
      }
      case "audio-truth": {
        // The container's own track list, read from a ranged head: this site's audio
        // answer lives INSIDE one Multi Audio MKV, so no sub/dub pair exists to hash.
        const audioTruth = provider?.api?.audioTruth;
        if (!audioTruth) fail(`audio-truth: ${providerId} publishes no per-file track reader; its audio question is a sub/dub pair — run dub-check`);
        const ref = arg(0) ?? fail('usage: audio-truth <episode-ref or mirror-url> [--quality=480] [--head-bytes=N]');
        const t = await audioTruth(ref, {
          ...(quality ? { quality } : {}),
          ...(values["head-bytes"] ? { headBytes: Number(values["head-bytes"]) } : {}),
          signal,
        });
        console.log(`verdict=${t.verdict}  provenance=${t.provenance}  claim=${t.claim ?? "none"}${t.quality !== undefined ? `  rung=${t.quality}` : ""}`);
        console.log(`  ${t.reason}`);
        console.log(`  ${t.container}${t.doctype && t.doctype !== t.container ? ` (doctype ${t.doctype})` : ""}  ${t.durationSec ?? "?"}s  head ${t.headBytes}B of ${t.declaredBytes ?? "?"}B`);
        if (t.languages?.length) console.log(`  languages: ${t.languages.join(", ")}`);
        for (const a of t.audioTracks ?? []) console.log(`  audio ${a.number}  ${a.languageTag} (${a.languageName})  ${a.codec}  ${a.name ?? ""}`);
        console.log(`  terminal: ${t.terminal}`);
        break;
      }
      case "download": {
        const term = arg(0), ep = arg(1), out = arg(2);
        if (!term || !ep || !out) fail('usage: download "<term>" <ep#> <out.ts> [--max-segments=N] [--max-parts=N] [--max-bytes=N] [--quality=1080]');
        const res = await downloadEpisode(term, ep, out, {
          signal, maxSegments, maxParts,
          ...(maxBytes === undefined ? {} : { maxBytes }),
          ...(audioType ? { audioType } : {}), ...(quality ? { quality } : {}),
          // MP4 parts are 2 MiB each, not ~5 s of TS, so a "segment" progress line
          // would say something different per provider under the same wording.
          onProgress: (p) => process.stdout.write(p.part !== undefined
            ? `\r  part ${p.part}/${p.of}  ${p.bytes} bytes`
            : p.chunk !== undefined
              ? `\r  chunk ${p.chunk}/${p.of}  ${p.bytes} bytes`
              : `\r  seg ${p.segment}/${p.of}  ${p.bytes} bytes`),
        });
        console.log(`\n${res.media} ep ${res.episode} via ${res.cdn ?? res.host ?? "-"}: ${res.sizeBytes} bytes -> ${res.outPath}  ${res.mimeType}`
          + (res.durationSec !== undefined ? `  ~${res.durationSec}s` : "")
          + (res.parts !== undefined ? `  parts ${res.parts}/${res.totalParts}${res.truncatedByRequest ? " (cut by --max-parts)" : ""}${res.truncatedUpstream ? " (UPSTREAM SHORT)" : ""}` : "")
          + (res.chunks !== undefined ? `  ${res.chunks}/${res.totalChunks} chunks of the declared ${res.declaredBytes}B${res.truncatedByRequest ? " (cut by --max-bytes)" : ""}${res.truncatedUpstream ? " (UPSTREAM SHORT)" : ""}` : ""));
        // audio/quality/rungs/skip are what HiAnime stamps; the other providers
        // answer with fewer fields, so the summary prints only what is there.
        console.log(`  ${[res.audio && `audio=${res.audio}`, res.language && `language=${res.language}`, res.codec && `codec=${res.codec}`,
          res.container && `container=${res.container}`, res.audioClaim && `file claims="${res.audioClaim}" (run audio-truth to measure it)`,
          res.quality && `quality=${res.quality}`, res.rungs?.length && `rungs=${res.rungs.join("/")}`, res.skip && `skip=${JSON.stringify(res.skip)}`]
          .filter(Boolean).join("  ") || "no per-source labels on this provider"}`);
        break;
      }
      case "download-episode": {
        const term = arg(0), ep = arg(1), out = arg(2);
        if (!term || !ep || !out) fail('usage: download-episode "<term>" <ep#> <out.ts> [--quality=1080] [--audio=dub]');
        const res = await downloadEpisode(term, ep, out, {
          signal, ...(audioType ? { audioType } : {}), ...(quality ? { quality } : {}),
          onProgress: (p) => process.stdout.write(`\r  ${p.percent}% ${p.bytes} bytes`),
        });
        console.log(`\n${res.media} ep ${res.episode}: ${res.sizeBytes} bytes -> ${res.outPath}  ${res.mimeType}  ~${res.durationSec}s`);
        if (res.audio) console.log(`  audio=${res.audio}${res.quality ? ` quality=${res.quality} rungs=${(res.rungs ?? []).join("/")}` : ""}`);
        break;
      }
      default:
        console.log("commands: search | browse | episodes | sources | dub-check | lang-check | audio-truth | resolve | download | download-episode");
        console.log('example:  node cli.mjs --provider=aniwatch search "Solo Leveling"');
        console.log('example:  node cli.mjs --provider=hianime browse --limit=5 --type=TV');
        console.log("          (browse is HiAnime-only: the rest publish no catalogue route here)");
        console.log('example:  node cli.mjs --provider=watchanimeworld lang-check "<watchanimeworld|slug|season|number|episodeUrl>"');
        console.log("          (lang-check is WatchAnimeWorld-only: its audio labels are languages, and its dub-check has no sub peer)");
        console.log('example:  node cli.mjs --provider=animedubhindi audio-truth "<animedubhindi|slug|1|https://new.adhlinks.com/episode/…/>" --quality=480');
        console.log("          (audio-truth is AnimeDubHindi-only: it counts the audio tracks inside one Multi Audio MKV)");
    }
  } catch (error) {
    // fail() prints and sets the code itself; the sentinel only says "already
    // reported, stop the case".  Calling fail() from here would throw inside the
    // catch and surface as a module failure, so this branch reports directly.
    if (error?.[STOP]) return;
    console.error(`FAIL  ${error?.code ? `${error.code}: ` : ""}${error?.message ?? error}`);
    process.exitCode = 1;
  }
}

if (provider) await run(provider);
