// Offline pins for the shared dub-measurement rule (`dubAudio.mjs`).
//
// The rule lives in two places — here and the app's `src/utils/dubAudio.ts` — and
// before this file existed both were proven only by live runs against
// zokoanime/megaplay, so a regression surfaced when a third-party site happened to
// be up. Everything below runs against a stubbed `fetch` and answers the same on a
// train. Census numbers are quoted verbatim from `api/README.md`; a change to the
// rule has to be argued against a measurement, not against a round number.
//
// Five groups, in the order the rule needs them:
//   harness    the stub is the transport the rule runs on — a broken stub would
//              pass every case below, so it is pinned first
//   pure       the three helpers that decide shapes without a request
//   matrix     one case per row the 2026-10-12/13 census measured, sizes included
//   refusals   every path that must answer `unknown` and store nothing
//   invariant  the measurement layer and the labelling layer cannot disagree
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  comparePair,
  DEFAULT_HEAD_BYTES,
  dubProvenanceOf,
  firstSegmentUri,
  headContainer,
  MIN_MEDIA_HEAD_BYTES,
  sharedRung,
} from "./dubAudio.mjs";

const md5 = (bytes) => createHash("md5").update(bytes).digest("hex");

/**
 * A body big enough to clear the media floor. `size` is the resource size the
 * server declares; the module hashes at most `DEFAULT_HEAD_BYTES` of it, so a
 * 4.7 MB census row is built 256 KiB long and declared at its measured size.
 */
function tsSegment(fill, size = DEFAULT_HEAD_BYTES) {
  const body = Buffer.alloc(Math.min(size, DEFAULT_HEAD_BYTES) || size);
  body[0] = 0x47; // MPEG-TS sync byte: the sniff must call this media
  body.fill(fill, 1);
  return body;
}

function pngSegment(fill, size = 626_292) {
  const body = tsSegment(fill, size);
  body.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  return body;
}

/** Which read method the module used, so the harness can prove it matched it. */
const transport = { reads: [] };

function response({ body, status = 200, contentLength, contentType = "application/octet-stream" }) {
  const bytes = typeof body === "string" ? Buffer.from(body, "latin1") : body;
  const headers = new Map([["content-type", contentType]]);
  if (contentLength !== undefined) headers.set("content-length", String(contentLength));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers.get(String(name).toLowerCase()) ?? null },
    // `headFingerprint` reads the stream and cancels it — no Range header is
    // involved anywhere, which is itself one of the measured guards.
    text: async () => {
      transport.reads.push("text");
      return bytes.toString("latin1");
    },
    body: {
      getReader: () => {
        let sent = false;
        return {
          read: async () => {
            if (sent) return { done: true, value: undefined };
            sent = true;
            transport.reads.push("stream");
            return { done: false, value: bytes };
          },
          cancel: async () => {},
        };
      },
    },
  };
}

/** Install a URL router for the duration of `fn`, and record every request. */
async function withFetch(routes, fn) {
  const calls = [];
  transport.reads = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    const route = routes[String(url)];
    if (route === undefined) return response({ body: "not routed", status: 404 });
    return typeof route === "function" ? route({ url: String(url), options }) : route;
  };
  try {
    return await fn(routes, calls);
  } finally {
    globalThis.fetch = real;
  }
}

/**
 * One rendition playlist per side plus the segment it names — the shape zoko and
 * megaplay answer with. `resolve` is the provider's own resolver: the module hands
 * it embed URLs and gets variants back, then fetches the playlist TEXT itself.
 */
