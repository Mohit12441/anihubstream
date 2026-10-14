// Offline pins for the WatchAnimeWorld / abyss chain (`watchanimeworld.mjs`).
//
// Two things make this chain worth pinning harder than the others: its part URL
// is a *derived token* (one wrong byte in the key derivation and the CDN answers
// 403 with no explanation), and its manifest decrypts to garbage WITHOUT throwing
// (a UTF-8 decode of the datas blob parses clean and yields noise). Both failures
// look like "the site is down" from the outside, which is exactly the class of bug
// that should not require a live site to notice.
//
// The pinned vectors in group 1 were captured live on 2026-10-11 from
// player.abyssplayer.com + <sub>.sssrr.org while walking watchanimeworld.one
// episode 5x208. They are byte-for-byte the same constants the app pins in
// `tests/unit/abyssStream.test.ts` — a change here that breaks them means the two
// implementations have diverged, not that the site rotated.
//
// Groups, in the order the chain needs them:
//   1 pinned   the token, the size-key digest, the part URL, the part layout
//   2 spec     the virtual-URL round trip and the host-injection refusals
//   3 range    HTTP range semantics, including the multi-range refusal
//   4 pages    search cards, season picker, episode rows, episode ref round trip
//   5 config   the JS-not-JSON `var CONFIG` balanced-object read
//   6 manifest the latin1 decode and the AES-256-CTR key derivation, round trip
//   7 renditions ordering + the rows that must be dropped
//   8 languages hin > eng > jpn, slug sharing, first-offered fallback
//   9 chain    sources()/download() against a stubbed fetch: audio scoping, the
//              copy probe, and a part 0 that is not an MP4 refusing the write
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createCipheriv, createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ABYSS_PART_SIZE,
  ABYSS_REFERER,
  ABYSS_VIRTUAL_ORIGIN,
  abyssPartCount,
  abyssPartLength,
  abyssPartUrl,
  abyssSizeKey,
  abyssToken,
  buildAbyssVirtualUrl,
  decodeAbyssSpec,
  decodeEpisodeRef,
  decryptAbyssManifest,
  download,
  encodeAbyssSpec,
  encodeEpisodeRef,
  mediaFromPage,
  parseAbyssDatas,
  parseAbyssRange,
  parseAbyssVirtualUrl,
  parseDubPlayerConfig,
  parseDubPlayerUrl,
  parseEpisodeItems,
  parseSearchCards,
  parseSeasonAnchors,
  selectLanguageTargets,
  selectRenditionCandidates,
  sources,
} from "./watchanimeworld.mjs";

const SPEC = { m: "24669874", r: 2, s: 64159744, h: "wal5as0it0" };

describe("1. abyss token derivation (live-pinned vectors)", () => {
  it("mints the exact token the CDN served for part 1", () => {
    assert.equal(
      abyssToken("/mp4/24669874/2/64159744/2097152/1", 64159744),
      "Y0h4a0ZaeXRUY25DT3l3STBSNm1yL2F6K1dka1k3MmEyZGc1RWxMKzJJaHNyQQ",
    );
  });

  it("hashes the size's decimal digits as byte values, not as a string", () => {
    assert.equal(abyssSizeKey(63864921), "eef01bc2fb1678527fefde2af42109f0");
    // The two derivations are not the same function: md5("63864921") is what a
    // careless port would use, and the CDN would 403 every request with it.
    assert.notEqual(abyssSizeKey(63864921), createHash("md5").update("63864921").digest("hex"));
  });

  it("lays the two captured copies out as 31 parts with their measured tails", () => {
    assert.equal(abyssPartCount(64188987), 31);
    assert.equal(abyssPartLength(64188987, 30), 1274427);
    assert.equal(abyssPartLength(64188987, 29), ABYSS_PART_SIZE);
    assert.equal(abyssPartCount(64159744), 31);
    assert.equal(abyssPartLength(64159744, 30), 1245184);
  });

  it("addresses the wall-copy part URL with the pinned token", () => {
    assert.equal(
      abyssPartUrl(SPEC, 1),
      "https://wal5as0it0.sssrr.org/sora/64159744/Y0h4a0ZaeXRUY25DT3l3STBSNm1yL2F6K1dka1k3MmEyZGc1RWxMKzJJaHNyQQ",
    );
  });

  it("treats a file under one chunk as a single part addressed at its own size", () => {
    const tiny = { ...SPEC, s: 1000 };
    assert.equal(abyssPartCount(1000), 1);
    assert.equal(abyssPartLength(1000, 0), 1000);
    assert.ok(abyssPartUrl(tiny, 0).includes(abyssToken("/mp4/24669874/2/1000/1000/0", 1000)));
  });

  it("sends the player's Referer, because the sora hosts 403 without it", () => {
    assert.equal(ABYSS_REFERER, "https://player.abyssplayer.com/");
  });
});

