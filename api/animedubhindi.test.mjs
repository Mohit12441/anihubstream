// Offline pins for the AnimeDubHindi / adhlinks chain (`animedubhindi.mjs`).
//
// Two things make this chain worth pinning harder than the others. First, the
// mirror list is classified by HREF: the site's own zip-pack rows label a
// `/redirect.php` (MEGA) target "Hcloud", so any reader that trusts the label
// routes a MEGA link to a drive parser and gets a confident wrong answer.
// Second, the byte-serving URL is not in the page — it is inside a form field on
// an ad-gate two redirects away, HTML-escaped, and leaving it escaped makes the
// worker answer 200 with an error page instead of the file. Neither failure
// throws; both look like "the site is down".
//
// The page fixtures in group 1 are byte-exact payloads captured live on
// 2026-10-11 while walking animedubhindi.link (Slime season 01) — the SAME
// markup the app pins in `tests/unit/animedubhindiParsers.test.ts`, with one
// deliberate swap: card 2's `img src` is a non-Blogger host, so the poster rule
// (keep only `i*.wp.com/blogger.googleusercontent…`) is pinned rather than
// assumed. A change here that breaks the card-1 assertions means the two
// implementations diverged, not that the site rotated. The terminal-shaped
// payloads in group 3 are the interstitial / ad-gate / shortener bodies read off
// the live 2026-10-14 walk, and group 5 carries 8,477 actual bytes of the live
// 480p MKV so the EBML reader is tested against a file, not only a fixture.
//
// Groups, in the order the chain needs them:
//   1 pages     search cards, title cleaning, the funnel, the episode sections
//   2 mirrors   the fifteen hand-outs in site order, and href-based classification
//   3 terminal  redirectUrl base64, the escaped source_url, the cuty.io leak
//   4 quality   filename -> rung, filename -> what audio it claims
//   5 ebml      the variable-length integer and the Tracks read from a real head
//   6 audio     the Multi-Audio verdict table (claim x measured tracks)
//   7 refs      the episode ref round trip and its refusals
//   8 chain     search/details/sources/resolve/download/audioTruth on a stub fetch
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  audioTruth,
  classifyMirror,
  cleanAdbTitle,
  decodeEpisodeRef,
  decodeMirrorData,
  details,
  download,
  downloadEpisode,
  encodeEpisodeRef,
  episodes,
  fileNameAudioClaim,
  labelForContainer,
  mediaFromPage,
  multiAudioVerdict,
  parseAdhlinksEpisodeMirrors,
  parseAdhlinksEpisodeNumbers,
  parseAdhlinksRedirect,
  parseCutyApiTarget,
  parseFunnelUrl,
  parseIqsmartSourceUrl,
  parseSearchCards,
  probeTerminal,
  qualityFromName,
  readEbmlVint,
  readMatroskaHead,
  resolve,
  search,
  sources,
  terminalFileName,
  trackLanguage,
} from "./animedubhindi.mjs";

const MAIN = "https://www.animedubhindi.link";
const SERIES_SLUG = "that-time-i-got-reincarnated-as-a-slime-season-01-hindi-multi-audio";
const FUNNEL_URL = "https://new.adhlinks.com/episode/that-time-i-got-reincarnated-as-a-slime-season-01/";
const REF = encodeEpisodeRef({ seriesSlug: SERIES_SLUG, number: 1, pageUrl: FUNNEL_URL });

const SLUG_1 = "that-time-i-got-reincarnated-as-a-slime-season-04-hindi-multi-audio";
const SLUG_2 = "ive-been-killing-slimes-for-300-years-and-maxed-out-my-level-season-2-hindi";
const TITLE_1 = "That Time I Got Reincarnated as a Slime Season 04";
const TITLE_2 = "I\u2019ve Been Killing Slimes for 300 Years and Maxed Out My Level Season 2";
const COVER_1 = "https://i0.wp.com/blogger.googleusercontent.com/img/b/R29vZ2xl/AVvXsEisJ3I35-8bZSMI_dy8htk-L-bT7XaD-8qOwG3-duHFyNqM25DIXmCtyn7iXvkHC9jH4lfy7cUyh7ILBea4dFWU33rjWQddnsdJs4lUKSlYsEkPSp8Ct3Of4CbriTKpkpbWa8sTRG7XImuPyvAfJaql6t1n3E2RwCBSjZckIAAQYMuarw/s1600/That%20Time%20I%20Got%20Reincarnated%20as%20a%20Slime%20S4.jpg?w=1024&fit=1024,1024&ssl=1";
const OG_COVER = "https://i0.wp.com/blogger.googleusercontent.com/img/b/R29vZ2xl/AVvXsEg0lilHn_bacbcyNdjzhOPzOC-XJmwWEvaOEiLn4WJ0Pcoo68EucfNksQm0dMahQuVRU3iL4QVTddxRhb2pAzACPYIMAWz5dxYH6zfmMlMFSeMwpPDp0-0HPwfbq-KHnB8ZB8EVw3xI75LUayKCA1Qko8xE9aBC4cFvgWgf9-xR8Wasmw/s1600/That%20Time%20I%20Got%20Reincarnated%20as%20a%20Slime%20S1.jpg?w=1200&fit=1200,675&ssl=1";

/** The two `/?s=slime` grid cards, byte-exact from the live walk. */
const LIVE_SEARCH_HTML = `<article
class="post-3044 post type-post status-publish format-standard has-post-thumbnail hentry category-japanese category-action category-adventure category-comedy category-english category-fantasy category-hindi category-isekai category-series category-tamil category-telugu ast-grid-common-col ast-full-width ast-article-post remove-featured-img-padding ast-width-md-4 ast-archive-post ast-separate-posts" id="post-3044" itemtype="https://schema.org/CreativeWork" itemscope="itemscope">
			<div class="ast-post-format- blog-layout-4 ast-article-inner ast-no-date-box">
		<div class="post-content ast-grid-common-col" >
			<div class="ast-blog-featured-section post-thumb ast-blog-single-element"><div class="post-thumb-img-content post-thumb"><a href="https://www.animedubhindi.link/that-time-i-got-reincarnated-as-a-slime-season-04-hindi-multi-audio/" aria-label="Read: That Time I Got Reincarnated as a Slime Season 04 Hindi, Tamil, Telugu, English, Japanese (Multi Audio) WEB-DL Episodes Download" ><img post-id="3044" fifu-featured="1" width="1024" height="1024" src="https://i0.wp.com/blogger.googleusercontent.com/img/b/R29vZ2xl/AVvXsEisJ3I35-8bZSMI_dy8htk-L-bT7XaD-8qOwG3-duHFyNqM25DIXmCtyn7iXvkHC9jH4lfy7cUyh7ILBea4dFWU33rjWQddnsdJs4lUKSlYsEkPSp8Ct3Of4CbriTKpkpbWa8sTRG7XImuPyvAfJaql6t1n3E2RwCBSjZckIAAQYMuarw/s1600/That%20Time%20I%20Got%20Reincarnated%20as%20a%20Slime%20S4.jpg?w=1024&amp;fit=1024,1024&amp;ssl=1" class="attachment-large size-large wp-post-image" alt="That Time I Got Reincarnated as a Slime Season 04 Hindi, Tamil, Telugu, English, Japanese (Multi Audio) WEB-DL Episodes Download" itemprop="image" decoding="async" fetchpriority="high" /></a></div></div><h2 class="entry-title ast-blog-single-element" itemprop="headline"><a href="https://www.animedubhindi.link/that-time-i-got-reincarnated-as-a-slime-season-04-hindi-multi-audio/" rel="bookmark">That Time I Got Reincarnated as a Slime Season 04 Hindi, Tamil, Telugu, English, Japanese (Multi Audio) WEB-DL Episodes Download</a></h2>		<header class="entry-header ast-blog-single-element ast-blog-meta-container">
				<div class="entry-meta">By <span class="posted-by vcard author">Animedubhindi</span></div>
			</header>
		</div>
</div>
	</article>
<article
class="post-1695 post type-post status-publish format-standard has-post-thumbnail hentry category-adventure ast-grid-common-col ast-full-width ast-article-post" id="post-1695">
			<div class="ast-post-format- blog-layout-4 ast-article-inner ast-no-date-box">
		<div class="post-content ast-grid-common-col" >
			<div class="ast-blog-featured-section post-thumb"><div class="post-thumb-img-content post-thumb"><a href="https://www.animedubhindi.link/ive-been-killing-slimes-for-300-years-and-maxed-out-my-level-season-2-hindi/" aria-label="Read: I&#8217;ve Been Killing Slimes for 300 Years" ><img post-id="1695" src="https://i1.wp.com/example.com/other.png" class="wp-post-image" /></a></div></div><h2 class="entry-title" itemprop="headline"><a href="https://www.animedubhindi.link/ive-been-killing-slimes-for-300-years-and-maxed-out-my-level-season-2-hindi/" rel="bookmark">I&#8217;ve Been Killing Slimes for 300 Years and Maxed Out My Level Season 2 Hindi, English, Japanese (Multi Audio) WEB-DL Episodes Download</a></h2>
		</div>
</div>
	</article>`;