function pair(subSegment, dubSegment, {
  subSize, dubSize,
  subQuality = "1080", dubQuality = "1080",
  playlist = (seg) => seg,
} = {}) {
  const subSeg = "https://cdn.example/sub/seg.ts";
  const dubSeg = "https://cdn.example/dub/seg.ts";
  const subPl = "https://cdn.example/sub.m3u8";
  const dubPl = "https://cdn.example/dub.m3u8";
  const body = (bytes, size) => response({
    body: bytes,
    ...(size === undefined ? {} : { contentLength: size }),
  });
  return {
    [subSeg]: body(subSegment, subSize),
    [dubSeg]: body(dubSegment, dubSize),
    [subPl]: response({ body: playlist(`#EXTM3U\n#EXTINF:24,\n${subSeg}\n`), contentType: "application/x-mpegURL" }),
    [dubPl]: response({ body: playlist(`#EXTM3U\n#EXTINF:24,\n${dubSeg}\n`), contentType: "application/x-mpegURL" }),
    subEmbed: "https://player.example/stream/mal/1/sub",
    dubEmbed: "https://player.example/stream/mal/1/dub",
    resolve: async (embed) => {
      const isSub = embed.endsWith("sub");
      return {
        master: { url: isSub ? subPl : dubPl },
        variants: [{ url: isSub ? subPl : dubPl, quality: isSub ? subQuality : dubQuality }],
      };
    },
  };
}

async function verdict(routes, options = {}) {
  return comparePair(routes.subEmbed, routes.dubEmbed, routes.resolve, options);
}

/**
 * What a consumer stores about one host (`runDubAudit` in the app): only `copy`
 * and `distinct` earn a name, because `unknown` is an absence of measurement and
 * storing an absence would read back as a confirmed answer.
 */
function recordOf(measured, extractorId, prior = { copy: [], distinct: [] }) {
  if (measured === "copy") return { ...prior, copy: [...prior.copy, extractorId] };
  if (measured === "distinct") return { ...prior, distinct: [...prior.distinct, extractorId] };
  return prior;
}

describe("harness: the stub is the transport the rule runs on", () => {
  it("reads a playlist as text and a segment as a stream, over plain GETs", async () => {
    // Measured: `hls1.drama1.cfd` answers `range: bytes=0-262143` with a 146-byte
    // body while the plain GET of the same URL serves 279,932. A refused Range
    // turns a copy into `distinct`, which is the wrong direction — so the rule
    // reads an ordinary 200 and cancels. This case inspects the headers actually
    // sent and the read method actually used; if the stub drifted from the real
    // shape, every case below would pass for the wrong reason.
    const same = tsSegment(0xa1);
    await withFetch(pair(same, same, { subSize: 279_932, dubSize: 279_932 }), async (routes, calls) => {
      await verdict(routes);
      assert.equal(transport.reads.filter((kind) => kind === "text").length, 2, "both playlists read as text");
      assert.equal(transport.reads.filter((kind) => kind === "stream").length, 2, "both segments read as streams");
      assert.equal(calls.length, 4, "two playlists then two segments");
      for (const call of calls) {
        const headers = call.options.headers ?? {};
        assert.equal(
          Object.keys(headers).find((name) => name.toLowerCase() === "range"),
          undefined,
          `a Range header was sent: ${JSON.stringify(headers)}`,
        );
        assert.equal(call.options.method, undefined, "no method override — an ordinary GET");
      }
      assert.ok(calls.some((call) => call.url.endsWith("seg.ts")), "the segment was fetched");
    });
  });

  it("an unrouted URL fails loudly instead of passing quietly", async () => {
    // Nothing is registered, so both playlist GETs are 404s. If the stub answered
    // 200-with-nothing, the whole file would be measuring an empty object.
    const routes = { ...pair(tsSegment(0xa1), tsSegment(0xa1)) };
    delete routes["https://cdn.example/sub.m3u8"];
    await withFetch(routes, async (r) => {
      const v = await verdict(r);
      assert.equal(v.verdict, "unknown");
      assert.match(String(v.reason), /playlist HTTP 404/);
    });
  });
});