describe("2. AbyssSpec virtual URL", () => {
  it("round-trips through the virtual origin the app stitches under", () => {
    const url = buildAbyssVirtualUrl(SPEC);
    assert.ok(url.startsWith(`https://${ABYSS_VIRTUAL_ORIGIN}/`));
    assert.ok(url.endsWith(".mp4"));
    assert.deepEqual(parseAbyssVirtualUrl(url), SPEC);
    assert.deepEqual(decodeAbyssSpec(encodeAbyssSpec(SPEC)), SPEC);
  });

  it("refuses a foreign host, bad base64 and a bad field", () => {
    assert.equal(parseAbyssVirtualUrl("https://example.com/abc123.mp4"), null);
    assert.equal(parseAbyssVirtualUrl(`https://${ABYSS_VIRTUAL_ORIGIN}/!!.mp4`), null);
    assert.equal(decodeAbyssSpec(Buffer.from("not json").toString("base64url")), null);
    // The host-injection primitive: a dot or slash in `h` would ride a
    // server-minted token straight into another party's URL.
    assert.equal(decodeAbyssSpec(specJson({ m: "12", r: 2, s: 3, h: "evil.com" })), null);
    assert.equal(decodeAbyssSpec(specJson({ m: "12", r: 2, s: 3, h: "a/../../x" })), null);
    assert.equal(decodeAbyssSpec(specJson({ m: "12", r: 0, s: 3, h: "ok" })), null);
    assert.equal(decodeAbyssSpec(specJson({ m: "12", r: 2, s: 3.5, h: "ok" })), null);
    assert.equal(decodeAbyssSpec(specJson({ m: 12, r: 2, s: 3, h: "ok" })), null, "m must be a digit STRING");
  });
});

const specJson = (o) => Buffer.from(JSON.stringify(o), "utf8").toString("base64url");

describe("3. parseAbyssRange", () => {
  const size = 1000;
  it("reads absent, open-ended and suffix forms with HTTP semantics", () => {
    assert.equal(parseAbyssRange(undefined, size), null);
    assert.equal(parseAbyssRange("   ", size), null);
    assert.deepEqual(parseAbyssRange("bytes=10-19", size), { start: 10, end: 19 });
    assert.deepEqual(parseAbyssRange("bytes=990-", size), { start: 990, end: 999 });
    assert.deepEqual(parseAbyssRange("bytes=-5", size), { start: 995, end: 999 });
    assert.deepEqual(parseAbyssRange("bytes=-5000", size), { start: 0, end: 999 });
    assert.deepEqual(parseAbyssRange("bytes=0-5000", size), { start: 0, end: 999 });
  });

  it("refuses what a stitched single-range body cannot answer", () => {
    assert.equal(parseAbyssRange("bytes=abc", size), "unsatisfiable");
    assert.equal(parseAbyssRange("bytes=-", size), "unsatisfiable");
    assert.equal(parseAbyssRange("bytes=-0", size), "unsatisfiable");
    assert.equal(parseAbyssRange("bytes=1000-1010", size), "unsatisfiable");
    assert.equal(parseAbyssRange("bytes=5-4", size), "unsatisfiable");
    // A multi-range ask cannot be served as one body; honouring the first range
    // and calling it a day would lie about what was sent.
    assert.equal(parseAbyssRange("bytes=0-1,5-6", size), "unsatisfiable");
    assert.equal(parseAbyssRange("items=0-1", size), "unsatisfiable");
  });
});