/** og:image + h1 + the Download / Watch funnel anchor, byte-exact tags. */
const LIVE_SERIES_HTML = `<html><head><meta property="og:image" content="${OG_COVER}" /></head><body><h1 class="entry-title" itemprop="headline">That Time I Got Reincarnated as a Slime Season 01 Hindi, Tamil, Telugu, English, Japanese (Multi Audio) BluRay Episodes Download</h1>
<a class="wp-block-button__link wp-element-button" href="https://new.adhlinks.com/episode/that-time-i-got-reincarnated-as-a-slime-season-01/" target="_blank" rel=" noreferrer noopener nofollow">Download / Watch</a></body></html>`;

/**
 * Episode 01 and 02 sections, then "Season End" and the first zip pack — whose
 * rows label a `/redirect.php` target "Hcloud". Byte-exact from the live page.
 */
const LIVE_ADH_PAGE = `<h2 class="wp-block-heading has-text-align-center">Episode: 01</h2>
<h4 class="wp-block-heading has-text-align-center"><mark style="background-color:rgba(0, 0, 0, 0);color:#ff0000" class="has-inline-color">[Upload Date: 17/02/2026]<br></mark><br>[480P x264]<br><a href="https://hubcloud.ist/drive/kico5r2qkphwahf" target="_blank" rel="noreferrer noopener nofollow">Hcloud</a> | <a href="/re.php?data=MTZ0THlobEJsNGR6NmtLNFNFUUIvQVhOVm5oK2RuWjRQazI0M2FicFNQdTVyL1FiVU5rPQ%3D%3D">Multi</a> | <a href="https://gdflix.dev/file/g0Ge9ij7cohfKvD" target="_blank" rel="noreferrer noopener nofollow">GDF</a> | <a href="https://fpgo.xyz/file/699327714b1ecb5acfe9d6bd" target="_blank" rel="noreferrer noopener nofollow">Fprs</a> | <a href="/redirect.php?data=RnI0cnpHOVpKTTRBWmxTNmtyNEYwZTN4ME56L2VaZlVLaUt5aEdDMW0zOU41ZWZJaExXendhVzh5WFlZeFB4Q0tpM1BTQTRtRVozRzNNcGVnRHNGaGdlY3FnZG1lMjdYM2c9PQ%3D%3D">MEGA</a><br><br>[720P x264]<br><a href="https://hubcloud.ist/drive/xwwhyhvwhlgznwg" target="_blank" rel="noreferrer noopener nofollow">Hcloud</a> | <a href="/re.php?data=MTZ0THlobEJsNGR6NmtLNFNFUUIvQVhOVm5oK2RuWjRQazI0M2FicFNPUHJxK01DUjRJPQ%3D%3D">Multi</a> | <a href="https://gdflix.dev/file/8S7f0EeQQ2K7AYb" target="_blank" rel="noreferrer noopener nofollow">GDF</a> | <a href="https://fpgo.xyz/file/699327774b1ecb5acfe9d89d" target="_blank" rel="noreferrer noopener nofollow">Fprs</a> | <a href="/redirect.php?data=RnI0cnpHOVpKTTRBWmxTNmtyNEYwZTN4ME56L2ZZU2dPVGV4KzBxMXJGMDN4cDdCaGJPVTdKZWVuVkkrK2VacmZEUExVakJXTGY3ZWc5ZDZtVFVhdlIrYWhBQi9RVFBEM2c9PQ%3D%3D">MEGA</a><br> <br>[1080P x265 10bit]<br><a href="https://hubcloud.ist/drive/oe51edhfjkzwoka" target="_blank" rel="noreferrer noopener nofollow">Hcloud</a> | <a href="/re.php?data=MTZ0THlobEJsNGR6NmtLNFNFUUIvQVhOVm5oK2RuWjRQazI0M2FicFNQL3U3K0lGUnNnPQ%3D%3D">Multi</a> | <a href="https://gdflix.dev/file/7Z1EYFptaPbKGnQ" target="_blank" rel="noreferrer noopener nofollow">GDF</a> | <a href="https://fpgo.xyz/file/699327644b1ecb5acfe9d3c9" target="_blank" rel="noreferrer noopener nofollow">Fprs</a> | <a href="/redirect.php?data=RnI0cnpHOVpKTTRBWmxTNmtyNEYwZTN4ME56L1hKQ3BCU1d4MWt1MWdHaGo4Nlh6ckt5djdQaXVxRThRL2RCL1JDVGFmVDVuRzZLKzFQd2hxQmtTbXhtL25nOGRYamF3aVE9PQ%3D%3D">MEGA</a><br><br>Watch online:- <a href="https://www.desidubanime.me/anime/ten-shi-sli-dat-ken/" target="_blank" rel="noreferrer noopener nofollow">Click Here</a></h4>
<h2 class="wp-block-heading has-text-align-center">Episode: 02</h2>
<h4 class="wp-block-heading has-text-align-center"><mark>[Upload Date: 17/02/2026]</mark><br>[480P x264]<br><a href="https://hubcloud.ist/drive/8f5wy175kux17mc">Hcloud</a> | <a href="/re.php?data=MTZ0THlobEJsNGR6NmtLNFNFUUIvQVhOVm5oK2RuWjRQazI0M2FicFNQUzAvT3RHVk1JPQ%3D%3D">Multi</a> | <a href="https://gdflix.dev/file/sDZaEueogwEA7El">GDF</a> | <a href="https://fpgo.xyz/file/6993277e4b1ecb5acfe9db1e">Fprs</a> | <a href="/redirect.php?data=RnI0cnpHOVpKTTRBWmxTNmtyNEYwZTN4ME56L2JaQ2hPd3VEMWtDMWwwRkM0T2pocnBTUDE1bWV1VWRPejlGb1ZRbjdXeVJkTW8yMDR0Qm1xendXcHlIN29BaEJVVUxDc3c9PQ%3D%3D">MEGA</a><br>[720P x264]<br><a href="/re.php?data=MTZ0THlobEJsNGR6NmtLNFNFUUIvQVhOVm5oK2RuWjRQazI0M2FicFNQVHYrT01iU3QwPQ%3D%3D">Multi</a><br>[1080P x265 10bit]<br><a href="/re.php?data=MTZ0THlobEJsNGR6NmtLNFNFUUIvQVhOVm5oK2RuWjRQazI0M2FicFNQbXE5YnBEVFlNPQ%3D%3D">Multi</a></h4>
<h2 class="wp-block-heading has-text-align-center has-text-color" style="color:#f42f0c">Season End</h2>
<h2 class="wp-block-heading has-text-align-center">Zip Pack 480P x264</h2>
<h4 class="wp-block-heading has-text-align-center">E01-12 [Size: 1.41GB]<br><a href="/redirect.php?data=RnI0cnpHOVpKTTRGZGxHNDBMOEttcVh4ejgzL1dxRHdDaXIvaFcvNW9rcGducmZHaHF1T3MvV1M%3D" target="_blank">Hcloud</a> | <a href="/redirect.php?data=RnI0cnpHOVpKTTRBWmxTNmtyNEYwZTN4ME56L2NvUDlUUXVKaDBXMW5rbEkvNTd6bUp5eXhvSzdqVlU4MmVGOVp4Ny9hWDk3T3AzSjVMNGd0VGNjK1FtQnN5NXhaazNBc3c9PQ%3D%3D">MEGA</a> | <a href="/redirect.php?data=RnI0cnpHOVpKTTRLWjFXMzFhaFJtdTd1azkrNVVyZTJHUWErMlRudSsyWjgyTFhkaGFXMw%3D%3D">GDF</a> | <a href="/redirect.php?data=RnI0cnpHOVpKTTRMYWwrK3o3WVFqTzd1MmN2K1VydjNGMkMyMkczejRsTi8zK2FmM2FFPQ%3D%3D">Multi</a> | <a href="/redirect.php?data=RnI0cnpHOVpKTTRkYWt1KzBMUU5uK0wya3QyMVNQM3NVeGlYeEVYK20zSTI%3D">Pixel</a></h4>`;

