// @ts-check
/**
 * dubAudio — is the site's `/dub` file a second audio, or the same bytes as its `/sub`?
 *
 * Provider-agnostic: it takes two embed URLs and the calling provider's own
 * `resolve()` function, so one implementation serves AniKoto, AniWatch and
 * HiAnime instead of three copies that drift.
 *
 * Why this exists.  A dub ask is answered with the site's `/dub` embed and
 * nothing else (see each module's `sources()`), and the embed path is the only
 * audio claim the file carries.  That claim can be a lie: the 2026-10-12 census
 * demuxed 14 HiAnime pairs with ffmpeg (`-vn -c copy`, audio stream md5) and the
 * `/dub` master was a byte copy of `/sub` on 5 of them — Solo Leveling, Frieren,
 * Kaiju No. 8, Mushoku Tensei, Spy x Family — and a genuine second audio on the
 * other 9.  Honouring the ask keeps that the *site's* lie rather than ours, but a
 * caller that wants to stop offering the fake needs evidence, not the site's word.
 *
 * The detector, measured the same day on all 14 pairs: compare the FIRST MEDIA
 * SEGMENT of each side by total `Content-Length` and by md5 of its first
 * 256 KiB.  Every fake matched on both (279,932 = 279,932 bytes for Solo
 * Leveling; 885,856 = 885,856 for Frieren) and every real dub differed on both
 * (Vinland Saga 1,308,856 vs 743,352; One Piece 1,161,464 vs 1,155,448).  That
 * reproduces the ffmpeg census on 14 of 14 — no demuxing, one request per side.
 *
 * Run through THIS function on those same 14 titles (2026-10-12, zoko pairs, the
 * shared 1080 rung unless noted): `copy` on all 5 fakes, `distinct` on the 9
 * reals minus one, `unknown` on 1 — Naruto ep 1, whose `/sub` publishes only an
 * `800` rung and whose `/dub` only a `480`, so no label is shared.  `sharedRung`
 * now pairs the best rung each side has in that case, which decides it.
 *
 * Deliberately NOT a `Range` request.  Measured: `hls1.drama1.cfd` answered
 * `range: bytes=0-262143` with a 146-byte body for the `/sub` segment while the
 * plain GET of the same URL served the full 279,932 bytes.  A refused Range
 * turns a copy into "distinct", which is the wrong direction.  So this reads the
 * first 256 KiB of an ordinary 200 response and cancels the body.
 *
 * What the verdicts mean, exactly:
 *   "copy"     — the head bytes are identical and no declared size disagrees.
 *                The site's dub is a duplicate; it carries no second audio.
 *   "distinct" — the two files differ.  NOT proof of English audio: only that the
 *                site is not serving the same file twice.
 *   "unknown"  — one side could not be measured (dead embed, no segment, refused
 *                request, or a head too small to be media at all).  Never a
 *                refusal: a caller must keep whatever it had.
 *
 * The head is sniffed, because a byte pair can be taken off things that are not
 * video.  Measured 2026-10-12: AniKoto's `?s=tcdn` CDN selector sends BOTH `/sub`
 * and `/dub` to `*.tiktokcdn.com`, where every "segment" is a PNG — hashing that
 * would have compared two pictures and reported an audio verdict.  It now answers
 * `unknown (segment unreadable: not media (png) not media (png))`.  So: measure
 * the embeds you actually serve, and treat `unknown` as "not measured", never as
 * "the dub is fine".
 */

import { createHash } from "node:crypto";

const md5 = (bytes) => createHash("md5").update(bytes).digest("hex");

/** Bytes of the head to hash. 256 KiB is what the 14-pair measurement used. */
export const DEFAULT_HEAD_BYTES = 256 * 1024;

/** Below this the "head" is not media, it is an error page — and two error pages
 *  are byte-identical, which would read as a copy. */
export const MIN_MEDIA_HEAD_BYTES = 64 * 1024;

/**
 * The first media URI in a playlist (a `#EXT-X-KEY` line is not a segment).
 *
 * A `#EXT-X-BYTERANGE` line means the next URI is a WINDOW of a bigger file, not
 * a file: hashing it from byte 0 compares whatever precedes that window, so the
 * verdict would be about the wrong bytes. Refusing is the app's rule too
 * (`src/utils/dubAudio.ts`).
 */