// ---------------------------------------------------------------- page layer

/** Two cards of /?s=naruto, trimmed from the payload captured live 2026-10-11. */
const LIVE_SEARCH_HTML = `<ul class="post-lst">
<li id="post-352" class="post-352 series type-series category-hindi">
    <article class="post dfx fcl movies">
        <header class="entry-header">
            <h2 class="entry-title" style="white-space: nowrap;">Naruto Shippuden</h2>
        </header>
        <div class="post-thumbnail or-1"><figure>
            <img loading="lazy" src="//image.tmdb.org/t/p/w500/kV27j3Nz4d5z8u6mN3EJw9RiLg2.jpg" alt="Image Naruto Shippuden">
        </figure></div> <a href="https://watchanimeworld.one/series/naruto-shippuden/" class="lnk-blk"></a>
    </article>
</li><li id="post-332" class="post-332 series type-series category-hindi">
    <article class="post dfx fcl movies">
        <header class="entry-header">
            <h2 class="entry-title">Naruto</h2>
        </header>
        <div class="post-thumbnail or-1"><figure>
            <img loading="lazy" src="//image.tmdb.org/t/p/w500/xppeysfvDKVx775MFuH8Z9BlpMk.jpg" alt="Image Naruto">
        </figure></div> <a href="https://watchanimeworld.one/series/naruto/" class="lnk-blk"></a>
    </article>
</li></ul>`;

const LIVE_SERIES_HTML = `<div class="bd"><article class="post single"><div class="dfxb alg-cr"><div>
    <img style="height: 14rem;" loading="lazy" src="//image.tmdb.org/t/p/w185/xppeysfvDKVx775MFuH8Z9BlpMk.jpg" alt="Image Naruto">
    <h1 style="padding-top: 10px;"class="entry-title">Naruto</h1></div></div>
    <section class="section episodes"><header class="section-header"><div class="aa-drp choose-season">
        <ul class="aa-cnt sub-menu">
            <li class="sel-temp"><a data-post="332" data-season="1" href="javascript:void(0)">Season 1</a></li>
            <li class="sel-temp"><a data-post="332" data-season="5" href="javascript:void(0)">Season 5</a></li>
        </ul></div></header></section></article></div>`;

const LIVE_AJAX_SEASON5 = `<li>
    <article class="post dfx fcl episodes fa-play-circle lg">
        <div class="post-thumbnail"><figure><img loading="lazy" src="https://img.watchanimeworld.one/images/1962/208.webp"></figure></div>
        <header class="entry-header">
            <span class="num-epi">5x208</span>
            <h2 class="entry-title"><a href="https://watchanimeworld.one/episode/naruto-shippuden-5x208/">In the Shadow of the Fourth part 2</a></h2>
        </header>
    </article>
</li>`;

const MAIN = "https://watchanimeworld.one";