const RE_480 = "https://new.adhlinks.com/re.php?data=MTZ0THlobEJsNGR6NmtLNFNFUUIvQVhOVm5oK2RuWjRQazI0M2FicFNQdTVyL1FiVU5rPQ%3D%3D";
const REDIRECT_480 = "https://new.adhlinks.com/redirect.php?data=RnI0cnpHOVpKTTRBWmxTNmtyNEYwZTN4ME56L2VaZlVLaUt5aEdDMW0zOU41ZWZJaExXendhVzh5WFlZeFB4Q0tpM1BTQTRtRVozRzNNcGVnRHNGaGdlY3FnZG1lMjdYM2c9PQ%3D%3D";

// ============================================================ 1. page parsers

describe("1. animedubhindi page parsers (live fixtures)", () => {
  it("reads both search cards with cleaned titles and only the Blogger-proxied cover", () => {
    const cards = parseSearchCards(MAIN, LIVE_SEARCH_HTML);
    assert.equal(cards.length, 2);
    assert.equal(cards[0].slug, SLUG_1);
    assert.equal(cards[0].title, TITLE_1);
    assert.equal(cards[0].coverUrl, COVER_1, "the i0.wp.com/blogger.googleusercontent image is the poster");
    assert.equal(cards[1].slug, SLUG_2);
    assert.equal(cards[1].title, TITLE_2);
    assert.equal(cards[1].coverUrl, undefined, "an example.com card image is not a poster");
  });

  it("cleans the distribution noise but keeps the season", () => {
    assert.equal(
      cleanAdbTitle("That Time I Got Reincarnated as a Slime Season 01 Hindi, Tamil, Telugu, English, Japanese (Multi Audio) BluRay Episodes Download"),
      "That Time I Got Reincarnated as a Slime Season 01",
    );
    assert.equal(cleanAdbTitle("Frieren Season 02 Hindi (Dual Audio) WEB-DL Episodes Download"), "Frieren Season 02");
    assert.equal(cleanAdbTitle("A Silent Voice Hindi Dub Download"), "A Silent Voice Hindi Dub Download", "no fixed tag to anchor the cut, so nothing is trimmed");
  });

  it("reads the series h1, the og:image cover and the one funnel button", () => {
    const media = mediaFromPage(MAIN, SERIES_SLUG, LIVE_SERIES_HTML);
    assert.equal(media.id, `animedubhindi:${SERIES_SLUG}`);
    assert.equal(media.title, "That Time I Got Reincarnated as a Slime Season 01");
    assert.equal(media.coverUrl, OG_COVER);
    assert.equal(parseFunnelUrl(MAIN, LIVE_SERIES_HTML), FUNNEL_URL);
    assert.equal(parseFunnelUrl(MAIN, "<html><body>no button</body></html>"), null);
  });

  it("takes episode headings only — Season End and zip packs are not episodes", () => {
    assert.deepEqual(parseAdhlinksEpisodeNumbers(LIVE_ADH_PAGE), [1, 2]);
  });
});

// ============================================================== 2. mirrors