export function firstSegmentUri(playlistText, baseUrl) {
  let ranged = false;
  for (const line of String(playlistText).split("\n")) {
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith("#")) {
      if (/^#EXT-X-BYTERANGE:/i.test(t)) ranged = true;
      continue;
    }
    if (ranged) return undefined;
    let url;
    try { url = new URL(t, baseUrl).toString(); } catch { return undefined; }
    return url;
  }
  return undefined;
}

/**
 * The rung to compare on BOTH sides.  Different renditions are different encodes,
 * so a 1080p head against a 360p head would always read "distinct" and the lie
 * would never be caught.  Highest quality present on both, or the requested one.
 *
 * When NO label is shared the best rung of each side is paired and reported with
 * `exact: false` (measured 2026-10-12: Naruto ep 1's zoko `/sub` publishes only
 * `800` and its `/dub` only `480` — the dub encode is a different ladder).  A
 * byte-for-byte match across two labels is still proof of the same file, so this
 * can report `copy`; a mismatch can only ever report `distinct`, which is the
 * safe direction: the fake stays offered rather than a working dub vanishing.
 */
export function sharedRung(subVariants, dubVariants, quality) {
  const key = (v) => String(v?.quality ?? "unknown");
  if (quality !== undefined && quality !== "auto") {
    const s = subVariants.find((v) => key(v) === String(quality));
    const d = dubVariants.find((v) => key(v) === String(quality));
    return s && d ? { quality: String(quality), sub: s, dub: d, exact: true } : undefined;
  }
  for (const v of subVariants) {
    const match = dubVariants.find((d) => key(d) === key(v));
    if (match) return { quality: key(v), sub: v, dub: match, exact: true };
  }
  const s = subVariants[0];
  const d = dubVariants[0];
  return s && d ? { quality: `${key(s)}|${key(d)}`, sub: s, dub: d, exact: false } : undefined;
}

/**
 * What the head bytes actually ARE — see the `?s=tcdn` PNG decoy measured at the
 * top of this file.  An image or a text body is not a track, so `headFingerprint`
 * refuses it instead of hashing it.
 */
export function headContainer(bytes) {
  const b = bytes.subarray(0, 12);
  const hex = [...b.subarray(0, 4)].map((x) => x.toString(16).padStart(2, "0")).join("");
  if (hex.startsWith("89504e47")) return "png";
  if (hex.startsWith("ffd8ff")) return "jpeg";
  if (hex.startsWith("47494638")) return "gif";
  if (b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") return "webp";
  if (hex.startsWith("66747970") || b.subarray(4, 8).toString("latin1") === "ftyp") return "mp4";
  if (hex.startsWith("1a45dfa3")) return "matroska";
  if (hex.startsWith("fff1") || hex.startsWith("fff9")) return "adts";
  if (b[0] === 0x47) return "mpegts";
  const text = b.toString("latin1");
  if (text.startsWith("#EXTM3U") || text.startsWith("<") || text.startsWith("{")) return "text";
  return "unknown";
}

const NON_MEDIA = new Set(["png", "jpeg", "gif", "webp", "text"]);

/**
 * Read at most `limit` bytes of a URL without a Range header, and report the
 * size the server claimed for the whole resource.
 */
export async function headFingerprint(url, { headers, limit = DEFAULT_HEAD_BYTES, signal } = {}) {
  let res;
  try {
    res = await fetch(url, { ...(headers ? { headers } : {}), ...(signal ? { signal } : {}) });
  } catch (error) {
    return { error: `fetch threw: ${String(error?.message ?? error).slice(0, 60)}` };
  }
  if (!res.ok) {
    try { await res.body?.cancel(); } catch { /* already gone */ }
    return { error: `HTTP ${res.status}` };
  }
  const hash = createHash("md5");
  const claimed = Number(res.headers.get("content-length"));
  let got = 0;
  let prefix = Buffer.alloc(0);
  const reader = res.body?.getReader();
  if (!reader) { try { await res.arrayBuffer(); } catch { /* ignore */ } return { error: "no body" }; }
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      const take = Math.min(value.length, limit - got);
      if (take > 0) {
        hash.update(value.subarray(0, take));
        // The signature lives in the first bytes, so keep the head of the head.
        if (prefix.length < 12) prefix = Buffer.concat([prefix, value.subarray(0, Math.min(value.length, 12))]);
      }
      got += take;
      if (got >= limit) break;
    }
  } catch (error) {
    return { error: `read threw: ${String(error?.message ?? error).slice(0, 60)}` };
  } finally {
    try { await reader.cancel(); } catch { /* already closed */ }
  }
  const container = headContainer(prefix);
  if (NON_MEDIA.has(container)) return { error: `not media (${container})` };
  return {
    md5: hash.digest("hex"),
    got,
    container,
    // A truncated read of a 200 response still hashed the whole resource when the
    // resource is smaller than the limit; `claimed` says how big it really is.
    totalBytes: Number.isFinite(claimed) && claimed > 0 ? claimed : undefined,
    contentType: res.headers.get("content-type") ?? "",
  };
}