describe("pure: the helpers that decide shapes with no request", () => {
  it("firstSegmentUri: the shapes the CDNs actually answer with", () => {
    assert.equal(firstSegmentUri("#EXTM3U\n", "https://x/m.m3u8"), undefined, "a header-only playlist names nothing");
    assert.equal(firstSegmentUri("", "https://x/m.m3u8"), undefined);
    assert.equal(
      firstSegmentUri("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\n#EXT-X-KEY:METHOD=AES-128,URI=\"k\"\nseg.ts\n", "https://x/y/m.m3u8"),
      "https://x/y/seg.ts",
      "a comment line is not a segment; a relative URI resolves against the playlist",
    );
    assert.equal(
      firstSegmentUri("#EXTM3U\n  https://cdn.other/seg.ts  \n", "https://x/m.m3u8"),
      "https://cdn.other/seg.ts",
      "an absolute URI is not rewritten, and surrounding space is trimmed",
    );
    assert.equal(firstSegmentUri("#EXTM3U\n#EXT-X-BYTERANGE:64@0\nseg.ts\n", "https://x/m.m3u8"), undefined);
    assert.equal(firstSegmentUri("#EXTM3U\nhttp://\n", "https://x/m.m3u8"), undefined, "an unparseable URI is not guessed at");
    // A PNG-named segment is NOT refused here — the parser's job is the URI, and
    // refusing a picture is the sniffer's (`headContainer` below, `NON_MEDIA` in
    // `headFingerprint`). Pinning which half owns it keeps the two from both
    // thinking they handled the decoy.
    assert.equal(
      firstSegmentUri("#EXTM3U\nhttps://x/p.png\n", "https://x/m.m3u8"),
      "https://x/p.png",
      "the URI is returned; the media check is a later step",
    );
  });

  it("sharedRung: pair the same ladder, and say so when you cannot", () => {
    const rung = (quality) => ({ url: `https://x/${quality}.m3u8`, quality });
    // Variant lists are best-first, so the first label found on both sides is the
    // highest one they share — pairing 1080 against 360 would always read
    // "distinct" and the lie would never be caught.
    assert.equal(sharedRung([rung("1080"), rung("360")], [rung("1080"), rung("480")], undefined).quality, "1080");
    assert.equal(
      sharedRung([rung("1080"), rung("360")], [rung("360")], undefined).quality,
      "360",
      "the top rung the two actually share, not the top rung either side has",
    );
    const asked = sharedRung([rung("1080"), rung("480")], [rung("1080"), rung("480")], "480");
    assert.equal(asked.quality, "480");
    assert.equal(asked.exact, true, "an explicitly requested rung is honoured");
    assert.equal(sharedRung([rung("1080")], [rung("480")], "1080"), undefined, "a rung one side lacks cannot be compared");
    // Measured 2026-10-12: Naruto ep 1 publishes `800` on /sub and `480` on /dub —
    // the dub encode is a different ladder. Best of each is paired and admitted.
    const across = sharedRung([rung("800")], [rung("480")], undefined);
    assert.equal(across.quality, "800|480");
    assert.equal(across.exact, false);
    assert.equal(sharedRung([], [rung("480")]), undefined);
  });

  it("headContainer: the magic numbers the census saw, and the decoys", () => {
    const ascii = (text) => Buffer.from(text.padEnd(12, "\0"), "latin1");
    assert.equal(headContainer(Buffer.from([0x47, 0x40, 0x00, 0x10])), "mpegts");
    assert.equal(headContainer(Buffer.from([0xff, 0xf1, 0x00, 0x00])), "adts");
    assert.equal(headContainer(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0])), "matroska");
    assert.equal(headContainer(ascii("\0\0\0 ftypisom")), "mp4");
    assert.equal(headContainer(ascii("RIFF\0\0\0\0WEBP")), "webp");
    assert.equal(headContainer(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "png");
    assert.equal(headContainer(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), "jpeg");
    assert.equal(headContainer(ascii("GIF89a")), "gif");
    assert.equal(headContainer(ascii("#EXTM3U")), "text");
    assert.equal(headContainer(ascii("<!doctype html>")), "text");
    assert.equal(headContainer(ascii("{}")), "text");
    assert.equal(headContainer(ascii("Not Found")), "unknown");
  });
});