describe("4. page parsers", () => {
  it("reads both live cards with https-normalized tmdb posters", () => {
    const cards = parseSearchCards(MAIN, LIVE_SEARCH_HTML);
    assert.deepEqual(cards.map((c) => c.slug), ["naruto-shippuden", "naruto"]);
    assert.deepEqual(cards.map((c) => c.title), ["Naruto Shippuden", "Naruto"]);
    assert.equal(cards[0].coverUrl, "https://image.tmdb.org/t/p/w500/kV27j3Nz4d5z8u6mN3EJw9RiLg2.jpg");
  });

  it("skips a card whose series anchor is missing", () => {
    assert.deepEqual(parseSearchCards(MAIN, '<li id="post-9"><h2 class="entry-title">X</h2></li>'), []);
  });

  it("reads the h1 title despite the attribute order, and the w185 cover", () => {
    const media = mediaFromPage(MAIN, "naruto", LIVE_SERIES_HTML);
    assert.equal(media.id, "watchanimeworld:naruto");
    assert.equal(media.title, "Naruto");
    assert.equal(media.coverUrl, "https://image.tmdb.org/t/p/w185/xppeysfvDKVx775MFuH8Z9BlpMk.jpg");
  });

  it("reads the season picker in order, collapsing a duplicated season", () => {
    assert.deepEqual(parseSeasonAnchors(LIVE_SERIES_HTML), [
      { postId: "332", season: 1 },
      { postId: "332", season: 5 },
    ]);
    assert.deepEqual(
      parseSeasonAnchors('<a data-post="1" data-season="2"></a><a data-post="1" data-season="2"></a>').length,
      1,
    );
  });

  it("keeps the ABSOLUTE episode number of a late season (5x208)", () => {
    const [ep] = parseEpisodeItems(MAIN, LIVE_AJAX_SEASON5, "naruto-shippuden");
    assert.equal(ep.number, 208);
    assert.equal(ep.seasonNumber, 5);
    assert.equal(ep.audioType, "dub");
    assert.equal(ep.url, "https://watchanimeworld.one/episode/naruto-shippuden-5x208/");
  });

  it("skips a row without the num-epi span or the episode anchor", () => {
    assert.deepEqual(parseEpisodeItems(MAIN, '<article class="episodes"><h2 class="entry-title"><a href="/episode/x/">X</a></h2></article>', "s"), []);
  });

  it("round-trips the episode ref, and refuses a foreign or non-URL one", () => {
    const ref = encodeEpisodeRef({ seriesSlug: "naruto", season: 1, number: 1, episodeUrl: "https://watchanimeworld.one/episode/naruto-1x1/" });
    assert.equal(ref, "watchanimeworld|naruto|1|1|https://watchanimeworld.one/episode/naruto-1x1/");
    assert.deepEqual(decodeEpisodeRef(ref), { seriesSlug: "naruto", season: 1, number: 1, episodeUrl: "https://watchanimeworld.one/episode/naruto-1x1/" });
    assert.equal(decodeEpisodeRef("animewave|1|2|https://x/y"), null);
    assert.equal(decodeEpisodeRef("watchanimeworld|naruto|1|1|not-a-url"), null);
  });

  it("picks the dub-player iframe and ignores the measured-dead zephyrix one", () => {
    const html = `<div id="options-0"><iframe src="https://watchanimeworld.one/dub-player/t/8531/"></iframe></div>
      <div id="options-1"><iframe src="https://zephyrix.to/embed/abc"></iframe></div>`;
    assert.equal(parseDubPlayerUrl(MAIN, html), "https://watchanimeworld.one/dub-player/t/8531/");
    assert.equal(parseDubPlayerUrl(MAIN, '<iframe src="https://zephyrix.to/embed/abc"></iframe>'), null);
  });
});