describe("2. mirror extraction and href classification", () => {
  it("returns episode 1's fifteen hand-outs in site order with their quality marker", () => {
    const mirrors = parseAdhlinksEpisodeMirrors(LIVE_ADH_PAGE, FUNNEL_URL, 1);
    assert.equal(mirrors.length, 15, "3 qualities x 5 mirrors");
    assert.deepEqual(mirrors.map((m) => m.quality), [480, 480, 480, 480, 480, 720, 720, 720, 720, 720, 1080, 1080, 1080, 1080, 1080]);
    assert.equal(mirrors[0].url, "https://hubcloud.ist/drive/kico5r2qkphwahf");
    assert.equal(mirrors[1].url, RE_480, "the relative /re.php is resolved against the page URL");
    assert.equal(mirrors[2].url, "https://gdflix.dev/file/g0Ge9ij7cohfKvD");
    assert.equal(mirrors[3].url, "https://fpgo.xyz/file/699327714b1ecb5acfe9d6bd");
    assert.equal(mirrors[4].url, REDIRECT_480);
    assert.equal(mirrors[1].marker, "[480P x264]");
    assert.equal(mirrors[11].marker, "[1080P x265 10bit]");
  });

  it("excludes the desidubanime.me hand-out, which shares the h4 but is not a mirror", () => {
    const mirrors = parseAdhlinksEpisodeMirrors(LIVE_ADH_PAGE, FUNNEL_URL, 1);
    assert.ok(!mirrors.some((m) => /desidubanime/.test(m.url)), "Watch online is a hand-out to the streaming sister site");
  });

  it("bounds a section at the next heading so zip packs cannot leak in", () => {
    const mirrors = parseAdhlinksEpisodeMirrors(LIVE_ADH_PAGE, FUNNEL_URL, 2);
    assert.equal(mirrors.length, 7, "ep2 has 5 + 1 + 1 mirrors and none of the zip pack's five");
    assert.ok(mirrors.every((m) => !/kico5r2qkphwahf|Hcloud".{0}zip/.test(m.url)));
    assert.deepEqual(parseAdhlinksEpisodeMirrors(LIVE_ADH_PAGE, FUNNEL_URL, 3), [], "an episode the page does not list produces nothing");
  });

  it("classifies by href, because the site's labels lie", () => {
    assert.equal(classifyMirror(RE_480), "adhlinks-re");
    assert.equal(classifyMirror(REDIRECT_480), "adhlinks-redirect");
    assert.equal(classifyMirror("https://hubcloud.ist/drive/kico5r2qkphwahf"), "hubcloud");
    assert.equal(classifyMirror("https://gdflix.dev/file/g0Ge9ij7cohfKvD"), "gdflix");
    assert.equal(classifyMirror("https://fpgo.xyz/file/699327714b1ecb5acfe9d6bd"), "fpgo");
    assert.equal(classifyMirror("not a url"), "other");
    // The zip-pack rows are the trap: every one of the five is labelled by host
    // name ("Hcloud", "GDF", "Pixel") but all five point at /redirect.php, the
    // MEGA route, so a label-driven classifier sends MEGA to a drive parser.
    const zipRow = /<h4[^>]*>E01-12[\s\S]*?<\/h4>/.exec(LIVE_ADH_PAGE)?.[0] ?? "";
    assert.ok(zipRow.length > 0, "the zip pack is present in the fixture");
    const urls = [...zipRow.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(urls.length, 5, "the pack offers five mirrors");
    assert.deepEqual(urls.map((u) => classifyMirror(new URL(u, FUNNEL_URL).href)), ["adhlinks-redirect", "adhlinks-redirect", "adhlinks-redirect", "adhlinks-redirect", "adhlinks-redirect"]);
    assert.deepEqual(/[A-Za-z]+(?=<\/a>)/g.exec(zipRow)?.[0], "Hcloud", "the first row is labelled Hcloud while being a MEGA route");
    const section = `<h2 class="wp-block-heading">Episode: 90</h2>${zipRow}`;
    assert.deepEqual(parseAdhlinksEpisodeMirrors(section, FUNNEL_URL, 90).filter((m) => m.marker !== undefined), [], "a pack with no quality marker gives no rendition rows");
  });

  it("decodes a mirror's data= token, and records that it is not a URL", () => {
    // Measured 2026-10-14: one base64 round gives a second base64 handle
    // ("16tLyhlBl4dz6kK4SEQB/AXNVnh+dnZ4Pk243abpSPu5r/QbUNk="), and a second
    // round gives binary. The token is a server-side reference, which is why the
    // chain fetches re.php and reads its redirectUrl instead of decoding.
    const decoded = decodeMirrorData(RE_480);
    assert.match(String(decoded), /^[A-Za-z0-9+/]+=*$/, "the payload is another base64 handle, not a link");
    assert.doesNotMatch(String(decoded), /^https?:/, "the token is not a URL, whatever a reader might hope");
    assert.equal(decodeMirrorData("https://gdflix.dev/file/g0Ge9ij7cohfKvD"), null, "no data= to decode");
    assert.equal(decodeMirrorData("not a url"), null);
  });
});

// ============================================================== 3. terminal

describe("3. the three-step walk to the byte-serving URL", () => {
  // Bodies as captured live 2026-10-14: the interstitial assigns the base64
  // target to `var redirectUrl`, the gate page carries it escaped.
  const gateUrl = "https://filesforever.link/file/ja4znoh";
  const terminal =
    "https://icy-feather-221c.jakcminasi.workers.dev/?id=TZzeK__IPLRCA3c0yxsQcB4GpPKfgDfg1X7Mhx2gPXUA3GYo&name=%5BAnimeDubHindi%5D+Slime+S01+EP+01+480p+x264+BDrip+Multi+Audio+ESub.mkv";

  it("decodes the re.php interstitial's redirectUrl", () => {
    const html = `<html><body><script>var redirectUrl = "${Buffer.from(gateUrl).toString("base64")}";window.location.href = atob(redirectUrl);</script></body></html>`;
    assert.equal(parseAdhlinksRedirect(html), gateUrl);
    assert.equal(parseAdhlinksRedirect("<html>no script</html>"), null);
    assert.equal(parseAdhlinksRedirect(`<script>var redirectUrl = "${Buffer.from("not a url").toString("base64")}";</script>`), null);
  });

  it("unescapes the ad-gate's source_url, or the worker sees a broken query", () => {
    const html = `<form><input type="hidden" name="source_url" value="${terminal.replace(/&/g, "&amp;")}"></form>`;
    const got = parseIqsmartSourceUrl(html);
    assert.equal(got, terminal);
    assert.ok(got.includes("&name="), "the second parameter survived as a real separator");
    assert.equal(parseIqsmartSourceUrl("<form>no field</form>"), null);
  });

  it("reads the file name the worker URL declares", () => {
    assert.equal(terminalFileName(terminal), "[AnimeDubHindi] Slime S01 EP 01 480p x264 BDrip Multi Audio ESub.mkv");
    assert.equal(terminalFileName("https://x.workers.dev/?id=a&name=%20%20"), null, "a blank name is no name");
  });

  it("takes the mega.nz target out of the shortener's own API comment", () => {
    // 302 body, byte-exact shape from the live redirect.php answer.
    const body = `\n<!-- WEB UI --> https://cuty.io/api?api=6b1c2d3e&url=https%3A%2F%2Fmega.nz%2Ffile%2FGEMVmb5a%23VOBI6bnXy`;
    assert.equal(parseCutyApiTarget(body), "https://mega.nz/file/GEMVmb5a#VOBI6bnXy");
    assert.equal(parseCutyApiTarget("<html></html>"), null);
  });
});

// ============================================================= 4. quality

describe("4. quality rung and the audio claim in the name", () => {
  it("snaps a filename height to the ladder", () => {
    assert.equal(qualityFromName("[AnimeDubHindi] Slime EP 01 1080p x265 10bit BDrip Multi Audio ESub.mkv"), 1080);
    assert.equal(qualityFromName("... 480p ..."), 480);
    assert.equal(qualityFromName("no height here"), "unknown");
  });

  it("reports what the name claims about audio", () => {
    assert.equal(fileNameAudioClaim("Slime EP 01 720p Multi Audio ESub.mkv"), "Multi Audio");
    assert.equal(fileNameAudioClaim("Slime EP 01 Dual-Audio.mkv"), "Dual Audio");
    assert.equal(fileNameAudioClaim("Slime EP 01 Hindi Dub.mkv"), "Hindi dub");
    assert.equal(fileNameAudioClaim("Slime EP 01.mkv"), null);
  });
});

// ================================================================= 5. ebml

const ID = {
  EBML: [0x1a, 0x45, 0xdf, 0xa3],
  DocType: [0x42, 0x82],
  Segment: [0x18, 0x53, 0x80, 0x67],
  Info: [0x15, 0x49, 0xa9, 0x66],
  TimecodeScale: [0x2a, 0xd7, 0xb1],
  // NOT a three-byte id. 0x44 marks a TWO-byte id under the EBML leading-bit
  // rule, and that is what the live file writes: `4489 84 49adb788` at byte
  // 4239, followed by DateUTC `4461 88 …`. See the real-bytes test below.
  Duration: [0x44, 0x89],
  DateUTC: [0x44, 0x61],
  Tracks: [0x16, 0x54, 0xae, 0x6b],
  TrackEntry: [0xae],
  TrackNumber: [0xd7],
  TrackType: [0x83],
  FlagDefault: [0x88],
  Language: [0x22, 0xb5, 0x9c],
  LanguageIETF: [0x22, 0xb5, 0x9d],
  CodecID: [0x86],
  Name: [0x53, 0x6e],
  Cluster: [0x1f, 0x43, 0xb6, 0x75],
  Void: [0xec],
};

/** TrackType is 1=video, 2=audio, 0x11=subtitle — measured, not intuitive. */
const TT = { video: 1, audio: 2, subtitle: 0x11 };

/** Minimal-width EBML size field (the writer mkvtoolnix-style files use). */
function ebmlSize(n) {
  for (let len = 1; len <= 8; len++) {
    if (n <= 2 ** (7 * len) - 2) {
      const out = Buffer.alloc(len);
      out[0] = (0x80 >> (len - 1)) | ((n >> (8 * (len - 1))) & (0xff >> len));
      for (let i = 1; i < len; i++) out[i] = (n >> (8 * (len - 1 - i))) & 0xff;
      return out;
    }
  }
  throw new Error(`size ${n} does not fit an EBML VINT`);
}

function elem(idBytes, payload) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), "utf8");
  return Buffer.concat([Buffer.from(idBytes), ebmlSize(body.length), body]);
}