describe("matrix: one case per row the census measured", () => {
  // `.tmp-runtime/dubcheck-census.mjs` (2026-10-12, 14 zoko pairs, ffmpeg-demuxed
  // first) and `.tmp-runtime/dub-crosssite-census.mjs` (2026-10-13, 10 new titles
  // per provider). `match=14 miss=0 unmeasured=0`: the head comparison reproduces
  // the demux on every row, which is why the cheap check is allowed to decide.
  const CENSUS = [
    // The five fakes the original census named, plus the two it never saw.
    { row: "Solo Leveling  (HiAnime/zoko, fake)", subSize: 1_022_156, dubSize: 1_022_156, sameHead: true, expect: "copy" },
    { row: "Frieren        (HiAnime/zoko, fake)", subSize: 3_807_752, dubSize: 3_807_752, sameHead: true, expect: "copy" },
    { row: "Kaiju No. 8    (HiAnime/zoko, fake)", subSize: 2_604_552, dubSize: 2_604_552, sameHead: true, expect: "copy" },
    { row: "Mushoku Tensei (HiAnime/zoko, fake)", subSize: 3_809_068, dubSize: 3_809_068, sameHead: true, expect: "copy" },
    { row: "Spy x Family   (HiAnime/zoko, fake)", subSize: 4_564_076, dubSize: 4_564_076, sameHead: true, expect: "copy" },
    { row: "Sakamoto Days  (HiAnime/zoko, fake first seen 2026-10-13)", subSize: 1_420_340, dubSize: 1_420_340, sameHead: true, expect: "copy" },
    { row: "Hell's Paradise (HiAnime/zoko, fake first seen 2026-10-13)", subSize: 4_742_488, dubSize: 4_742_488, sameHead: true, expect: "copy" },
    // The nine real seconds: every one differs on BOTH size and head, so the size
    // test alone settles them and the hash is never reached.
    { row: "Vinland Saga   (HiAnime/zoko, real)", subSize: 1_308_856, dubSize: 743_352, sameHead: false, expect: "distinct" },
    { row: "Demon Slayer   (HiAnime/zoko, real)", subSize: 1_892_784, dubSize: 538_808, sameHead: false, expect: "distinct" },
    { row: "Jujutsu Kaisen (HiAnime/zoko, real)", subSize: 259_064, dubSize: 295_160, sameHead: false, expect: "distinct" },
    { row: "Chainsaw Man   (HiAnime/zoko, real)", subSize: 385_400, dubSize: 379_384, sameHead: false, expect: "distinct" },
    { row: "Oshi no Ko     (HiAnime/zoko, real)", subSize: 2_265_588, dubSize: 1_088_708, sameHead: false, expect: "distinct" },
    { row: "One Piece      (HiAnime/zoko, real)", subSize: 1_161_464, dubSize: 1_155_448, sameHead: false, expect: "distinct" },
    { row: "Attack on Titan(HiAnime/zoko, real)", subSize: 836_600, dubSize: 1_134_392, sameHead: false, expect: "distinct" },
    { row: "A Silent Voice (HiAnime/zoko, real, 1036 ladder)", subSize: 2_006_712, dubSize: 2_000_696, sameHead: false, subQuality: "1036", dubQuality: "1036", expect: "distinct" },
    // The row that was `unknown` before best-of-each pairing: no shared label.
    { row: "Naruto ep 1    (HiAnime/zoko, 800 vs 480 ladders)", subSize: 238_008, dubSize: 1_149_432, sameHead: false, subQuality: "800", dubQuality: "480", rungExact: false, expect: "distinct" },
    // The only deliberate probe in the census: identical heads, different sizes.
    // Only the declared size can decide this one, and it must.
    { row: "Vinland Saga   (probe: identical heads, differing sizes)", subSize: 1_308_856, dubSize: 743_352, sameHead: true, expect: "distinct" },
    // AniWatch 2026-10-13: `nexabloom` answers with no Content-Length, so the size
    // test cannot run and the hash alone decides — 7 of 10 pairs read exactly
    // 262,144 B, the read limit rather than a declared size.
    { row: "Apothecary Diaries (AniWatch/megaplay, no declared size)", sameHead: false, expect: "distinct", undeclared: true },
    { row: "Solo Leveling      (AniWatch/megaplay, no declared size, identical heads)", sameHead: true, expect: "copy", undeclared: true },
  ];

  for (const c of CENSUS) {
    it(c.row, async () => {
      const size = c.undeclared ? DEFAULT_HEAD_BYTES : Math.min(c.subSize, c.dubSize);
      const a = tsSegment(0xa1, size);
      const b = c.sameHead ? a : tsSegment(0xb7, size);
      const routes = pair(a, b, {
        ...(c.undeclared ? {} : { subSize: c.subSize, dubSize: c.dubSize }),
        subQuality: c.subQuality ?? "1080",
        dubQuality: c.dubQuality ?? "1080",
      });
      await withFetch(routes, async (r) => {
        const v = await verdict(r);
        assert.equal(v.verdict, c.expect, `${c.row}: ${v.reason ?? ""}`);
        if (c.rungExact !== undefined) assert.equal(v.rungExact, c.rungExact);
        if (c.undeclared) {
          assert.equal(v.sub.totalBytes, undefined);
          assert.equal(v.sub.got, DEFAULT_HEAD_BYTES, "the read stopped at the limit, as designed");
        }
      });
    });
  }

  it("the head hash is over the bytes a player would read", async () => {
    // Pins what `copy` actually claims: md5 of the first 256 KiB, not of the whole
    // file, so the census number stays reproducible by anyone re-running it.
    const size = DEFAULT_HEAD_BYTES + 1024;
    const body = tsSegment(0xe5, size);
    const routes = pair(body, body, { subSize: size, dubSize: size });
    await withFetch(routes, async (r) => {
      const v = await verdict(r);
      assert.equal(v.sub.got, DEFAULT_HEAD_BYTES);
      assert.equal(v.sub.md5, md5(body.subarray(0, DEFAULT_HEAD_BYTES)));
      assert.equal(v.sub.totalBytes, size);
      assert.equal(v.verdict, "copy");
    });
  });

  it("the floor is a floor, not a ceiling", async () => {
    // The smallest real segment head in the census claimed 279,932 B; a resource
    // of exactly the floor is media and must be judged, not excused.
    assert.equal(MIN_MEDIA_HEAD_BYTES, 64 * 1024);
    const at = tsSegment(0xb2, MIN_MEDIA_HEAD_BYTES);
    await withFetch(pair(at, at, { subSize: MIN_MEDIA_HEAD_BYTES, dubSize: MIN_MEDIA_HEAD_BYTES }), async (r) => {
      assert.equal((await verdict(r)).verdict, "copy");
    });
    const under = tsSegment(0xb2, MIN_MEDIA_HEAD_BYTES - 1);
    await withFetch(pair(under, under, { subSize: MIN_MEDIA_HEAD_BYTES - 1, dubSize: MIN_MEDIA_HEAD_BYTES - 1 }), async (r) => {
      assert.equal((await verdict(r)).verdict, "unknown");
    });
  });
});