describe("5. var CONFIG (JS, not JSON)", () => {
  const CONFIG_HTML = `<script>var CONFIG = {"prefix":"https://player.abyssplayer.com/","ready":{"eng":"Wj1x","hin":"GaUSzV4EE","jpn":"xK9"},"lang":{"hin":{"name":"Hindi"},"eng":{"name":"English"}}};</script>`;

  it("reads the live-shaped config", () => {
    const config = parseDubPlayerConfig(CONFIG_HTML);
    assert.equal(config.prefix, "https://player.abyssplayer.com/");
    assert.deepEqual(config.ready.hin, "GaUSzV4EE");
  });

  it("survives a brace and an escaped quote inside a JSON string", () => {
    const tricky = `<script>var CONFIG = {"prefix":"https://p.x","note":"a } brace and a \\" quote","ready":{"hin":"a1"},"lang":{}};</script>`;
    const config = parseDubPlayerConfig(tricky);
    assert.ok(config, "the balanced read must not stop at the brace inside the string");
    assert.equal(config.ready.hin, "a1");
  });

  it("returns null when the marker or the prefix is missing", () => {
    assert.equal(parseDubPlayerConfig("<html></html>"), null);
    assert.equal(parseDubPlayerConfig('var CONFIG = {"prefix":"/relative","ready":{},"lang":{}};'), null);
  });

  it("orders languages hin > eng > jpn, collapses a shared slug, falls back to the first offered", () => {
    // `jpn` has a slug but no entry under `lang`, so its label comes from the
    // fallback map — which names it "Japanese", the same word the app's player
    // shows. A bare "JPN" in the menu would be a different claim.
    const full = selectLanguageTargets(parseDubPlayerConfig(CONFIG_HTML));
    assert.deepEqual(full.map((t) => [t.lang, t.slug, t.label]), [["hin", "GaUSzV4EE", "Hindi"], ["eng", "Wj1x", "English"], ["jpn", "xK9", "Japanese"]]);
    const shared = selectLanguageTargets({ prefix: "https://p", ready: { hin: "same", eng: "same" }, lang: {} });
    assert.deepEqual(shared.map((t) => t.lang), ["hin"]);
    const other = selectLanguageTargets({ prefix: "https://p", ready: { spa: "s1" }, lang: { spa: { name: "Spanish" } } });
    assert.deepEqual(other, [{ lang: "spa", slug: "s1", label: "Spanish" }]);
  });
});

// --------------------------------------------------------------- manifest layer

/**
 * The manifest captured live 2026-10-11 for episode 5x208 (12 sources, 11
 * domains, 4 fristDatas rows; the first source row is the wall copy the token
 * vectors above are minted from), re-encrypted here with the documented scheme so
 * the decrypter is tested against the real SHAPE without shipping the capture.
 */
const LIVE_MANIFEST = {
  sources: [
    { label: "360p", res_id: 2, size: 64159744, codec: "h264", status: true, sub: "wal5as0it0" },
    { label: "360p", res_id: 3, size: 64188987, codec: "h264", status: true, sub: "d4vi7e6z20" },
    { label: "360p", res_id: 4, size: 66000000, codec: "h264", status: true, sub: "keph9dhn0" },
    { label: "360p", res_id: 5, size: 67000001, codec: "h264", status: true, sub: "ivjn18ppq1" },
    { label: "360p", res_id: 6, size: 58000000, codec: "av1", status: true, sub: "o2k4gzaqd0" },
    { label: "720p", res_id: 7, size: 120000000, codec: "h264", status: true, sub: "pzt9ldgwf52" },
    { label: "720p", res_id: 8, size: 110000001, codec: "av1", status: true, sub: "q1abc" },
    { label: "1080p", res_id: 9, size: 300000000, codec: "av1", status: true, sub: "r2abc" },
    { label: "1080p", res_id: 10, size: 240000000, codec: "h264", status: true, sub: "zo92nqf4y28" },
    { label: "1080p", res_id: 11, size: 250000000, codec: "h264", status: true, sub: "s3abc" },
    { label: "480p", res_id: 12, size: 80000000, codec: "h264", status: true, sub: "t4abc" },
    { label: "480p", res_id: 13, size: 79000000, codec: "h264", status: true, sub: "u5abc" },
  ],
  domains: Array.from({ length: 11 }, (_, i) => `d${i}`),
  fristDatas: Array.from({ length: 4 }, (_, i) => ({ id: i })),
};
const OUTER = { slug: "GaUSzV4EE", md5_id: "24669874", user_id: "359459" };

/** The player's own encryption, run forward: this is what the page carries. */
function encryptDatas(manifest, outer = OUTER) {
  const keyHex = createHash("md5").update(`${outer.user_id}:${outer.slug}:${outer.md5_id}`, "utf8").digest("hex");
  const cipher = createCipheriv("aes-256-ctr", Buffer.from(keyHex, "ascii"), Buffer.from(keyHex.slice(0, 16), "ascii"));
  const media = Buffer.concat([cipher.update(JSON.stringify({ mp4: manifest }), "utf8"), cipher.final()]);
  // The page puts the ciphertext's RAW bytes into a JSON string, then base64s the
  // whole string — which is why the reader must take it back as latin1.
  const json = JSON.stringify({ ...outer, media: media.toString("latin1") });
  return `const datas = "${Buffer.from(json, "latin1").toString("base64")}";`;
}

