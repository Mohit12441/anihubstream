// One-shot verification of an exported chain: details -> sources -> resolve ->
// download ONE segment through the real assembly path -> prove it is a playable
// container.  Uses downloadEpisode's per-embed fall-through, so a decoy CDN
// (megap.shiora.top answers with PNGs) is reported and skipped, never
// "completed".
//
//   node verify.mjs                                        # AniKoto, default slug
//   node verify.mjs --provider=aniwatch                    # AniWatch
//   node verify.mjs --provider=aniwatch --audio=dub        # dub embed
//   node verify.mjs "aniwatch:<slug>" --provider=aniwatch
//   node verify.mjs --provider=animekai --audio=dub        # AnimeKai, dub embed
//   node verify.mjs --provider=animewave --audio=dub       # AnimeWave, dub embed
//   node verify.mjs --provider=hianime --audio=dub         # HiAnime, dub embed
//                                                        + is that dub its own bytes?
//   node verify.mjs --provider=watchanimeworld             # NO embeds: probes the
//                                                        abyss parts and stitches one
//   node verify.mjs --provider=watchanimeworld --audio=dub   # NO HLS: walks the ad
//                                                        funnel to one progressive
//                                                        MKV and reads its track list
import { readFile, rm, stat } from "node:fs/promises";
import * as anikoto from "./anikoto.mjs";
import * as aniwatch from "./aniwatch.mjs";
import * as animekai from "./animekai.mjs";
import * as animewave from "./animewave.mjs";
import * as watchanimeworld from "./watchanimeworld.mjs";
import * as hianime from "./hianime.mjs";

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const positional = argv.find((a) => !a.startsWith("--"));

const providerId = opt("provider", "anikoto");
const PROVIDERS = {
  anikoto: { api: anikoto, referer: anikoto.defaultAniKotoReferer, slug: "anikoto:solo-leveling-ilh08" },
  aniwatch: { api: aniwatch, referer: aniwatch.defaultAniWatchReferer, slug: "aniwatch:solo-leveling-season-2-arise-from-the-shadow" },
  animekai: { api: animekai, referer: animekai.defaultAnimeKaiReferer, slug: "animekai:solo-leveling" },
  animewave: { api: animewave, referer: animewave.defaultAnimeWaveReferer, slug: "animewave:solo-leveling-season-2-arise-from-the-shadow-3eukp" },
  hianime: { api: hianime, referer: hianime.defaultHiAnimeReferer, slug: "hianime:solo-leveling-e5tfvj" },
  // A Hindi-dub catalogue: its certainty is Naruto, not whatever is trending, and
  // it is reached by series slug because the site has no numeric-id locator.
  watchanimeworld: { api: watchanimeworld, referer: watchanimeworld.defaultWatchAnimeWorldReferer, slug: "watchanimeworld:naruto", probe: "naruto", defaultAudio: "dub" },
  // Same dub-first catalogue, but its episodes are download funnels: the slug is a
  // live series page and the audio answer lives inside one Multi Audio MKV.
};
const provider = PROVIDERS[providerId];
if (!provider) {
  console.error(`unknown --provider=${providerId} (expected ${Object.keys(PROVIDERS).join(" | ")})`);
  process.exit(1);
}
const { details, sources, resolve, download, sniffContainer } = provider.api;
const audioType = opt("audio", provider.defaultAudio ?? "sub");
const signal = AbortSignal.timeout(10 * 60 * 1000);

const { media, episodes } = await details(positional ?? provider.slug, { signal });
console.log(`provider  : ${providerId} (resolve() stamps provider=${providerId})`);
// The search route is probed by BODY SHAPE, not by res.ok.  Every one of these
// sites answers HTTP 200 for a rejected request too, and a probe that only looks
// at the status reports a live provider as dead — measured on AnimeWave, whose
// header-less search returns 50 bytes of {"status":500,"result":"Bad request"}.
// The default term is one the catalogue certainly has (per provider below), so
// zero hits means the envelope was mis-read, not that the site is thin.
// --probe=<term> overrides.
const probeTerm = opt("probe", provider.probe ?? "solo leveling");
try {
  const hits = await provider.api.search(probeTerm, { signal });
  console.log(`probe     : search("${probeTerm}") -> ${hits.length} hit(s)${hits.length ? "" : "  <-- SHAPE FAULT: a term this broad returning none is how a mis-read envelope looks"}`);
} catch (e) {
  console.log(`probe     : search("${probeTerm}") -> ${e.code ?? "error"}: ${e.message}`);
}
console.log(`details   : "${media.title}" — ${episodes.length} episodes, cover=${media.coverUrl ? "yes" : "no"}, year=${media.year ?? "?"}`);
const ep = episodes[0];
console.log(`episodes  : ep1 #${ep.number} [${ep.audioType}] "${ep.title}" ref=${ep.id}`);