/**
 * Decide whether two embeds of the SAME episode serve the same bytes.
 *
 * @param {string} subEmbed   the `/sub` embed URL
 * @param {string} dubEmbed   the `/dub` embed URL the site claims is a second audio
 * @param {(embed: string, opts?: {referer?: string, signal?: AbortSignal}) => Promise<{variants: {url: string, quality: unknown, headers?: Record<string, string>}[], master?: {url: string, headers?: Record<string, string>}}>} resolve
 *        the calling provider's own resolver — it knows the tokens and the referer gate
 * @returns {Promise<{verdict: "copy"|"distinct"|"unknown", reason?: string, quality?: string, rungExact?: boolean, sub?: object, dub?: object}>}
 */
export async function comparePair(subEmbed, dubEmbed, resolve, { referer, signal, quality, headBytes } = {}) {
  if (!/^https?:\/\//i.test(String(subEmbed)) || !/^https?:\/\//i.test(String(dubEmbed))) {
    return { verdict: "unknown", reason: "both sides must be http(s) embed URLs" };
  }
  // A caller that ignores the audio group hands the same embed to both asks, and
  // hashing one file against itself reads `copy` — which would delete a dub that
  // works. Two identical starting URLs say nothing about audio, so they say nothing.
  if (String(subEmbed) === String(dubEmbed)) {
    return { verdict: "unknown", reason: "identical embed URL on both sides" };
  }
  let sub, dub;
  try {
    [sub, dub] = await Promise.all([
      resolve(subEmbed, { ...(referer ? { referer } : {}), ...(signal ? { signal } : {}) }),
      resolve(dubEmbed, { ...(referer ? { referer } : {}), ...(signal ? { signal } : {}) }),
    ]);
  } catch (error) {
    return { verdict: "unknown", reason: `resolve failed: ${String(error?.message ?? error).slice(0, 80)}` };
  }
  const rung = sharedRung(sub.variants ?? [], dub.variants ?? [], quality);
  if (!rung) return { verdict: "unknown", reason: "no rendition on both sides" };

  const playlists = await Promise.all([
    getText(rung.sub.url, rung.sub.headers, signal),
    getText(rung.dub.url, rung.dub.headers, signal),
  ]);
  const segments = playlists.map((p, i) =>
    p.text === undefined ? undefined : firstSegmentUri(p.text, i === 0 ? rung.sub.url : rung.dub.url));
  if (!segments[0] || !segments[1]) {
    const why = playlists.map((p) =>
      p.error !== undefined
        ? p.error
        : /#EXT-X-BYTERANGE:/i.test(String(p.text))
          ? "byterange addressed segment"
          : "no media URI");
    return { verdict: "unknown", reason: `no segment URI (${why.join("/")})` };
  }

  const [S, D] = await Promise.all([
    headFingerprint(segments[0], { headers: rung.sub.headers, ...(headBytes ? { limit: headBytes } : {}), ...(signal ? { signal } : {}) }),
    headFingerprint(segments[1], { headers: rung.dub.headers, ...(headBytes ? { limit: headBytes } : {}), ...(signal ? { signal } : {}) }),
  ]);
  if (S.error || D.error) return { verdict: "unknown", reason: `segment unreadable: ${S.error ?? ""} ${D.error ?? ""}`.trim() };

  const measured = { quality: rung.quality, rungExact: rung.exact, sub: S, dub: D };
  // Both sides have to look like media before any byte claim is made, and the
  // floor is UNCONDITIONAL: `hls1.drama1.cfd` answers a refused request with a
  // 146-byte body and declares that size, so two error pages with matching
  // Content-Length would reach the md5 comparison and read `copy`. The smallest
  // real segment head in the 14-pair census claimed 279,932 bytes, so a floor at
  // 64 KiB never fires on a file. `unknown` rather than `distinct`, because a head
  // that small was not measured — and `distinct` is a claim, not an absence of one.
  const smallest = Math.min(S.totalBytes ?? S.got, D.totalBytes ?? D.got);
  if (smallest < MIN_MEDIA_HEAD_BYTES) {
    return {
      verdict: "unknown",
      reason: `head too small to be media (${S.totalBytes ?? S.got}B / ${D.totalBytes ?? D.got}B)`,
      ...measured,
    };
  }
  // Same size AND same head.  A declared size that differs settles it without a hash.
  const sized = S.totalBytes !== undefined && D.totalBytes !== undefined;
  if (sized && S.totalBytes !== D.totalBytes) {
    return { verdict: "distinct", ...measured };
  }
  return { verdict: S.md5 === D.md5 ? "copy" : "distinct", ...measured };
}