describe("6. datas blob and manifest decrypt", () => {
  it("reads the ids out of the base64 JSON", () => {
    const outer = parseAbyssDatas(`<html>${encryptDatas(LIVE_MANIFEST)}</html>`);
    assert.deepEqual(outer, { ...OUTER, media: outer.media });
    assert.match(outer.md5_id, /^\d+$/);
  });

  it("decrypts to the pinned manifest shape", () => {
    const manifest = decryptAbyssManifest(parseAbyssDatas(encryptDatas(LIVE_MANIFEST)));
    assert.equal(manifest.sources.length, 12);
    assert.equal(manifest.domains.length, 11);
    assert.equal(manifest.fristDatas.length, 4);
    assert.deepEqual(manifest.sources[0], { label: "360p", res_id: 2, size: 64159744, codec: "h264", status: true, sub: "wal5as0it0" });
  });

  it("proves the latin1 rule: the same blob read as utf8 decrypts to garbage", () => {
    const blob = /const datas = "([^"]+)"/.exec(encryptDatas(LIVE_MANIFEST))[1];
    const asLatin1 = JSON.parse(Buffer.from(blob, "base64").toString("latin1"));
    const asUtf8 = JSON.parse(Buffer.from(blob, "base64").toString("utf8"));
    // BOTH reads parse — that is the trap. Every ciphertext byte >= 0x80 that is
    // not part of a valid UTF-8 sequence becomes U+FFFD, so the string keeps its
    // shape and loses its bytes: the same length, the same JSON, different bytes.
    assert.equal(
      Buffer.from(asUtf8.media, "latin1").toString("hex") === Buffer.from(asLatin1.media, "latin1").toString("hex"),
      false,
      "the utf8 read changes the ciphertext bytes",
    );
    assert.equal(decryptAbyssManifest(parseAbyssDatas(`<i>${encryptDatas(LIVE_MANIFEST)}</i>`)).sources.length, 12);
    assert.throws(() => decryptAbyssManifest({ ...OUTER, media: asUtf8.media }), /not JSON after decrypt/);
  });

  it("throws a typed error on a page with no blob and on a wrong-shaped one", () => {
    assert.throws(() => parseAbyssDatas("<html></html>"), /no datas blob/);
    const wrong = `const datas = "${Buffer.from(JSON.stringify({ slug: 1 }), "latin1").toString("base64")}";`;
    assert.throws(() => parseAbyssDatas(wrong), /wrong shape/);
  });
});

describe("7. rendition candidates", () => {
  it("buckets by quality, h264 before av1 and smaller before larger", () => {
    const byQuality = selectRenditionCandidates(LIVE_MANIFEST.sources);
    assert.deepEqual([...byQuality.keys()].sort((a, b) => a - b), [360, 480, 720, 1080]);
    const codes = byQuality.get(360).map((r) => r.codec);
    assert.deepEqual(codes, ["h264", "h264", "h264", "h264", "av1"], "h264 first");
    const h264Sizes = byQuality.get(360).filter((r) => r.codec === "h264").map((r) => r.size);
    assert.deepEqual(h264Sizes, [...h264Sizes].sort((a, b) => a - b), "then smallest first");
    assert.equal(byQuality.get(1080)[0].sub, "zo92nqf4y28");
  });

  it("drops rows with status false, an unknown codec or a malformed label/host", () => {
    const noisy = [
      ...LIVE_MANIFEST.sources,
      { label: "360p", res_id: 2, size: 1, codec: "h264", status: false, sub: "aaa111" },
      { label: "360p", res_id: 2, size: 1, codec: "vp9", status: true, sub: "aaa111" },
      { label: "sd", res_id: 2, size: 1, codec: "h264", status: true, sub: "aaa111" },
      { label: "360p", res_id: 2, size: 1, codec: "h264", status: true, sub: "bad.host" },
      { label: "360p", res_id: 2, size: 1.5, codec: "h264", status: true, sub: "aaa111" },
    ];
    assert.equal(selectRenditionCandidates(noisy).get(360).length, 5);
  });
});