const uint = (n) => Buffer.from([n]);
const float32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeFloatBE(n, 0);
  return b;
};

/**
 * The head shape the site's uploads have, transcribed track-for-track from the
 * live 480p file read on 2026-10-14: video typed 1, audio typed 2, subtitles
 * typed 0x11, every track named "AnimeDubHindi" (except the two sign/song
 * subtitle tracks), every track carrying LanguageIETF while only some carry the
 * 3-char tag, and only the Hindi audio default. Duration is a float32 under the
 * two-byte id `44 89` with DateUTC following, as measured at byte 4239.
 */
function mkvHead() {
  const track = ({ number, kind, language, languageIETF, codec, name, isDefault }) =>
    elem(ID.TrackEntry, Buffer.concat([
      elem(ID.TrackNumber, uint(number)),
      elem(ID.TrackType, uint(TT[kind])),
      ...(isDefault === undefined ? [] : [elem(ID.FlagDefault, uint(isDefault ? 1 : 0))]),
      ...(language === undefined ? [] : [elem(ID.Language, language)]),
      ...(languageIETF === undefined ? [] : [elem(ID.LanguageIETF, languageIETF)]),
      elem(ID.Name, name),
      elem(ID.CodecID, codec),
    ]));
  const audio = (number, language, languageIETF) =>
    track({ number, kind: "audio", language, languageIETF, codec: "A_VORBIS", name: "AnimeDubHindi", isDefault: number === 2 });
  const tracks = elem(ID.Tracks, Buffer.concat([
    track({ number: 1, kind: "video", language: "und", languageIETF: "und", codec: "V_MPEG4/ISO/AVC", name: "AnimeDubHindi" }),
    audio(2, "hin", "hi"),
    audio(3, "tam", "ta"),
    audio(4, "tel", "te"),
    // The live track 5 has no 3-char Language element at all: the IETF tag is
    // the only thing that names it, which is why trackLanguage reads it first.
    audio(5, undefined, "en"),
    audio(6, "jpn", "ja"),
    track({ number: 7, kind: "subtitle", languageIETF: "en", codec: "S_TEXT/ASS", name: "Signs & Songs@EMBER" }),
    track({ number: 8, kind: "subtitle", languageIETF: "en", codec: "S_TEXT/ASS", name: "Dialogue@Asakura", isDefault: false }),
  ]));
  const info = elem(ID.Info, Buffer.concat([
    elem(ID.TimecodeScale, Buffer.from([0x0f, 0x42, 0x40])),
    elem(ID.Duration, float32(1_425_000)),
    elem(ID.DateUTC, Buffer.alloc(8)),
  ]));
  const segment = Buffer.concat([info, tracks, elem(ID.Cluster, Buffer.alloc(64))]);
  return Buffer.concat([
    elem(ID.EBML, elem(ID.DocType, "matroska")),
    elem(ID.Void, Buffer.alloc(8)),
    Buffer.concat([Buffer.from(ID.Segment), ebmlSize(1_000_000), segment, Buffer.alloc(256)]),
  ]);
}

/**
 * The first 8,477 B of a real upload, byte-exact: `Range: bytes=0-8476` against
 * the workers.dev terminal on 2026-10-14 for the file that terminal names
 * `[AnimeDubHindi] Slime S01 EP 01 480p x264 BDrip Multi Audio ESub.mkv`
 * (declared 160,950,974 B). Base64 so the vector survives an editor, a diff
 * and a CRLF.
 */
const LIVE_HEAD_480 = Buffer.from("GkXfo6NChoEBQveBAULygQRC84EIQoKIbWF0cm9za2FCh4EEQoWBAhhTgGcBAAAACZfqihFNm3TfTbuMU6uEFUmpZlOsghADTbuMU6uEFlSua1OsghDsTbuOU6uEHFO7a1OshAmN2dtNu45Tq4QSVMNnU6yECZffJ027jVOrhBBDp3BTrIMXr39Nu4xTq4QZQaRpU6yCwvXsT5wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA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BwCwAwuh0JCVAEAeAABBiFKMMcaclFIpxpxzTkqpFGPOOSelZIwx55yTUjLGmHPOSSkdc84556SUjDnnnHNSSuecc845KaWUzjnnnJRSSgidc05KKaVzzjknAACowAEAIMBGkc0JRoIKDVkJAKQCABgcx7I0TdM8TxQ1SdI0z/M8UTRNTbI0zfM8TxRNk+d5niiKommqKs/zPFEURdNUVa4riqZpmqqqqmRZFEXRNFVVdWGapqmqquq6ME1RVFXVdV3IsmmqquvKMmzbNFXVdWUZqKqqyq4sA9dVVdeVZQEA4AkOAEAFNqyOcFI0FlhoyEoAIAMAgCAEIaUUQkophJRSCCmlEBIAADDgAAAQYEIZKDRkRQAQJwAAICSlgk5KJaGUUkoppZRSSimllFJKKaWUUkoppZRSSimllFJKKaWUUkoppZRSSimllFJKKaWUUkoppZRSSimllFJKKaWUUkoppZRSSimlk1JKKaWUUkoppZRSSimllFJKKaWUUkoppZRSSimllFJKKaWUUkoppZRSSimllJJSSimllFJKKaWUUkoppZRSSimllFJKKaWUUkoppZRSSSmllFJKKaWUUkoppZRSSimllFJKKaWUUkoppZRSSimllFJKKaWUUkoppZRSSimllFJKKaWUUkoppZRSSimllFJKKaWUUkoppZRSSimllFJKKaWUUkoppZRSSimllFJKKaWUUkoppZRSSimllFJKKaWUUkoppZRSSimllFJKKaWUUkoppZRSSimllFJKKaWUUkoppZRSSimllFJKKaWUUkoppZRSSimllFJKKaWUUkoppZRSSimllFJKKaWUUkoppZRSSimllFJKKaWUUkoppZRSSimllFJKKaWUUkoppZRSSimllFJKKaWUCgDQjXAA0H0woQwUGrISAEgFAACMUYoxCKnFViHEmHMSWmutQogx5yS0lGLPmHMQSmkttp4xxyCUklqLvZTOSUmttRh7Kh2jklJLMfbeSyklpdhi7L2nkEKOLcbYe88xpRZbq7H3XmNKsdUYY++99xhjq7HW3nvvMbZWa44FAGA2OABAJNiwOsJJ0VhgoSErAYCQAADCGKUYY8w555xzTkrJGHPOQQghhBBKKRljzDkIIYQQQiklY845ByGEUEIopWTMOegghFBCKKWUzjkHHYQQQgmllJIx5yCEEEIJpZRSOucghBBCKKWEVEopnYMQQighhFJKSSmEEEIIoYRQUikphRBCCCGEUEJKJaUQQgghhBBKSKWklFIIIYQQQgillJRSCiWUEEIooaSSSimlhBBKCKGkVFIqqZQSQgglhJJKSimVVEooIYRSAADAgQMAQIARdJJRZRE2mnDhASg0ZCUAEAUAABkHHZSWG4CQctRahxyEFFsLkUMMWoydcoxBSilkkDHGpJWSQscYpNRiS6GDFHvPuZXUAgAAIAgACDABBAYICr4QAmIMAEAQIjNEQmEVLDAogwaHeQDwABEhEQAkJijSLi6gywAXdHHXgRCCEIQgFgdQQAIOTrjhiTc84QYn6BSVOhAAAAAAgAUAeAAAQCiAiIhmrsLiAiNDY4Ojw+MDRAAAAAAAsADgAwAACQEiIpq5CosLjAyNDY4Ojw+QAABAAAEAAAAAEEAAAgICAAAAAAABAAAAAgIitZ2CaGlTbo1BbmltZUR1YkhpbmRp4Ym1hEcsRACfgQI=", "base64");