async function getText(url, headers, signal) {
  try {
    const res = await fetch(url, { ...(headers ? { headers } : {}), ...(signal ? { signal } : {}) });
    if (!res.ok) return { error: `playlist HTTP ${res.status}` };
    return { text: await res.text() };
  } catch (error) {
    return { error: `playlist threw: ${String(error?.message ?? error).slice(0, 60)}` };
  }
}

/**
 * Bind `comparePair` to one provider's resolver so callers get a
 * `dubPairVerdict(subEmbed, dubEmbed, opts)` with the provider's own default
 * referer.  Each provider module exports the result of this call.
 */
export function makeDubPairVerdict(resolve, defaultReferer) {
  return (subEmbed, dubEmbed, opts = {}) =>
    comparePair(subEmbed, dubEmbed, resolve, {
      referer: opts.referer ?? defaultReferer,
      ...(opts.signal === undefined ? {} : { signal: opts.signal }),
      ...(opts.quality === undefined ? {} : { quality: opts.quality }),
      ...(opts.headBytes === undefined ? {} : { headBytes: opts.headBytes }),
    });
}

/**
 * @typedef {Object} DubAudit
 * @property {string[]} copy      hosts measured to be serving the `/sub` bytes
 * @property {string[]} distinct  hosts whose two groups are different files
 */

/**
 * What a caller can honestly say about an audio label it is about to hand on.
 * Same rule as the app (`src/utils/dubAudio.ts`), so both surfaces read one
 * measurement the same way:
 *   "claimed"            the label is the site's word alone.
 *   "measured"           a byte comparison left it standing.
 *   "measured-corrected" a byte comparison moved it — a dub that is the sub file.
 *
 * `claimed` also covers "looked and could not tell": `unknown` never enters the
 * record above, and a refused request must not read as a confirmed one.  An
 * extractor named in BOTH lists is two passes that disagreed, so nothing is
 * settled and the claim stands untouched.
 *
 * @param {string} extractorId
 * @param {boolean} claimedDub whether the label being justified says "dub"
 * @param {DubAudit | undefined} audit
 * @returns {"claimed" | "measured" | "measured-corrected"}
 */
export function dubProvenanceOf(extractorId, claimedDub, audit) {
  if (!audit) return "claimed";
  const copy = audit.copy.includes(extractorId);
  const distinct = audit.distinct.includes(extractorId);
  if (copy && distinct) return "claimed";
  if (copy) return claimedDub ? "measured-corrected" : "measured";
  if (distinct) return claimedDub ? "measured" : "claimed";
  return "claimed";
}