// ------------------------------------------------------------------ chain stub

const mp4Part = (fill) => {
  const b = Buffer.alloc(ABYSS_PART_SIZE);
  b.writeUInt32BE(24, 0);
  b.write("ftyp", 4, "latin1");
  b.write("isom", 8, "latin1");
  b.fill(fill ?? 0x41, 24);
  return b;
};

const html = (inner) =>
  `<!doctype html><html><head><title>Naruto 1x1 - AniVerse</title></head><body>
   <div id="options-0"><iframe src="https://watchanimeworld.one/dub-player/t/8531/"></iframe></div>
   <div id="options-1"><iframe src="https://zephyrix.to/embed/dead"></iframe></div>${inner}</body></html>`;

/**
 * The whole chain with no network: episode page -> dub-player CONFIG -> abyss page
 * (real encrypted blob) -> part probes -> part bytes.  Ranges are answered like
 * the sora host does, so the copy probe is tested against range semantics rather
 * than a canned "ok".
 */
function stubSite({ part0 = mp4Part(), tailMissing = false, languages = ["hin"] } = {}) {
  const calls = [];
  const ready = {};
  for (const lang of languages) ready[lang] = `${OUTER.slug}-${lang}`;
  const configScript = `<script>var CONFIG = ${JSON.stringify({ prefix: "https://player.abyssplayer.com/", ready, lang: { hin: { name: "Hindi" }, eng: { name: "English" }, jpn: { name: "Japanese" } } })};</script>`;
  const routes = [
    [/watchanimeworld\.one\/episode\//, () => html(configScript)],
    [/watchanimeworld\.one\/dub-player\/t\//, () => configScript],
    [/player\.abyssplayer\.com\//, () => `<html><body>${encryptDatas(LIVE_MANIFEST)}</body></html>`],
  ];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url, headers: opts.headers ?? {} });
    const u = String(url);
    const body = (text) => ({ ok: true, status: 200, url: u, headers: new Headers({ "content-type": "text/html" }), text: async () => text, arrayBuffer: async () => new Uint8Array(Buffer.from(text, "latin1")).buffer });
    const bytes = (buf, status = 200) => ({
      ok: status < 400, status, url: u,
      headers: new Headers({ "content-type": "application/octet-stream", "content-length": String(buf.byteLength) }),
      arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
      text: async () => buf.toString("latin1"),
    });
    for (const [re, make] of routes) if (re.test(u)) return body(make());
    if (/\.sssrr\.org\/sora\//.test(u)) {
      const range = String(opts.headers?.range ?? "");
      // The copy probe asks two things: `bytes=4-7` (must answer the plaintext
      // box type) and a ONE-byte range on the final part (must answer at all).
      if (range === "bytes=4-7") return bytes(mp4Part().subarray(4, 8), 206);
      const m = /^bytes=(\d+)-(\d+)$/.exec(range);
      if (m) {
        if (m[1] === m[2]) return tailMissing ? bytes(Buffer.alloc(0), 416) : bytes(Buffer.alloc(1, 0x7f), 206);
        return bytes(Buffer.alloc(Number(m[2]) - Number(m[1]) + 1, 0x7f), 206);
      }
      return bytes(part0);
    }
    throw new Error(`stub got an unexpected URL: ${u}`);
  };
  return { calls, restore: () => { globalThis.fetch = real; } };
}

const REF = "watchanimeworld|naruto|1|1|https://watchanimeworld.one/episode/naruto-1x1/";