describe("5. EBML reader", () => {
  it("reads variable-length integers with and without the marker bits", () => {
    assert.deepEqual(readEbmlVint(Buffer.from([0x8a]), 0), { value: 10, length: 1 });
    assert.deepEqual(readEbmlVint(Buffer.from([0x45, 0xff]), 0), { value: 0x5ff, length: 2 });
    // The element-ID form keeps the marker, which is what makes it comparable
    // to a documented id like 0x1A45DFA3.
    assert.deepEqual(readEbmlVint(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), 0, true), { value: 0x1a45dfa3, length: 4 });
    assert.equal(readEbmlVint(Buffer.from([0x00]), 0), null, "a zero leading byte is not a VINT");
    assert.equal(readEbmlVint(Buffer.from([0x80]), 1), null, "past the end");
  });

  it("reads the file's own track list out of a real head", () => {
    const head = readMatroskaHead(mkvHead());
    assert.equal(head.container, "matroska");
    assert.equal(head.doctype, "matroska");
    assert.equal(head.tracksSeen, true);
    assert.equal(head.partial, false);
    assert.equal(head.durationSec, 1425, "Duration is in TimecodeScale units, not seconds");
    assert.deepEqual(head.audio.map((a) => [a.number, a.kind, trackLanguage(a), a.codec, a.isDefault]),
      [
        [2, "audio", "hi", "A_VORBIS", true],
        [3, "audio", "ta", "A_VORBIS", false],
        [4, "audio", "te", "A_VORBIS", false],
        [5, "audio", "en", "A_VORBIS", false],
        [6, "audio", "ja", "A_VORBIS", false],
      ],
      "five audio tracks: the dubs, the encoded song signs and the Japanese original");
    assert.deepEqual(head.video.map((v) => [v.number, v.kind, v.codec]), [[1, "video", "V_MPEG4/ISO/AVC"]],
      "TrackType 1 is video; a reader that guessed the other way puts the video in the audio list");
    assert.deepEqual(head.subtitle.map((s) => [s.number, s.kind, trackLanguage(s)]),
      [[7, "subtitle", "en"], [8, "subtitle", "en"]], "subtitle is 0x11, not 3");
  });

  it("frames Duration as two bytes, the way the live file writes it", () => {
    const buf = mkvHead();
    const at = buf.indexOf(Buffer.from([0x44, 0x89]));
    assert.ok(at > 0, "the head carries a 4489 element");
    assert.equal(buf[at + 2], 0x84, "size 4 -> Duration is a float32 on disk");
    assert.deepEqual(buf.subarray(at + 3, at + 7), float32(1_425_000));
    assert.deepEqual(buf.subarray(at + 7, at + 10), Buffer.from([0x44, 0x61, 0x88]),
      "and DateUTC follows cleanly: 4461 with an 8-byte size");
    assert.equal(buf.indexOf(Buffer.from([0x44, 0x89, 0xd6])), -1,
      "a three-byte Duration id would put a stray byte where the size VINT belongs");
    assert.equal(readMatroskaHead(buf).durationSec, 1425);
  });

  it("refuses to call a truncated head a measurement", () => {
    const full = mkvHead();
    const cut = full.subarray(0, full.indexOf(Buffer.from([0x16, 0x54, 0xae, 0x6b])) + 30);
    const head = readMatroskaHead(cut);
    assert.equal(head.tracksSeen, true, "the Tracks element was found");
    assert.equal(head.partial, true, "but its declared size does not fit the head");
    assert.match(String(head.reason), /Tracks/);
  });

  it("says what is missing when Tracks is not in the head at all", () => {
    const onlyHeader = elem(ID.EBML, elem(ID.DocType, "matroska"));
    const head = readMatroskaHead(onlyHeader);
    assert.equal(head.tracksSeen, false);
    assert.equal(head.partial, true);
    assert.match(String(head.reason), /not inside/);
  });

  it("reports a non-EBML head as itself rather than as an empty file", () => {
    const png = readMatroskaHead(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]));
    assert.equal(png.container, "png");
    assert.match(String(png.reason), /not EBML/);
  });

  // The bytes above are written by a fixture, so they only prove the reader
  // agrees with itself. These are the first 8,477 B of a live 480p file, read
  // with `Range: bytes=0-8476` from the workers.dev terminal on 2026-10-14
  // (episode 01 of That Time I Got Reincarnated as a Slime, declared size
  // 160,950,974 B). It is the vector that corrected TrackType's order and
  // Duration's framing, and it is why a cut-off Tracks walk reports `partial`.
  it("reads the live file's own head, and refuses to over-claim a short one", () => {
    const head = readMatroskaHead(LIVE_HEAD_480);
    assert.equal(LIVE_HEAD_480.length, 8477);
    assert.equal(head.container, "matroska");
    assert.equal(head.doctype, "matroska");
    assert.equal(head.durationSec, 1423.1, "float32 1423089 at the default TimecodeScale");
    assert.equal(head.tracksSeen, true);
    assert.equal(head.video.map((v) => v.codec).join(), "V_MPEG4/ISO/AVC", "track 1 is the video");
    assert.deepEqual(head.audio.map((a) => [a.number, trackLanguage(a), a.codec]), [[2, "hi", "A_VORBIS"]]);

    assert.equal(head.partial, true, "this head stops mid-Tracks");
    assert.match(String(head.reason), /Tracks element extends \d+B past the 8477B head/);
    assert.equal(multiAudioVerdict("Multi Audio", head).provenance, "claimed",
      "a head that stops mid-Tracks has measured nothing, whatever it saw first");
    // Asking the same terminal for 64 KiB instead of 8,477 B covers the whole
    // Tracks element (it declares 44,296 B) and measures five A_VORBIS dubs —
    // hi/ta/te/en/ja — which is the live reading transcribed into mkvHead()
    // above and pinned through the whole chain by group 8's audioTruth test.
  });
});

// ================================================================ 6. audio

describe("6. the Multi-Audio verdict table", () => {
  const seen = (audio, partial = false) => ({ audio, tracksSeen: true, partial });
  it("confirms the claim when two languages are really in the container", () => {
    const v = multiAudioVerdict("Multi Audio", seen([{ language: "hi" }, { language: "jpn" }]));
    assert.equal(v.verdict, "multi");
    assert.equal(v.provenance, "measured");
    assert.deepEqual(v.languages, ["hi", "jpn"]);
  });
  it("corrects the claim when the file has one track", () => {
    const v = multiAudioVerdict("Multi Audio", seen([{ language: "hi" }]));
    assert.equal(v.verdict, "single-audio");
    assert.equal(v.provenance, "measured-corrected");
    assert.match(v.reason, /filename says "Multi Audio"/);
  });
  it("measures a single-language dub that never claimed multi", () => {
    assert.equal(multiAudioVerdict("Hindi dub", seen([{ language: "hi" }])).provenance, "measured");
    assert.equal(multiAudioVerdict("Hindi dub", seen([{ language: "hi" }])).verdict, "dub-single");
    assert.equal(multiAudioVerdict(null, seen([{ language: "jpn" }])).verdict, "sub-single");
  });
  it("stays a claim when nothing was measured", () => {
    const v = multiAudioVerdict("Multi Audio", seen([], true));
    assert.equal(v.verdict, "unknown");
    assert.equal(v.provenance, "claimed", "a truncated read must not look like a measurement");
  });
  it("corrects a file that carries no audio at all", () => {
    assert.equal(multiAudioVerdict("Multi Audio", seen([])).verdict, "no-audio-track");
  });
});