describe("refusals: the paths that must not accuse", () => {
  // Every case here answers `unknown`, and `unknown` is never stored — the reason
  // a refusal reads back as `claimed` rather than as a confirmed label.
  it("two error pages are never an accusation", async () => {
    // Measured: `hls1.drama1.cfd` answers a refused request with a 146-byte body
    // and DECLARES that size — two error pages match on size and md5 and would
    // read as a copy, which deletes a dub that works. The floor sits before both
    // byte tests and is unconditional.
    const page = tsSegment(0x00, 146);
    await withFetch(pair(page, page, { subSize: 146, dubSize: 146 }), async (r) => {
      const v = await verdict(r);
      assert.equal(v.verdict, "unknown");
      assert.match(String(v.reason), /head too small to be media \(146B \/ 146B\)/);
    });
  });

  it("the PNG decoy is refused instead of hashed", async () => {
    // Measured: AniKoto's `?s=tcdn` routes BOTH `/sub` and `/dub` to
    // `*.tiktokcdn.com`, where every "segment" is a PNG (626,292 / 857,908 bytes).
    // Re-measured 2026-10-13: that is 8 of 8 AniKoto pairs that produced a pair at
    // all — the whole provider is unmeasurable this way, and `unknown` is what it
    // must answer. Hashing two pictures would have printed an audio verdict.
    await withFetch(pair(pngSegment(0xab), pngSegment(0xab), { subSize: 626_292, dubSize: 857_908 }), async (r) => {
      const v = await verdict(r);
      assert.equal(v.verdict, "unknown");
      assert.match(String(v.reason), /not media \(png\) not media \(png\)/);
    });
  });

  it("an embed handed to both asks says nothing about audio", async () => {
    // A provider that ignores the audio group answers the sub ask and the dub ask
    // with one URL. Hashing a file against itself reads `copy`, which would delete
    // a dub that works — so identical starting URLs are refused before any request.
    let touched = 0;
    await withFetch({ "https://cdn.example/x.m3u8": () => (touched++, response({ body: "#EXTM3U\n" })) }, async () => {
      const v = await comparePair(
        "https://player.example/stream/mal/1/sub?token=AAA",
        "https://player.example/stream/mal/1/sub?token=AAA",
        async () => {
          touched++;
          return { variants: [] };
        },
      );
      assert.equal(v.verdict, "unknown");
      assert.match(String(v.reason), /identical embed URL on both sides/);
      assert.equal(touched, 0, "nothing may be fetched for a pair that was refused");
    });
  });

  it("two different query strings on one path are still a pair worth measuring", async () => {
    // The refusal above is exact-string only, and that is the whole rule: the same
    // file reached under two tokens is exactly the fake the census found, so it
    // must be measured — and measured as a copy.
    const same = tsSegment(0xc3, 300_000);
    const routes = pair(same, same, { subSize: 300_000, dubSize: 300_000 });
    await withFetch(routes, async (r) => {
      const v = await comparePair(`${r.subEmbed}?t=1`, `${r.dubEmbed}?t=2`, r.resolve);
      assert.equal(v.verdict, "copy");
    });
  });

  it("a pair that is not two http(s) URLs is not a pair", async () => {
    // The guard is on the input, not the resolver: a provider handing back a
    // `data:` or a relative path would otherwise reach `new URL` inside the
    // playlist resolver and read as a missing segment.
    const v = await comparePair("/stream/mal/1/sub", "https://player.example/mal/1/dub", async () => ({ variants: [] }));
    assert.equal(v.verdict, "unknown");
    assert.match(String(v.reason), /both sides must be http\(s\) embed URLs/);
  });

  it("a playlist that never names a file is not measured", async () => {
    const seg = tsSegment(0xd4, 279_932);
    await withFetch(pair(seg, seg, { subSize: 279_932, dubSize: 279_932, playlist: () => "#EXTM3U\n#EXT-X-KEY:METHOD=NONE\n" }), async (r) => {
      const v = await verdict(r);
      assert.equal(v.verdict, "unknown");
      assert.match(String(v.reason), /no segment URI/);
    });
  });

  it("a byterange window is a slice, not a track", async () => {
    // `#EXT-X-BYTERANGE` means the next URI is a window into a bigger file (fMP4
    // streams address every segment inside one .m4s). Reading it from byte 0 hashes
    // whatever precedes the window, so the verdict would be about the wrong bytes.
    const seg = tsSegment(0xd4, 279_932);
    const ranged = (uri) => `#EXTM3U\n#EXT-X-BYTERANGE:512000@0\n${uri}\n`;
    await withFetch(pair(seg, seg, { subSize: 279_932, dubSize: 279_932, playlist: ranged }), async (r) => {
      const v = await verdict(r);
      assert.equal(v.verdict, "unknown");
      assert.match(String(v.reason), /byterange addressed segment/);
    });
  });

  it("a resolver that throws answers unknown, never a verdict", async () => {
    // Measured 2026-10-13 on AniWatch: `my.1anime.site` served an embed page with
    // no `#megaplay-player[data-id]` — one of nine unmeasurable slots that evening,
    // a site change rather than a fake dub.
    const v = await comparePair(
      "https://player.example/stream/a/sub",
      "https://player.example/stream/a/dub",
      async () => {
        throw new Error("no #megaplay-player[data-id] on embed page");
      },
    );
    assert.equal(v.verdict, "unknown");
    assert.match(String(v.reason), /resolve failed/);
  });

  it("no rendition on both sides is not a verdict either", async () => {
    const routes = pair(tsSegment(0xa1), tsSegment(0xa1));
    await withFetch(routes, async (r) => {
      const v = await comparePair(
        r.subEmbed, r.dubEmbed,
        async (embed) => (embed.endsWith("sub") ? { variants: [{ url: r.subEmbed, quality: "1080" }] } : { variants: [] }),
      );
      assert.equal(v.verdict, "unknown");
      assert.match(String(v.reason), /no rendition on both sides/);
    });
  });
});