describe("8/9. chain against a stub (no network)", () => {
  it("emits only copies whose probe passes, and says so with available", async () => {
    const site = stubSite();
    try {
      const out = await sources(REF, {});
      assert.deepEqual(out.embeds, [], "this provider publishes no embeds");
      assert.ok(out.direct.length > 0, "the manifest produced streams");
      assert.deepEqual(out.available, { sub: 0, dub: out.direct.length });
      assert.equal(out.audioType, "dub");
      for (const d of out.direct) {
        assert.equal(d.audioType, "dub");
        assert.equal(d.isDub, true);
        assert.equal(d.container, "mp4");
        assert.match(d.url, /^https:\/\/waw-abyss\.invalid\/[A-Za-z0-9_-]+\.mp4$/);
        assert.match(d.partUrl, /^https:\/\/[a-z0-9-]+\.sssrr\.org\/sora\/\d+\/[A-Za-z0-9_-]+$/);
        assert.deepEqual(parseAbyssVirtualUrl(d.url), d.spec);
      }
      const hosts = new Set(out.direct.map((d) => d.host));
      assert.ok([...site.calls].every((c) => !/sssrr/.test(c.url) || c.headers.referer === ABYSS_REFERER),
        "every part request carries the player Referer");
      assert.ok(hosts.size > 0);
    } finally { site.restore(); }
  });

  it("honours the audio ask by serving nothing for a group the site does not have", async () => {
    const site = stubSite();
    try {
      const sub = await sources(REF, { audioType: "sub" });
      assert.deepEqual(sub.direct, [], "a sub ask has no bytes here");
      assert.deepEqual(sub.available, { sub: 0, dub: sub.available.dub });
      assert.ok(sub.available.dub > 0, "the walk still reports what the page published");
      assert.equal(sub.audioType, undefined);
    } finally { site.restore(); }
  });

  it("drops a copy whose tail byte never arrives", async () => {
    const good = stubSite();
    let goodCount;
    try { goodCount = (await sources(REF, {})).direct.length; } finally { good.restore(); }
    const bad = stubSite({ tailMissing: true });
    try {
      const out = await sources(REF, {});
      assert.equal(out.direct.length, 0, "a truncated upload must never be emitted");
      assert.ok(goodCount > 0);
    } finally { bad.restore(); }
  });

  it("stitches one part into a real mp4 prefix and reports the cut honestly", async () => {
    const dir = await mkdtemp(join(tmpdir(), "waw-test-"));
    const out = join(dir, "ep.mp4");
    const site = stubSite();
    try {
      const [d] = (await sources(REF, {})).direct;
      const res = await download(d.spec, out, { maxParts: 1 });
      assert.equal(res.sizeBytes, ABYSS_PART_SIZE);
      assert.equal(res.container, "mp4");
      assert.equal(res.parts, 1);
      assert.equal(res.truncatedUpstream, false);
      assert.equal(res.truncatedByRequest, true);
      assert.equal(res.declaredBytes, d.spec.s);
      const buf = await readFile(out);
      assert.equal(buf.length, ABYSS_PART_SIZE);
      assert.equal(buf.subarray(4, 8).toString("latin1"), "ftyp");
      // A spec-shaped object is accepted, and so is the virtual URL it mints.
      const viaUrl = await download(d.url, join(dir, "again.mp4"), { maxParts: 1 });
      assert.equal(viaUrl.sizeBytes, ABYSS_PART_SIZE);
    } finally {
      site.restore();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("refuses to write a part 0 that is not an MP4 container", async () => {
    const dir = await mkdtemp(join(tmpdir(), "waw-test-"));
    const out = join(dir, "decoy.ts");
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(ABYSS_PART_SIZE - 4, 0)]);
    const site = stubSite({ part0: png.subarray(0, ABYSS_PART_SIZE) });
    try {
      // The probe itself must reject a PNG head, so nothing is emitted at all;
      // download() is pinned anyway, because its caller can hand it any spec.
      await assert.rejects(() => download({ m: "1", r: 2, s: ABYSS_PART_SIZE, h: "aaa111" }, out, { maxParts: 1 }), (e) => {
        assert.equal(e.code, "DECOY_CDN");
        assert.equal(e.sniffed, "png");
        return true;
      });
      await assert.rejects(() => download({ nonsense: true }, out), /AbyssSpec/);
    } finally {
      site.restore();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