// ================================================================== 7. refs

describe("7. episode refs", () => {
  it("round-trips slug, number and the page getSources re-fetches", () => {
    const ref = encodeEpisodeRef({ seriesSlug: SERIES_SLUG, number: 7, pageUrl: FUNNEL_URL });
    assert.deepEqual(decodeEpisodeRef(ref), { seriesSlug: SERIES_SLUG, number: 7, pageUrl: FUNNEL_URL });
  });
  it("refuses a foreign prefix, a bad number or a non-URL page", () => {
    assert.equal(decodeEpisodeRef("aniwatch|1|https://x"), null);
    assert.equal(decodeEpisodeRef("animedubhindi|slug|0|https://x"), null);
    assert.equal(decodeEpisodeRef("animedubhindi|slug|3|not-a-url"), null);
    assert.equal(decodeEpisodeRef("animedubhindi|slug|3"), null);
  });
});

// ================================================================== 8. chain

const TERMINAL = "https://icy-feather-221c.jakcminasi.workers.dev/?id=abc123&name=%5BAnimeDubHindi%5D+Slime+EP+01+480p+x264+Multi+Audio.mkv";
const GATE = "https://filesforever.link/file/ja4znoh";

/** The whole "file": a real EBML head plus filler, small enough for a test. */
const FILE = Buffer.concat([mkvHead(), Buffer.alloc(1024 * 1024, 0x7f)]);

function stubSite({ decoy = false, short = false, ignoreRange = false, headOnly } = {}) {
  const calls = [];
  const html = (text, url) => ({
    ok: true, status: 200, url: url ?? "about:blank",
    headers: new Headers({ "content-type": "text/html" }),
    text: async () => text,
    arrayBuffer: async () => Buffer.from(text, "utf8").buffer,
  });
  const real = globalThis.fetch;
  globalThis.fetch = async (u, opts = {}) => {
    const url = String(u);
    calls.push({ url, headers: opts.headers ?? {}, redirect: opts.redirect });
    // What fetch does before it opens a socket for an already-aborted signal.
    if (opts.signal?.aborted === true) {
      const error = new Error("This operation was aborted");
      error.name = "AbortError";
      throw error;
    }
    if (/animedubhindi\.link\/\?s=/.test(url)) return html(LIVE_SEARCH_HTML, url);
    if (/animedubhindi\.link\/[^/]+\/$/.test(url)) return html(LIVE_SERIES_HTML, url);
    if (/adhlinks\.com\/episode\//.test(url)) return html(LIVE_ADH_PAGE, url);
    if (/new\.adhlinks\.com\/re\.php/.test(url)) {
      return html(`<script>var redirectUrl = "${Buffer.from(GATE).toString("base64")}";</script>`, url);
    }
    if (url.startsWith(GATE)) {
      // The landed page, as fetch would hand it after following the two 302s.
      return html(`<form><input type="hidden" name="source_url" value="${TERMINAL.replace(/&/g, "&amp;")}"></form>`,
        "https://pro.iqsmartgames.com/files/u0_token");
    }
    if (/new\.adhlinks\.com\/redirect\.php/.test(url)) {
      return {
        ok: false, status: 302, url, headers: new Headers({ location: "https://cuty.io/xyz" }),
        text: async () => `\n<!-- WEB UI --> https://cuty.io/api?api=k&url=${encodeURIComponent("https://mega.nz/file/ABC#key")}`,
      };
    }
    if (/workers\.dev/.test(url)) {
      const range = String(opts.headers?.range ?? "");
      const m = /^bytes=(\d+)-(\d+)$/.exec(range);
      const body = decoy ? Buffer.from("<html>token expired</html>") : (headOnly ?? FILE);
      // The live file the headOnly vector was cut from, so a caller asking for
      // 8,477 B of a 160 MB file sees the same arithmetic the site gives.
      const total = headOnly === undefined ? FILE.length : 160_950_974;
      if (!m || ignoreRange) {
        return {
          ok: true, status: ignoreRange && m ? 200 : 200, url,
          headers: new Headers({ "content-type": decoy ? "text/html" : "video/x-matroska", "content-length": String(body.length) }),
          arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.length),
        };
      }
      const start = Number(m[1]);
      const end = Math.min(Number(m[2]), body.length - 1);
      const slice = body.subarray(start, end + 1);
      const real_end = short && start === 0 ? Math.floor(end / 2) : end;
      const out = body.subarray(start, real_end + 1);
      return {
        ok: true, status: 206, url,
        headers: new Headers({ "content-type": "video/x-matroska", "content-range": `bytes ${start}-${real_end}/${total}` }),
        arrayBuffer: async () => out.buffer.slice(out.byteOffset, out.byteOffset + out.length),
      };
    }
    throw new Error(`stub got an unexpected URL: ${url}`);
  };
  return { calls, restore: () => { globalThis.fetch = real; } };
}