describe("invariant: one measurement, one reading", () => {
  // The app puts `dubProvenance` beside its `isDub` boolean, and the same function
  // runs there (`src/utils/dubAudio.ts`) and here. These cases are why: the player
  // and the series pill must not get two answers out of one audit.
  it("the label says what the measurement said about it", () => {
    const audit = (copy, distinct) => ({ copy, distinct });
    // The mapping is the measurement's, not the site's: `copy` on a dub claim is
    // the CORRECTION (the site promised English, the bytes are the sub file),
    // `distinct` is the claim HOLDING, and `unknown` never reached a record at all.
    const cases = [
      [undefined, "claimed"],
      [audit([], []), "claimed"],
      [audit(["zoko"], []), "measured-corrected"],
      [audit([], ["zoko"]), "measured"],
      [audit(["zoko"], ["zoko"]), "claimed"],
    ];
    for (const [record, expected] of cases) {
      assert.equal(dubProvenanceOf("zoko", true, record), expected, `dub claim, record ${JSON.stringify(record)}`);
    }
    // A sub label is the other half of the same pair: `copy` confirms it, `distinct`
    // says nothing about which of the two files this row is.
    assert.equal(dubProvenanceOf("zoko", false, audit(["zoko"], [])), "measured");
    assert.equal(dubProvenanceOf("zoko", false, audit([], ["zoko"])), "claimed");
    // A verdict about another host is not evidence about this one.
    assert.equal(dubProvenanceOf("megaplay", true, audit(["zoko"], [])), "claimed");
  });

  it("pipeline: a real copy verdict lands on exactly one label", async () => {
    // The case that earns its keep: no invented record. Sakamoto Days' measured
    // pair (1,420,340 = 1,420,340) runs through `comparePair`, the answer is
    // projected into a record the way a consumer stores it, and the labelling layer
    // must read it as a correction of the dub claim — while saying nothing about a
    // second host, and nothing that moves the stream itself.
    const same = tsSegment(0xa1, 1_420_340);
    await withFetch(pair(same, same, { subSize: 1_420_340, dubSize: 1_420_340 }), async (r) => {
      const v = await verdict(r);
      assert.equal(v.verdict, "copy");
      const record = recordOf(v.verdict, "zokoanime");
      assert.deepEqual(record, { copy: ["zokoanime"], distinct: [] });
      assert.equal(dubProvenanceOf("zokoanime", true, record), "measured-corrected");
      assert.equal(dubProvenanceOf("zokoanime", false, record), "measured", "the same bytes confirm the sub label");
      assert.equal(dubProvenanceOf("megaplay", true, record), "claimed", "one host's fake is not another host's");
      // The measurement describes the bytes it read; nothing here names a URL to
      // drop, which is why `copy` can only ever relabel.
      assert.equal(v.sub.container, "mpegts");
      assert.equal(v.dub.md5, v.sub.md5);
    });
  });

  it("pipeline: a real distinct verdict leaves the claim standing", async () => {
    const a = tsSegment(0xa1, 1_161_464);
    const b = tsSegment(0xb7, 1_155_448);
    await withFetch(pair(a, b, { subSize: 1_161_464, dubSize: 1_155_448 }), async (r) => {
      const v = await verdict(r);
      assert.equal(v.verdict, "distinct");
      assert.equal(dubProvenanceOf("zokoanime", true, recordOf(v.verdict, "zokoanime")), "measured");
      assert.equal(dubProvenanceOf("zokoanime", false, recordOf(v.verdict, "zokoanime")), "claimed");
    });
  });

  it("pipeline: every refusal leaves the site's word unmeasured", async () => {
    // `unknown` is the absence of a measurement, and the only honest provenance
    // for an absence is `claimed`. Both halves are pinned: the module refuses, and
    // the record that a refusal produces is empty.
    const refusals = await Promise.all([
      comparePair("https://p/sub", "https://p/sub", async () => ({ variants: [] })),
      comparePair("/relative", "https://p/dub", async () => ({ variants: [] })),
      comparePair("https://p/sub", "https://p/dub", async () => { throw new Error("embed page moved"); }),
    ]);
    for (const v of refusals) {
      assert.equal(v.verdict, "unknown", String(v.reason));
      const record = recordOf(v.verdict, "zokoanime");
      assert.deepEqual(record, { copy: [], distinct: [] }, "an unmeasured pair stores nothing");
      assert.equal(dubProvenanceOf("zokoanime", true, record), "claimed");
      assert.equal(dubProvenanceOf("zokoanime", false, record), "claimed");
    }
  });

  it("the two layers cannot disagree, because there are only three answers", async () => {
    // The vocabulary is closed. A consumer keyed on these three verdicts covers
    // every path `comparePair` has — including the ones added later — and one of
    // them (`unknown`) is never allowed to become a claim about the audio.
    const measured = [];
    const collect = async (routes, options) => {
      await withFetch(routes, async (r) => {
        const v = await verdict(r, options);
        assert.ok(["copy", "distinct", "unknown"].includes(v.verdict), `unvocabulary verdict: ${v.verdict}`);
        measured.push(v.verdict);
      });
    };
    const same = tsSegment(0xa1);
    await collect(pair(same, tsSegment(0xb7), { subSize: 1_022_156, dubSize: 743_352 }));
    await collect(pair(same, same, { subSize: 1_022_156, dubSize: 1_022_156 }));
    await collect(pair(same, same, {}));
    await collect(pair(pngSegment(0xab), pngSegment(0xab), { subSize: 626_292, dubSize: 857_908 }));
    assert.deepEqual(measured, ["distinct", "copy", "copy", "unknown"]);
    for (const answer of measured) {
      const record = recordOf(answer, "zokoanime");
      const provenance = dubProvenanceOf("zokoanime", true, record);
      if (answer === "unknown") assert.equal(provenance, "claimed");
      if (answer === "copy") assert.equal(provenance, "measured-corrected");
      if (answer === "distinct") assert.equal(provenance, "measured");
    }
    // And the pill-side rule: a host measured both ways settles nothing, so the
    // two passes can never combine into a stronger claim than either made alone.
    assert.equal(dubProvenanceOf("zokoanime", true, { copy: ["zokoanime"], distinct: ["zokoanime"] }), "claimed");
  });
});