const { embeds, skip, audioType: servedAudio, direct, available, mirrors } = await sources(ep.id, { audioType, signal });
console.log(`sources   : ${embeds.length} embed(s)${direct?.length ? ` + ${direct.length} direct MP4 stream(s)` : ""} for audio=${servedAudio ?? audioType}${skip ? ` skip=${JSON.stringify(skip)}` : ""}${available ? ` available=${JSON.stringify(available)}` : ""}`);
const mirrorRow = new Map((mirrors ?? []).map((m) => [m.url, m]));
for (const e of embeds) console.log(`   ${e}${mirrorRow.has(e) ? `  [${mirrorRow.get(e).quality}p ${mirrorRow.get(e).marker}]` : ""}`);
for (const d of direct ?? []) console.log(`   ${d.quality}p ${d.codec} ${d.languageLabel ?? d.language} ${d.host} ${d.sizeBytes}B/${d.parts}parts`);

// A provider whose sources ARE MP4 parts has no embed to resolve, so the proof is
// run against the parts: re-probe the copy the way the provider did (65 bytes that
// say "plaintext ftyp head, last byte exists"), then fetch part 0 for real and
// sniff the bytes on disk.  Same standard as the HLS path — a container read from
// actual written bytes — with no playlist anywhere in it.
if (!embeds.length && direct?.length && provider.api.probeCopy) {
  const d = direct[0];
  const passed = await provider.api.probeCopy(d.spec, { signal });
  console.log(`probeCopy : ${passed ? "PASS" : "FAIL"} ${d.host} part0 head=ftyp, tail byte of part ${d.parts - 1} exists`);
  let out = `.verify-${providerId}-0.mp4`, ok = false, note = "";
  try {
    const res = await provider.api.download(d.spec, out, { signal, maxParts: 1 });
    const buf = await readFile(out);
    const onDisk = (await stat(out)).size;
    const kind = sniffContainer(buf);
    ok = passed && kind === "mp4" && res.sizeBytes === onDisk && onDisk > 100_000 && !res.truncatedUpstream;
    note = `${kind}, ${res.sizeBytes}B (stat ${onDisk}), declared ${res.declaredBytes}B, sniff@${[0, 4].map((i) => buf[i]?.toString(16).padStart(2, "0")).join("")}`;
  } catch (e) {
    note = `${e.code ?? "error"}: ${e.message}`;
  } finally {
    await rm(out, { force: true });
  }
  console.log(`stitch    : part 0 of ${d.parts} -> ${note}${ok ? " PASS" : " FAIL"}`);
  if (audioType === "dub") {
    const sub = await sources(ep.id, { audioType: "sub", signal });
    console.log(`dub truth : unknown — this site publishes no sub group (sub=${sub.available?.sub ?? 0}), so the pair rule has no peer; provenance stays "claimed" (#145)`);
    // The audio labels here are LANGUAGES, so the measurable question is whether
    // two names point at two files.
    const v = await provider.api.audioPairVerdict(ep.id, { signal });
    console.log(`lang truth: ${v.verdict}${v.reason ? ` (${v.reason})` : ""} rung=${v.quality ?? "-"}${v.rungExact === false ? " (labels differ)" : ""}`
      + (v.left?.md5 ? ` ${v.left.language}=${v.left.md5.slice(0, 8)} ${v.right?.language}=${v.right.md5.slice(0, 8)}` : ""));
  }
  console.log(`VERDICT ${ok ? "PASS" : "FAIL"}: real MP4 bytes on disk from the part pipeline (${note})`);
  process.exit(ok ? 0 : 1);
}
if (!embeds.length) { console.log("NO_EMBEDS"); process.exit(1); }