describe("8. chain against a stub (no network)", () => {
  it("search ranks the exact-title hit first", async () => {
    const site = stubSite();
    try {
      const hits = await search("that time i got reincarnated as a slime season 04", {});
      assert.equal(hits[0].id, `animedubhindi:${SLUG_1}`);
      assert.equal(hits[0].kind, "anime");
      assert.ok(hits.length >= 2);
    } finally { site.restore(); }
  });

  it("details walks series -> funnel and stamps dub on every episode", async () => {
    const site = stubSite();
    try {
      const { media, episodes } = await details(`animedubhindi:${SERIES_SLUG}`, {});
      assert.equal(media.title, "That Time I Got Reincarnated as a Slime Season 01");
      assert.deepEqual(episodes.map((e) => e.number), [1, 2]);
      assert.equal(episodes[0].url, FUNNEL_URL);
      assert.deepEqual(decodeEpisodeRef(episodes[0].id), { seriesSlug: SERIES_SLUG, number: 1, pageUrl: FUNNEL_URL });
      assert.ok(episodes.every((e) => e.audioType === "dub"), "the site publishes no sub group");
    } finally { site.restore(); }
  });

  it("sources hands out fifteen embeds and says what is available", async () => {
    const site = stubSite();
    try {
      const out = await sources(REF, {});
      assert.equal(out.embeds.length, 15);
      assert.deepEqual(out.direct, [], "nothing is resolved until a caller asks for bytes");
      assert.deepEqual(out.available, { sub: 0, dub: 15 });
      assert.equal(out.audioType, "dub");
      assert.deepEqual(out.mirrors.map((m) => m.quality).slice(0, 5), [480, 480, 480, 480, 480]);
    } finally { site.restore(); }
  });

  it("answers a sub ask with a reason, not with the dub files", async () => {
    const site = stubSite();
    try {
      const out = await sources(REF, { audioType: "sub" });
      assert.deepEqual(out.embeds, []);
      assert.equal(out.skip.audioType, "sub");
      assert.match(out.skip.reason, /no sub group/);
      assert.equal(out.available.dub, 15, "the walk still reports what the page published");
    } finally { site.restore(); }
  });

  it("refuses to resolve a hand-out it does not own", async () => {
    const site = stubSite();
    try {
      for (const url of ["https://hubcloud.ist/drive/kico5r2qkphwahf", "https://gdflix.dev/file/g0Ge9ij7cohfKvD"]) {
        await assert.rejects(() => resolve(url, {}), /claimed by its own extractor|drive page/);
      }
      await assert.rejects(() => resolve("https://example.com/file.mkv", {}), /not an adhlinks route/);
    } finally { site.restore(); }
  });

  it("walks re.php through the gate to a progressive terminal with a real size", async () => {
    const site = stubSite();
    try {
      const r = await resolve(RE_480, {});
      assert.equal(r.extractor, "adhlinks");
      assert.equal(r.kind, "progressive");
      assert.equal(r.terminal, TERMINAL);
      assert.equal(r.gate, GATE);
      assert.equal(r.variants.length, 1, "one file, not a rung ladder");
      assert.equal(r.variants[0].quality, 480, "from the file name the worker declares");
      assert.equal(r.variants[0].container, "matroska");
      assert.equal(r.variants[0].sizeBytes, FILE.length);
      assert.equal(r.master.url, TERMINAL);
      assert.equal(r.audioClaim, "Multi Audio");
    } finally { site.restore(); }
  });

  it("reports redirect.php as EMBED_ONLY with the leaked target named", async () => {
    const site = stubSite();
    try {
      await assert.rejects(() => resolve(REDIRECT_480, {}), (error) => {
        assert.equal(error.code, "EMBED_ONLY");
        assert.match(error.message, /mega\.nz\/file\/ABC#key/);
        const called = site.calls.find((c) => /redirect\.php/.test(c.url));
        assert.equal(called.redirect, "manual", "the 302 body is the payload, so it must not be followed");
        return true;
      });
    } finally { site.restore(); }
  });

  it("probes the terminal and reads its declared size from content-range", async () => {
    const site = stubSite();
    try {
      const p = await probeTerminal(TERMINAL, { headBytes: 64 * 1024 });
      assert.equal(p.ok, true);
      assert.equal(p.status, 206);
      assert.equal(p.container, "matroska");
      assert.equal(p.totalBytes, FILE.length);
      assert.equal(p.contentType, "video/x-matroska");
    } finally { site.restore(); }
  });

  it("refuses a terminal whose token died mid-chain (200 with HTML)", async () => {
    const site = stubSite({ decoy: true });
    try {
      await assert.rejects(() => probeTerminal(TERMINAL, {}), (error) => {
        assert.equal(error.code, "UPSTREAM_FAILURE");
        assert.match(error.message, /text/);
        return true;
      });
      const dir = await mkdtemp(join(tmpdir(), "adb-"));
      await assert.rejects(() => download(TERMINAL, { outPath: join(dir, "x.mkv") }), /DECOY_CDN|not a media container/);
    } finally { site.restore(); }
  });

  it("refuses a terminal that ignored the Range header", async () => {
    const site = stubSite({ ignoreRange: true });
    try {
      await assert.rejects(() => download(TERMINAL, { outPath: "/tmp/never-written", maxBytes: 1024 }), (error) => {
        assert.equal(error.code, "RANGE_FAILED");
        assert.match(error.message, /Range ignored/);
        return true;
      });
    } finally { site.restore(); }
  });

  it("writes a real .mkv prefix and labels it a requested cut, not a truncation", async () => {
    const dir = await mkdtemp(join(tmpdir(), "adb-test-"));
    const out = join(dir, "ep.mkv");
    const site = stubSite();
    try {
      const res = await download(TERMINAL, { outPath: out, maxBytes: 300 * 1024, chunkBytes: 128 * 1024 });
      const onDisk = await stat(out);
      assert.equal(res.sizeBytes, 300 * 1024);
      assert.equal(res.container, "matroska");
      assert.equal(res.mimeType, "video/x-matroska");
      assert.equal(res.declaredBytes, FILE.length);
      assert.equal(res.chunks, 3);
      assert.equal(res.truncatedUpstream, false);
      assert.equal(res.truncatedByRequest, true);
      assert.equal(onDisk.size, res.sizeBytes, "what it reported is what it wrote");
      const buf = await readFile(out);
      assert.equal(buf.subarray(0, 4).toString("hex"), "1a45dfa3", "the file on disk starts with EBML");
      await rm(out, { force: true });
    } finally { site.restore(); }
  });

  it("writes the whole file when no cap is set", async () => {
    const dir = await mkdtemp(join(tmpdir(), "adb-test-"));
    const out = join(dir, "full.mkv");
    const site = stubSite();
    try {
      const res = await download(TERMINAL, { outPath: out, chunkBytes: 700 * 1024 });
      assert.equal(res.sizeBytes, FILE.length);
      assert.equal(res.truncatedUpstream, false);
      assert.equal(res.truncatedByRequest, false);
      assert.equal((await stat(out)).size, FILE.length);
      await rm(out, { force: true });
    } finally { site.restore(); }
  });

  it("calls an upstream short file truncatedUpstream, not truncatedByRequest", async () => {
    const dir = await mkdtemp(join(tmpdir(), "adb-test-"));
    const out = join(dir, "short.mkv");
    const site = stubSite({ short: true });
    try {
      const res = await download(TERMINAL, { outPath: out, chunkBytes: 128 * 1024 });
      assert.equal(res.truncatedUpstream, true, "the server handed back half of what was asked");
      assert.equal(res.truncatedByRequest, false, "the caller asked for everything");
      assert.ok(res.sizeBytes < res.declaredBytes);
      await rm(out, { force: true });
    } finally { site.restore(); }
  });

  it("measures the audio claim from the container instead of trusting the name", async () => {
    const site = stubSite();
    try {
      const truth = await audioTruth(REF, {});
      assert.equal(truth.verdict, "multi");
      assert.equal(truth.provenance, "measured");
      assert.deepEqual(truth.languages, ["hi", "ta", "te", "en", "ja"]);
      assert.deepEqual(truth.audioTracks.map((t) => [t.languageTag, t.languageName]),
        [["hi", "Hindi"], ["ta", "Tamil"], ["te", "Telugu"], ["en", "English"], ["ja", "Japanese"]]);
      assert.equal(truth.claim, "Multi Audio");
      assert.equal(truth.quality, 480);
      assert.equal(truth.durationSec, 1425);
    } finally { site.restore(); }
  });

  it("keeps the verdict a claim when the head stops mid-Tracks", async () => {
    // The live 480p file at 8,477 B: one audio track is visible, Tracks is not.
    const site = stubSite({ headOnly: LIVE_HEAD_480 });
    try {
      const truth = await audioTruth(REF, { headBytes: LIVE_HEAD_480.length });
      assert.equal(truth.verdict, "unknown");
      assert.equal(truth.provenance, "claimed");
      assert.equal(truth.audioTracks.length, 1, "it did see the Hindi track");
      assert.match(String(truth.reason), /Tracks/);
    } finally { site.restore(); }
  });

  it("downloadEpisode picks the highest rendition and writes it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "adb-test-"));
    const out = join(dir, "ep.mkv");
    const site = stubSite();
    try {
      const res = await downloadEpisode("slime", 1, out, { maxBytes: 200 * 1024, chunkBytes: 100 * 1024 });
      assert.equal(res.media, TITLE_1, "the first search hit is the walk's target");
      assert.equal(res.episode, 1);
      assert.equal(res.quality, 1080, "renditions are tried best-first");
      assert.equal(res.sizeBytes, 200 * 1024);
      assert.equal(res.container, "matroska");
      await rm(out, { force: true });
    } finally { site.restore(); }
  });

  it("carries the caller's abort signal into every hop", async () => {
    const site = stubSite();
    try {
      const ac = new AbortController();
      ac.abort();
      await assert.rejects(() => search("slime", { signal: ac.signal }));
    } finally { site.restore(); }
  });
});