let ok = false, note = "", out = null;
for (const [i, embed] of embeds.entries()) {
  let line = `resolve[${i}]`;
  try {
    const r = await resolve(embed, { referer: provider.referer, signal });
    const v = r.variants[0];
    if (!v) throw new Error(`${r.extractor ?? "resolver"} offered no variant for this embed`);
    // A progressive row is ONE file: no rung ladder, no segment count, the cap is
    // bytes and the framing proof is the container's own magic.
    const progressive = r.kind === "progressive";
    line += ` ${r.extractor} host=${new URL(v.url).host} q=${v.quality}`
      + (progressive ? ` ${v.container} ${v.sizeBytes ?? "?"}B` : ` rungs=${r.variants.map((x) => x.quality).join("/")}`)
      + ` subs=${r.subtitles.length}${r.audio ? ` audio=${r.audio}` : ""}`;
    out = `.verify-${providerId}-${i}.${progressive ? (v.container === "mp4" ? "mp4" : "mkv") : "ts"}`;
    const res = progressive
      ? await download(v.url, { referer: v.headers?.referer, outPath: out, signal, maxBytes: Number(opt("max-bytes", 300_000)) })
      : await download(v.url, { referer: v.headers?.referer, outPath: out, signal, maxSegments: 1 });
    const buf = await readFile(out);
    const onDisk = (await stat(out)).size;
    const kind = sniffContainer(buf);
    const stride = kind === "mpegts"
      ? [...Array(40)].every((_, k) => buf[k * 188] === 0x47)
      : kind === "mp4"
        ? buf.subarray(4, 8).toString("latin1") === "ftyp"
        : buf.subarray(0, 4).toString("hex") === "1a45dfa3";
    ok = (kind === "mpegts" || kind === "mp4" || kind === "matroska") && stride && res.sizeBytes === onDisk && onDisk > 100_000
      && (!progressive || (!res.truncatedUpstream && res.truncatedByRequest === true));
    note = `${kind}${stride ? ` ${kind === "mpegts" ? "+188-sync" : kind === "mp4" ? "ftyp" : "EBML magic"}` : ""}, ${res.sizeBytes}B (stat ${onDisk})`
      + (progressive ? ` of a declared ${res.declaredBytes}B file, cut by --max-bytes` : "");
    line += ` -> ${note}${ok ? " PASS" : " FAIL"}`;
  } catch (e) { line += ` -> ${e.code ?? "error"}: ${e.message}`; }
  console.log(line);
  // The verdict is the printed byte count and container, not the artifact — and
  // a proof file nobody deletes is how a verification folder fills up.
  if (out) await rm(out, { force: true });
  if (ok) break;
}
// A `/dub` embed that plays is not the same thing as a `/dub` embed that dubs.
// The byte measurement is separate from PASS/FAIL on purpose: the chain working
// and the site being honest about its audio are two claims, and conflating them
// would make a real dub look like a broken export.
if (audioType === "dub") {
  if (provider.api.audioTruth) {
    // This site's audio question is not a pair of embeds: one Multi Audio MKV holds
    // the dub AND the original, so the honest check is the container's own track
    // list — and a head that stops mid-Tracks reports "claimed", not a verdict.
    try {
      const t = await provider.api.audioTruth(ep.id, { signal });
      console.log(`audio truth: ${t.verdict} (${t.provenance}) file claims="${t.claim ?? "none"}" — ${t.reason}`);
      console.log(`           ${t.container} ${t.durationSec ?? "?"}s, ${t.audioTracks.length} audio track(s): ${t.audioTracks.map((a) => a.languageName).join(", ") || "none"}`);
    } catch (e) {
      console.log(`audio truth: ${e.code ?? "error"}: ${e.message}`);
    }
  } else {
    const subEmbeds = (await sources(ep.id, { audioType: "sub", signal })).embeds;
    const host = (u) => { try { return new URL(u).host; } catch { return ""; } };
    const mate = subEmbeds.find((s) => host(s) === host(embeds[0])) ?? subEmbeds[0];
    if (!mate) console.log("dub truth : unknown — the site offers no sub embed to compare against");
    else {
      const v = await provider.api.dubPairVerdict(mate, embeds[0], { referer: provider.referer, signal });
      console.log(`dub truth : ${v.verdict}${v.reason ? ` (${v.reason})` : ""} rung=${v.quality ?? "-"}${v.rungExact === false ? " (labels differ)" : ""} sub=${v.sub?.totalBytes ?? "?"}B dub=${v.dub?.totalBytes ?? "?"}B`);
    }
  }
}
console.log(`VERDICT ${ok ? "PASS" : "FAIL"}: real video container on disk (${note})`);
process.exit(ok ? 0 : 1);
