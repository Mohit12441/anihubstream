# AniKoto + AniWatch + HiAnime + AnimeKai + AnimeWave + WatchAnimeWorld API — providers proven live, end to end

Self-contained, dependency-free ports of the six provider chains AniVerse v2
proved against the live sites on 2026-10-11..14.  Each provider is ONE file that
runs on plain Node 18+ (global `fetch` + `node:crypto`); nothing imports from
AniVerse.  The only file shared between them is `dubAudio.mjs`, the
dub-authenticity detector below — one rule, six providers, so the verdict cannot
drift per provider.

```
node cli.mjs --provider=anikoto  search "Solo Leveling"
node cli.mjs --provider=aniwatch search "Solo Leveling"
node cli.mjs --provider=aniwatch download "Solo Leveling" 1 ep1.ts --max-segments=3 --audio=dub
node cli.mjs --provider=hianime  download "Frieren" 1 ep1.ts --max-segments=6 --quality=360
node cli.mjs --provider=hianime  episodes "hianime:solo-leveling-e5tfvj"
node cli.mjs --provider=hianime  dub-check "hianime|68e887b9667215ba390c6d86|1|both|solo-leveling-e5tfvj"
node cli.mjs --provider=animekai episodes "animekai:solo-leveling"
node cli.mjs --provider=animekai dub-check "animekai|1|https://animekai.be/watch/solo-leveling/ep-1|sub"
node cli.mjs --provider=animewave episodes "animewave:solo-leveling-season-2-arise-from-the-shadow-3eukp"
node cli.mjs --provider=animewave download "Frieren" 1 ep1.ts --max-segments=6 --audio=dub
node cli.mjs --provider=watchanimeworld episodes "watchanimeworld:naruto"
node cli.mjs --provider=watchanimeworld lang-check "watchanimeworld|naruto|1|1|https://watchanimeworld.one/episode/naruto-1x1/"
node cli.mjs --provider=watchanimeworld download "naruto" 1 ep1.mp4 --max-parts=2 --quality=360
```

`episodes` prints each episode's ref in full, and that exact string is what
`sources`, `dub-check`, `resolve` and `download` take — so the chain is
self-chaining: read the `ref:` line, paste it into the next command.  Quote it;
the `|` separators are shell metacharacters.  An AniKoto ref is ~300 characters
(the opaque `data-ids` token plus the watch URL), which is why nothing here
shortens refs for display.

Or import one:

```js
import { search, details, sources, resolve, download } from "./hianime.mjs";
```

`--provider` defaults to `anikoto`.  Episode refs are provider-shaped
(`anikoto|…` / `aniwatch|…` / `hianime|…` / `animekai|…` / `animewave|…` /
`watchanimeworld|…`), so feeding one
provider's ref to the other fails loudly instead of parsing the wrong envelope.

| provider | file | what is special about it |
|----------|------|--------------------------|
| **AniKoto** | `anikoto.mjs` | richest chain: 3 megaplay embeds per episode, 9 subtitle tracks, skip marks (intro/outro), decoy-CDN failover |
| **AniWatch** | `aniwatch.mjs` | WordPress `hianime/v1` REST contract, base64 server hashes, explicit per-audio embeds (`…/sub`, `…/dub`), one rendition |
| **HiAnime** | `hianime.mjs` | JSON API (no HTML scraping), per-audio episode arrays, published dub counts, **two embed players in one provider**, cursor browse, and the only chain here with **selectable quality** (up to 3 real rungs) |
| **AnimeKai** | `animekai.mjs` | the site states its audio as **markup** instead of as data — one watch page, two `lang-group` columns, `data-sub`/`data-dub` flags on every episode row, 1,165 episodes behind a meta-refresh shell, and two server sids that can point at one file |
| **AnimeWave** | `animewave.mjs` | the ajax routes answer **200 with a JSON error body** unless `x-requested-with: XMLHttpRequest` is sent — the failure mode that got this site filed as dead; the **decoy CDN is the first embed in the list** (`…?s=tcdn` → PNGs), so walking the list in order ends on a fake; 1,180 One Piece rows arrive in one payload and 25 of them are sub-only |
| **WatchAnimeWorld** | `watchanimeworld.mjs` | **no embed layer and no HLS at all**: the player page hands over an AES-256-CTR manifest and the MP4 arrives as 2 MiB parts whose URL is itself an encrypted token.  Every episode is a dub and no sub group exists, so the byte-pair rule has no peer here — the measurable audio question is **language vs language** |

## Why these six

Of every provider AniVerse carries, these are the ones whose **full** chain is
live-confirmed — search → details → episodes → sources → playable → download —
with every hop reproduced over real HTTP and a real video file proven on disk.
The task was: pick an API, prove it live, prove its features, export it; then
move to the next one and do the same.  Six providers down, one contract each.

Selection was by measurement, not by what the registry claimed:

- **KissKH** — search 200 (4 hits) and drama 200 (26 episodes), then
  `DramaList/Episode/179189.png` → **403, 0 bytes**, with and without the `kkey`
  token; `/api/Sub/…` also 403.  The site's own `common.js` still carries part of
  the old tuple but no longer `4830201` / `kkey` / `2.8.10`, i.e. the signing
  scheme rotated.  Dead at the sources hop, so nothing to export.
- **AnimeWave** — first passed over on a false reading.  An earlier survey hit
  `/ajax/anime/search?keyword=…` and got `{"status":500,"result":"Bad request"}`
  and recorded the site as dead.  The transport said **200**; the 500 is a number
  inside a JSON body, i.e. the site's own complaint about the request, and the one
  thing missing from that request was `x-requested-with: XMLHttpRequest`.  Same
  URL, 2026-10-13, A/B: **with** the header → 200 / 3,939 bytes / 5 slugs (twice
  running); **without** it → 200 / 50 bytes / the error body above.  Every later
  hop then answered too, so the chain is exported above.  The takeaway runs the
  other way from a dead site: no provider gets retired on one headerless probe, and
  `verify.mjs`'s `probe` line now checks the answer's *shape* rather than its status
  (Provider 5, finding 1).
- **AniWatch** — every hop answers 200 and the embed resolves to real MPEG-TS.
  Exported above.
- **AnimeKai** — first passed over: playable, but every hand-out is a
  `megaplay.buzz` embed, i.e. the pipeline `anikoto.mjs` and `aniwatch.mjs`
  already carry, so exporting it would have added a provider file and no new
  mechanism.  Taken on the fourth round instead, and the reason to take it turned
  out to be a defect the app was carrying: this site's dub column is a *claim in
  markup*, and `getSources` was treating "the dub column is empty" as "fall back
  to sub" — so a dub ask on one of One Piece's 15 sub-only rows played Japanese
  and labelled it English (see *What this site does differently*).  That is the
  `#138` audio-scoping rule in a fourth place, and a provider whose rows are
  shaped this way is where it earns its keep.
- **AnimePahe** — the player hop dies at `megaup.cc` with `NO_EXTRACTOR`; there is
  no resolver for that host and no measured contract to write one from.
- **HiAnime** — the only remaining chain that reaches bytes through a player and a
  CDN family none of the other exports touch: `animehot.cc` JSON API →
  `zokoanime.video` jwplayer shell → `hls.dramahot.top`.  Exported below.
- **WatchAnimeWorld** — taken last, and taken because it is the one chain here that
  reaches bytes through **neither an embed host nor HLS**: `watchanimeworld.one` →
  `player.abyssplayer.com/<slug>` → an encrypted manifest → `<sub>.sssrr.org` MP4
  parts.  Five providers down, every exported mechanism was a megaplay/zoko HLS
  variant; this one adds a token derivation, a manifest decrypt and a part stitch,
  none of which the other files contain.  It is also the last site the dub census
  (`#143`) owed, and it closes that census with a shape the other five never
  produced: a provider with **no sub group to compare against**, where the audio
  question has to be re-asked as a language question (see *Provider 6*).

### AniKoto live status (measured 2026-10-12)

| hop | result |
|-----|--------|
| site | `anikototv.to` answers 200 |
| provider gate | `status=enabled`, tier `RUNTIME_CONFIRMED` |
| search | 8 hits for "Solo Leveling", ranked (base series first) |
| details | `anikoto:solo-leveling-ilh08` → 12 episodes |
| sources | 3 embeds (megaplay), `skip.outro=[1325,1414]` |
| resolve | signed HLS master + 9 subtitles |
| playable | range GET returns real MPEG-TS bytes |
| download | completed episode = 305,795,536 B, `video/mp2t`, 40/40 TS packet sync |

## AniKoto: the chain

```
GET /filter?keyword=<q>                    search cards
GET /watch/<slug>                          #watch-main[data-id], canonical data-url
GET /ajax/episode/list/{id}?vrf=           episode anchors (data-ids = opaque token)
GET /ajax/server/list?servers=<token>      per-episode server list (sub/dub/hsub groups)
GET /ajax/server?get={linkId}              embed URL + skip_data
    -> megaplay embed -> getSources -> AES-decrypt -> CDN master.m3u8?token=...
```

`vrf` is sent **empty** on purpose.  The site answers without it; AniKoto's own
JS has a generator, but reproducing it to reach gated endpoints would circumvent
an anti-abuse control, so V2 does not.  Every request above carries a `Referer`
of the embedding site — that is what the live probe (doc 68) needed to succeed.

## AniKoto: audio — what `sub` and `dub` mean

- **`sub`** — the original **Japanese** audio, read with subtitles.
- **`dub`** — the **English** dubbed audio.
- **`hsub`** — a hard-subtitled form of the sub group; `sources()` treats it as `sub`.

An episode row's `audioType` is `sub` | `dub` | `both`, where `both` means the
site publishes a Japanese-audio and an English-audio version of that episode.

The site itself never writes a language name.  `/ajax/server/list` separates the
versions only by `data-type="sub"` / `data-type="dub"`, and the readable labels
inside those groups are server names ("HD-1", "Vidstream-1", "Vidstream-2"), so
the meaning above is the convention this API follows, not a string scraped from
the page.  The difference is physically real, though: measured 2026-10-12 on
`Ore dake Level Up na Ken` ep 1, six segments of each group decoded to an
**identical** sample count (4,911,182 WAV bytes) from **different** audio streams
— AAC at 116,945 bit/s for `sub` against 130,684 bit/s for `dub`, 2,992,208 B
against 3,311,056 B.  Same picture, same timing, a different voice track: that is
what a dub is.  Both groups advertise the same 9 subtitle tracks
(ara, eng, fre, ger, ita, por, rus, spa×2).

## AniKoto: features (the exported API — the same names exist in `aniwatch.mjs`, `hianime.mjs`, `animekai.mjs` and `animewave.mjs`)

| function | what it proves |
|----------|----------------|
| `search(term)` | the Unicode-500 fix (curly quotes → ASCII) + colon fallback |
| `details(id)` | watch page → media metadata + episode list |
| `sources(ref)` | opaque server token → embed URLs + skip marks |
| `resolve(embed, referer)` | embed → token-signed HLS master + variants + subtitles |
| `download(url)` | read the playlist like a player → **one real MPEG-TS file** |
| `downloadEpisode(term, ep, out)` | the whole thing in one call, with embed failover |
| `dubPairVerdict(sub, dub)` | the `/dub` **file** vs the `/sub` file — same bytes or a second audio (see *`dubPairVerdict`* below) |

## AniKoto: what live measurement found — the download defects

Four stacked defects (fixed in AniVerse, encoded in this port) plus the decoy
CDN.  Each was invisible to "did it return 200"; only reading the bytes caught
them.

1. **Invalid URL on the relative proxy path** — the hand-out is a relative
   `/api/proxy/stream?token=…`; downloading it needs the origin restored first.
2. **Duplicate `Referer` → CDN 403** — nexabloom rejects the header *pair*; the
   HTTP client must not add a second Referer when one is already set.
3. **`ensureDir` never called → ENOENT with counted bytes** — the transfer
   reached several KB, then died writing into a directory nobody had created,
   while the byte counter happily kept counting.  The directory must exist
   before piping; here `mkdir(dirname(outPath), {recursive:true})` does it, and
   the stream's `open` event is awaited so a bad path is an honest error, not a
   silent one.
4. **The "video" was the playlist** — piping the `.m3u8` to disk saved a
   43,839-byte text file starting `#EXTM3U` and called it a completed download.
   A download must parse the playlist and concatenate the segments.  Measured
   proof of the fix, same title/episode/source:

   ```
   OLD  …source-d2847271_…bin  43,839 B   first=23 45 58 54 4d 33 55 0a (#EXTM3U)  TS-sync 0/40
   NEW  …source-30babb59_…ts  305,795,536 B  first=47 40 00 10 (MPEG-TS PAT)        TS-sync 40/40
   ```

5. **Decoy CDN** — measured 2026-10-12: AniKoto's *first-listed* embed
   (`…/sub?s=tcdn`) resolves via MegaPlay to `megap.shiora.top`, whose segments
   are **PNG files** (`89 50 4E 47`, 626 KB each) — they pass every size check
   but contain no video.  The plain embed (`…/sub`) resolves to
   `fetch.nexabloom.top` and answers `47 40 00 10` with 0x47 on every 188-byte
   stride.  So `download()` sniffs the first segment's container and throws
   `DECOY_CDN`, and `downloadEpisode()` fails over to the next embed.  "Playable"
   is proven by the written bytes, not by a URL that resolved.

Also fixed: the 5-minute transfer wall that would fail every real video (AniVerse
now allows 30 min; ~750 KB/s, a 1080p episode is ~300 MB).

## Playback contract (for a browser)

`resolve()` returns the **upstream** URL + required headers (`Referer`,
`X-Requested-With`) and a per-request token signed from the unix-seconds clock.
A browser cannot fetch that CDN directly (CORS + Referer gate), and the token
expires by freshness, so it must never be cached.  A web player must request it
through its own **same-origin proxy** that injects the upstream headers — the
shape AniVerse uses at `/api/proxy/stream?token=…`.  Node and native players can
use the resolved URL + headers directly.

## Provider 2 — AniWatch (`aniwatch.co.at`)

A different site, a different contract, the same last mile.  AniWatch is a
WordPress deployment of the "Zoro Tv" theme whose REST namespace is `hianime/v1`;
its own player hands out **the same Megaplay embeds** AniKoto uses, so one
resolution pipeline serves both — and `resolve()` stamps `provider:"aniwatch"`
because provenance belongs to the call, not to the pipeline.

Live status measured 2026-10-12 (Solo Leveling Season 2):

| hop | result |
|-----|--------|
| site | `aniwatch.co.at` answers 200 |
| search | `search/suggestions?keyword=Solo Leveling` → 2 cards, ranked |
| details | `/anime/solo-leveling-season-2-arise-from-the-shadow/` → 147,504 B, `data-animeid=2138`, real synopsis, romaji title, cover |
| episodes | `episode/list/2138` → 13 rows; ep 1 = `id=2140` "You Aren't E-Rank, Are You?" |
| sources | `episode/servers/2140` → 2 rows `{sub:"HD-1", dub:"HD-1"}` → `1anime.site/megaplay/stream/s-2/131394/{sub,dub}` |
| audio census | **13/13** episodes publish exactly one sub + one dub server row |
| resolve | signed master on `fetch.nexabloom.top`, 1 variant @1080, 5 subtitles (chi eng ind tha vie) |
| playable | segment 1 = 436,536 B (sub) / 541,816 B (dub), `47 40 00 10`, 0x47 every 188 B |
| download | one-call `download "Solo Leveling" 1 --max-segments=3 --audio=dub` → 1,538,216 B `video/mp2t`, `audio=dub` |

```
GET /wp-json/hianime/v1/search/suggestions?keyword=<q>   {success, html}  a.nav-item cards
GET /anime/<slug>/                                        data-animeid, h2.film-name[data-jname]
GET /wp-json/hianime/v1/episode/list/<animeId>           {status, html}  a.ep-item[data-id|data-number|href]
GET /wp-json/hianime/v1/episode/servers/<episodeId>      .server-item[data-type|data-server-name|data-hash]
    data-hash = base64 of the embed URL
    -> identical Megaplay pipeline -> CDN master.m3u8?token=…
```

### Three things that decide whether this chain parses

1. **The payload is HTML inside JSON, with escaped slashes.** `search/suggestions`
   and both `episode/*` routes answer `{"success":true,"html":"<a href=\"https:\/\\/…"} `.
   Running the card regex on the raw body finds **0** results; it must be
   `JSON.parse(body).html` first.  (This exact miss cost a false "provider is
   dead" verdict during measurement — the response was 200 with real cards in it.)
2. **`data-hash` is base64 of the embed URL**, not an id to feed another endpoint.
   A hash that decodes to anything but `http(s)` is a site change, so
   `parseServerItems` drops it instead of passing a non-URL downstream to fail.
3. **The numeric series id is a REST input, not a locator.** `episode/list/2138`
   needs the number; the page is opened by slug.  `details("aniwatch:2138")`
   therefore throws rather than fetching `/anime/2138/` and reporting an empty
   page as "no episodes".

### Audio

`sub` = original Japanese audio read with subtitles, `dub` = English voices (the
convention this folder follows, stated in full above).  AniWatch adds one thing
AniKoto does not: **the embed URL itself says which audio it carries** —
`…/stream/s-2/131394/sub` versus `…/131394/dub`.  That is the only per-file audio
fact the site states, so `resolve()` reads it into `audio` and `audioOfEmbed()`
is exported for callers that build a source ladder.  It matters because both
server rows are labelled "HD-1": a picker keyed on the site's own label cannot
tell the Japanese audio from the English one at all.

Episode rows carry `audioType:"both"` — measured, not assumed: all 13 rows
publish a sub *and* a dub server, so a row is the site's toggle rather than one
audio.  What actually played is only knowable from the file, which is what
`resolve().audio` gives.

The two groups are physically different files: same episode, different signed
CDN directory (`…/4b5ed938…/ede456520a…/master.m3u8` for sub,
`…/4b5ed938…/575e421ce8…/master.m3u8` for dub) and different bytes for the same
first segment position (436,536 vs 541,816).  The voice-track proof itself
(decoded AAC bitrates) was done on the AniKoto side of this same extractor, above.

### AniWatch gaps (measured 2026-10-12)

1. **One embed per audio group.** `sources()` returns sub=1, dub=1, so the
   per-embed failover that saves AniKoto has nowhere to go here: if this CDN
   ever answered a decoy container, `DECOY_CDN` would be terminal.  Same code,
   no depth.
2. **One rendition.** The signed master exposes a single 1080 ladder rung, so
   there is no 480p/720p to request (site-side limit, as on AniKoto).
3. **No skip marks.** `episode/servers` carries no intro/outro data and this
   export does not go looking for it on another route; AniKoto's
   `skip.outro=[1325,1414]` has no equivalent here.
4. **Search is suggestions, not a search page.** 2 cards for "Solo Leveling"
   against AniKoto's 8.  No pager, no browse/genre listing (the REST index
   publishes only suggestions, `episode/list`, `episode/servers` and account
   routes).
5. **Metadata is thin and honestly so.** Title, `data-jname` original title,
   cover, synopsis.  `data-duration`, `data-count`, `data-jp`, `itemprop` and
   genre anchors are absent from the page (verified by `indexOf`, not by a regex
   that could miss), so year/genres/runtime stay off the model instead of being
   guessed out of the title.
6. **`sources().subtitles` is always `[]`** — the same dead field as AniKoto;
   tracks only appear after `resolve()`.
7. **Subtitle set is fixed at 5** (chi eng ind tha vie) on both audio groups —
   no Japanese burn-in and no second English form, unlike AniKoto's 9.

## Provider 3 — HiAnime (`animehot.cc`)

A third site, a **third contract**, and a player/CDN family neither of the other
two exports touches.  HiAnime answers JSON — `POST /api/filter`, `GET
/api/anime/<slug>`, `GET /api/episodes/<mongoId>?start=&end=` — so nothing here is
HTML scraping, and its default player (ZokoAnime) publishes its stream by
base64-decoding `window.__P` and XOR-ing it against a repeating ASCII key
(`otaku-embed-v1`) instead of AES-ing a `getSources` blob.  The same episode often
also hands out a Megaplay embed, which is why `resolve()` returns an `extractor`
name rather than assuming one pipeline.  `resolve()` stamps `provider:"hianime"`.

Live status measured 2026-10-12 (Solo Leveling ep 1 unless stated):

| hop | result |
|-----|--------|
| site | `animehot.cc` answers 200; `hianimes.se` is only the Next.js shell |
| search | `POST /api/filter {page,limit,keyword}` → 4 hits, base series first; `limit` capped at 50; `keyword:""` = the 2 592-row catalogue |
| details | `/api/anime/solo-leveling-e5tfvj` → 12 episodes, cover, year 2024, `Score` 8.22, rating label, 3 genres, `mal_id` 52299, `_id` 68e887b9… |
| episodes | `/api/episodes/68e887b9667215ba390c6d86?start=1&end=12` → 12 rows; `totalEpisodes` 12 == 12 listed |
| sources | row `link` = `{sub:[…],dub:[…]}` → 1 + 1 for Solo Leveling, **2 + 2** for Frieren (zoko *and* megaplay) |
| audio | honoured *strictly*: `dub` reads `link.dub`, and a `dub:[]` row answers with zero embeds instead of the Japanese audio |
| resolve | zoko → `hls.dramahot.top` master (needs `Referer: https://zokoanime.video/`), rungs `1080/360`, 1 subtitle (eng), `audio` from the embed path |
| resolve | megaplay → AES-decrypted `enc` → `fetch.nexabloom.top/master.m3u8?token=…`, rung `1080`, 1 eng sub, `skip={intro:[0,89],outro:[1460,1549]}` |
| playable | segment 1 = 1,022,156 B, `47 40 00 10`, 0x47 on every 188-byte stride |
| download | `download "Frieren" 1 out.ts --max-segments=3 --audio=dub --quality=360` → 1,539,344 B `video/mp2t`, ~29.5 s, `audio=dub rungs=360` |

```
POST /api/filter            {page,limit<=50,keyword}   -> {total,page,totalPages,results[]}
GET  /api/anime/<slug>      ?cursor=<24-hex _id>        -> {anime} | {animes[20],nextCursor,hasNextPage,pageSize}
GET  /api/anime/<slug>                                  -> {anime{_id,totalEpisodes,totalSub,totalDub,Score,score,…}}
GET  /api/episodes/<_id>?start=&end=                    -> {total,episodes[]{episodeNumber,title,slug,link{sub[],dub[]}}}
     -> zokoanime.video/stream/mal/<malId>/<ep>/{sub,dub}
          window.__P -> base64 -> XOR "otaku-embed-v1" -> {src,subtitles,default_audio,skip,player,…}
          -> hls.dramahot.top master (Referer-gated) -> MPEG-TS
     -> megaplay embed -> getSources -> AES-256-CBC enc -> HMAC-signed ?token= -> fetch.nexabloom.top
```

### What this provider has that the other four do not

| feature | measured |
|---------|----------|
| browse / catalogue | `browse()` over both routes: offset (`page`,`limit<=50`, 2 592 rows) and cursor (`_id` floor, 20 rows/page).  Filters only work with the site's spelling: `type:"TV"` → 1 686, `status:"Finished Airing"` → 2 138, `type:"tv"` → **0** |
| selectable quality | the master publishes real rungs: `1080/720/360` on Frieren, `1080/360` on Solo Leveling.  `download(…, {quality})` proved both: 360 → **4,946,468 B / 640x360**, 1080 → **20,629,804 B / 1920x1080** (`ffprobe dur=65.760000s`) |
| metadata per row | 25/25 catalogue rows carried `nativeId`, `malId`, `audio{sub,dub}`, `episodeCount`, synopsis, score, banner — no per-title visit needed |
| two players in one episode | Frieren ep 1 publishes 2 sub + 2 dub embeds across `zokoanime.video` and `megaplay`, so one episode can be resolved twice through two different crypto schemes |
| audio availability up front | `totalSub`/`totalDub` on the card and `link.sub[]`/`link.dub[]` lengths on the row — as **fields in a JSON response**, which is what AniKoto has to be probed for (AnimeKai publishes the same information, but as `data-sub`/`data-dub` markup that has to be scraped per episode) |

**Two fields collide and only one is a score**: `Score` = `"8.22"` (audience),
`score` = `"R - 17+ (violence & profanity)"` (parental label, also in `Rating`).
Reading `score` as a score would put a rating string in a numeric field.

### The two things that decide whether this chain parses

1. **The ZokoAnime config is XOR-obfuscated, not encrypted.** `window.__P` is
   base64; the bytes XOR against the repeating ASCII key `otaku-embed-v1`; the
   result is UTF-8 JSON.  ~1.6 KB of jwplayer shell around it, so a parser that
   looks for a `.m3u8` in the page text finds nothing.
2. **The CDN is referer-gated and rotates hosts mid-playlist.** The master on
   `hls.dramahot.top` returns 200 only with `Referer: https://zokoanime.video/`,
   and its variant playlists list segments on a second host that refuses them
   (measured 2026-10-12: `hls1.drama1.cfd` **403 ×8** on the 360p path while
   `hls.dramahot.top` answered **200 ×8** for the same path).  `resolve()`
   therefore rewrites every URL onto the master origin (`ontoOrigin`) and says so
   in `note`; `resolve()` returns `variants[0].headers` and a browser needs its own
   same-origin proxy for these, exactly as for the other four providers.

The 403 is intermittent per path, so `download()` drains the unread body and
retries up to 3 times before believing a refusal — the first 8-probe on one
identical segment answered 0/8 and the second 8/8.

### Segment order is proven, not assumed

`download()` fetches 4 segments concurrently but releases writes strictly in
playlist order (an index-ordered slot table behind a chained writer).  Same
episode, same rung, three concurrency settings:

```
concurrency 1  32,459,140 B  md5 7d5d7929c48316625a0502c2d9c7a707
concurrency 4  32,459,140 B  md5 7d5d7929c48316625a0502c2d9c7a707
concurrency 8  32,459,140 B  md5 7d5d7929c48316625a0502c2d9c7a707
```

A concatenated MPEG-TS with its segments out of order still plays for the first
few seconds, so this is invisible to "did it play" and only visible to a hash.

### Audio: honoured by the API, and sometimes a lie in the file

`sub`/`dub` here are separate arrays and `sources()` reads exactly the one it was
asked for, which is what AniKoto's export documents as unwired.  What the API
cannot promise is that the `/dub` file contains English voices.  Measured across
14 titles that publish a `/dub` embed, by demuxing the audio PID of the first
segments (`ffmpeg -vn -c copy`) and hashing it:

| verdict | count | titles |
|---------|-------|--------|
| zoko `/dub` is a **byte copy** of `/sub` | **5 / 14** | Solo Leveling, Frieren, Kaiju No. 8, Mushoku Tensei, Spy x Family |
| zoko `/dub` carries a real second audio | 9 / 14 | Vinland Saga, Demon Slayer, Jujutsu Kaisen, Chainsaw Man, [Oshi no Ko], One Piece, Naruto, Attack on Titan, A Silent Voice |
| megaplay `/dub` carries a real second audio | 1 / 1 tested | Frieren ep 1 (identical episode whose zoko `/dub` is a copy) |

The served container holds **one** audio stream (`h264` + one AAC PID,
`TAG:language=und`) — there is no second track to switch to, so a copied `/dub`
is not a dub with the wrong default, it is the Japanese audio wearing a `/dub`
URL.  Vinland Saga ep 1 is the clean contrast: sub audio 352,934 B @110 kbit/s
against dub audio 165,881 B @101 kbit/s.

Two consequences for anything built on this file:

- `resolve().audio` names the **embed path** (`…/1/sub` → `sub`), which is the
  site's claim, not the file's.  Treat it as provenance and measure the claim with
  `dubPairVerdict()` (below) when an English promise matters.
- A `/dub` array being non-empty is not proof a dub exists.  Bocchi the Rock!
  publishes `link={sub:1,dub:0}` — and an earlier revision of this module turned
  that into a dub download by falling back to the sub array.  The fallback is
  gone: `sources(…, {audioType:"dub"})` now returns **zero embeds** plus
  `available:{sub:1,dub:0}`, and `downloadEpisode` refuses with
  `EMPTY_STREAM: … has no dub embeds (row publishes {"sub":1,"dub":0})`.

### `dubPairVerdict` — measuring the claim instead of trusting it

`resolve().audio` is the site's word.  `dubPairVerdict(subEmbed, dubEmbed, opts)`
(`dubAudio.mjs`, bound per provider and exported by all five embed providers; the
sixth imports the same `sharedRung` + `headFingerprint` and binds them to a
**language** pair — see `audioPairVerdict` under Provider 6) is the byte
measurement of it, and the rule is the one validated against the 14-pair ffmpeg
census above:

```
node cli.mjs --provider=hianime dub-check "hianime|68e887b9667215ba390c6d86|1|both|solo-leveling-e5tfvj"

offered: sub=1 dub=1 embed(s)
  sub: https://zokoanime.video/stream/mal/52299/1/sub?autostart=false&asi=0
  dub: https://zokoanime.video/stream/mal/52299/1/dub?autostart=false&asi=0
verdict=copy  rung=1080
  sub head 262144B of 1022156 f8b48be6…
  dub head 262144B of 1022156 f8b48be6…
```

The rule, in order:

1. `sources()` both groups, pair the embeds that share a player host, `resolve()`
   the pair.
2. Take the **highest rendition label present on both sides** and read the **first
   media segment** of each.
3. `unknown` = either side was not measurable — a dead embed, no segment URI, a
   head under 64 KiB, or a head that is not media.  Otherwise `distinct` when the
   two declared `Content-Length` values differ, and otherwise the head md5 decides:
   equal is `copy` (the site serves the same file twice, so its "dub" carries no
   second audio), unequal is `distinct` (NOT proof of English audio — only that the
   site is not serving one file twice).

Six measured guards, each because a naive version got it wrong:

- **No `Range` header.** `hls1.drama1.cfd` answered
  `range: bytes=0-262143` with a **146-byte** body while the plain GET of the same
  URL served 279,932 B.  A refused Range turns a copy into `distinct` — the wrong
  direction, so the head is read from an ordinary 200 and the body is cancelled.
- **A floor on the head, and it is unconditional.**  Below 64 KiB the "head" is an
  error page, and two error pages are byte-identical, which would read as `copy`.
  A size-equality pre-check does not rescue it either: `hls1.drama1.cfd` *declares*
  that 146-byte size, so two refused requests match on length too.  It answers
  `unknown (head too small to be media 146B / 146B)` — `distinct` is a claim, and a
  head that small was never measured.  The smallest real segment head in the 14-pair
  census claimed 279,932 B, so the floor never fires on a file.
- **Two identical embeds say nothing.**  A provider that ignores the audio group
  hands the same URL to both asks, and hashing one file against itself reads `copy`
  — which would delete a dub that works.  Identical starting URLs answer
  `unknown (identical embed URL on both sides)`.
- **A byterange window is not a track.**  `#EXT-X-BYTERANGE` means the next URI is a
  slice of a bigger file, so reading it from byte 0 hashes the bytes *before* the
  window and the verdict is about the wrong bytes.  `firstSegmentUri` refuses it
  (`no segment URI (byterange addressed segment)`).
- **The head is sniffed.** Measured 2026-10-12: AniKoto's `?s=tcdn` selector routes
  BOTH `/sub` and `/dub` to `*.tiktokcdn.com`, where each "segment" is a **PNG**
  (626,292 B / 857,908 B, `89 50 4E 47`) — the decoy `download()` already refuses.
  Hashing two pictures is not an audio verdict, so an image or text head answers
  `unknown (segment unreadable: not media (png) not media (png))`.  Pair the embeds
  you actually serve, and read `unknown` as "not measured", never as "the dub is fine".
- **Same-rung pairing**, with a fallback that is honest about itself.  Naruto ep 1
  publishes only `800` on `/sub` and only `480` on `/dub` — no label is shared, so
  the best rung of each side is paired and reported as `rung=800|480`.  A
  byte-for-byte match across two labels is still the same file, so `copy` remains
  reachable there; a mismatch can only produce `distinct`, which never removes a
  working dub.

Re-run through the shipped function on the same 14 zoko pairs
(`.tmp-runtime/dubcheck-census.mjs`, 2026-10-12):

```
match=14  miss=0  unmeasured=0        (copy on all 5 fakes, distinct on all 9 reals)
Solo Leveling   copy     1080  1,022,156 = 1,022,156      Frieren   copy  3,807,752 = 3,807,752
Kaiju No. 8     copy     2,604,552 = 2,604,552            Mushoku   copy  3,809,068 = 3,809,068
Spy x Family    copy     4,564,076 = 4,564,076            Vinland   distinct 1,308,856 vs 743,352
Demon Slayer    distinct 1,892,784 vs 538,808             Jujutsu   distinct 259,064 vs 295,160
Chainsaw Man    distinct 385,400 vs 379,384               Oshi no Ko distinct 2,265,588 vs 1,088,708
One Piece       distinct 1,161,464 vs 1,155,448           Naruto     distinct 800|480 238,008 vs 1,149,432
Attack on Titan distinct   836,600 vs 1,134,392           A Silent Voice distinct 1,036 2,006,712 vs 2,000,696
```

The guard costs nothing on real media: re-running the same 14 pairs after adding
the sniff gives `match=14 miss=0 unmeasured=0` again, byte counts identical.  Same
after the three guards ported from the app on 2026-10-12 (identical-embed refusal,
the unconditional floor, the byterange refusal): `match=14 miss=0 unmeasured=0`,
every byte count the same as the table above.

It is one rule, not a zoko rule.  The same command on the other two providers that
had pairs to measure that evening:

```
--provider=aniwatch dub-check "aniwatch|2003|1|https://aniwatch.co.at/solo-leveling-episode-1-english-subbed/"
  sub: 1anime.site/megaplay/stream/s-2/114721/sub   dub: …/114721/dub
  verdict=distinct  rung=1080  sub 262,144B 25f348b6…  dub 262,144B 397c4826…   <- real dub
--provider=anikoto  dub-check "<anikoto|… ep1 ref>"
  sub: megaplay.buzz/stream/s-2/114721/sub?s=tcdn   dub: …/114721/dub?s=tcdn
  verdict=unknown  (segment unreadable: not media (png) not media (png))        <- the decoy, refused
```

The AniWatch pair is the megaplay chain the AniWatch table above measured at
436,536 B / 541,816 B — same conclusion, one request per side instead of two
segment downloads.  And note what the `nexabloom` head shows: that CDN sends **no
`Content-Length`**, so the size-equality test cannot run and the head comparison
alone decides.  That is exactly why the 64 KiB floor is checked *before* the
comparison and not only when a size is missing — an undeclared error page would
otherwise be decided by its md5 alone.

The fourth provider runs the same line with no new machinery:
`--provider=animekai dub-check "<animekai|… ref>"` answers 7/7 `distinct` (see the
*AnimeKai dub census* under Provider 4), which is the other half of why the rule
belongs in one shared file — a per-provider detector would have had to re-decide
what "same bytes" means, and would have produced five different verdicts for one
pair of files.

### Proving the rule without a live site (`dubAudio.test.mjs`)

Everything above was proven by asking third-party servers for bytes, which means a
regression in the rule only surfaces when one of them happens to be up.  `npm test`
(from the `anihubstream` root: `node --test api/*.test.mjs` — **73 tests / 13
suites / 0 fail**, no network: 40 in the five groups below, plus the 33 that pin the
WatchAnimeWorld chain, see Provider 6) runs the same rule against a stubbed `fetch`
and needs no network:

- **harness** — the stub is the transport the rule actually runs on: a playlist read as
  `text()`, a segment read as a stream, four plain GETs, no `Range` header anywhere.  A
  case that passes on a broken stub proves nothing, so the stub is pinned first.
- **pure** — `firstSegmentUri` (header-only playlist, comment lines, relative vs
  absolute, a URI that will not parse, a byterange window), `sharedRung`, `headContainer`.
  `firstSegmentUri` deliberately does NOT refuse a `.png` — that is the sniffer's job, and
  the case says which half owns it.
- **matrix** — one case per census row, with its numbers: `copy` on all seven zoko fakes
  (1,022,156 / 3,807,752 / 2,604,552 / 3,809,068 / 4,564,076, then Sakamoto Days
  1,420,340 and Hell's Paradise 4,742,488 from 2026-10-13), `distinct` on the nine real
  seconds (Vinland 1,308,856 vs 743,352 through One Piece 1,161,464 vs 1,155,448 — 6,016 B
  apart), Naruto's `800|480` ladder mismatch, the 64 KiB floor at its exact boundary
  (65,536 B judged, 65,535 B excused) and AniWatch's undeclared 262,144-byte heads, where
  the hash alone decides.
- **refusals** — two identical 146-byte error pages, the AniKoto PNG decoy, a playlist
  that names no file, a byterange window, a throwing resolver, a non-http pair, and the
  identical-embed refusal answering with **zero requests** (while a differing query string
  on the same path is still measured, and still `copy`).
- **invariant** — `dubProvenanceOf` over the same table the app pins, then the pipeline: a
  real `copy` verdict projected into a record can only read `measured-corrected`, a real
  `distinct` only `measured`, and every `unknown` stores nothing so it can only read
  `claimed`.  `unknown` never enters a record, which is what keeps a refused request from
  reading back as a confirmed label.

The app mirrors the matrix and the invariant in `tests/unit/dubAudio.test.ts`, so the two
carriers of this rule are pinned against the same measurements.

### The same rule on titles it has never seen (2026-10-13)

10 titles outside the 14 above, one dub-claiming episode each, per provider, through this
export:

```
hianime   copy=2  distinct=3  unknown=0  no-pair=5
aniwatch  copy=0  distinct=8  unknown=1  no-pair=1
anikoto   copy=0  distinct=0  unknown=8  no-pair=2   (all 8: not media (png))
```

22 of the 30 title×provider slots produced a pair.  Two things follow.

The rule generalises: the two `copy` verdicts are **new** fakes the original census never
listed — Sakamoto Days (1,420,340 = 1,420,340) and Hell's Paradise (4,742,488 =
4,742,488), both zoko, both byte-identical on the shared 1080 rung.  The fake is not five
titles somebody remembered, it is a property of that host.

And it is host-specific so far: every AniWatch pair that could be read differed (8 of 9),
which is why `unknown` is the only verdict this export can carry about AniKoto — its
`s=tcdn` selector routes both groups to a PNG, so there are no audio bytes to compare.  A
9-in-22 unmeasurable rate concentrated in one provider is the honest number to design
thresholds against, and it says nothing about the media being a lie.

One pair costs 3–8 s and ~512 KiB of reads, so it is a check you run when an
English promise matters (`verify.mjs --audio=dub` prints it as `dub truth :`), not
one you put in front of every play.

## HiAnime gaps (measured 2026-10-12)

1. **The site's own download link is not a file.** zoko's `download_url` is the
   *relative* path `/download/mal/52299/1/sub`; resolved against the player origin
   it answers **200 with 702 B of `<!doctype html`**.  `resolve()` surfaces it as
   `downloadPage`, which is what it is.
2. **Some rows are player shells with no stream.** `Vinland Saga Season 2: Same
   Old Story` ep 1 (`/stream/mal/55272/1/sub`) carries no `window.__P` at all →
   `EMPTY_STREAM`.  Tally over 9 Vinland embeds: 6 playable, 1 `EMPTY_STREAM`,
   0 other errors.  `downloadEpisode()` fails over to the next embed; the
   per-feature `sources → resolve → download` path stops at the error, as on AniKoto.
3. **Skip marks only come from the megaplay branch.** The zoko `__P` object has a
   `skip` key but it was empty on every episode measured, while megaplay published
   `skip={intro:[0,89],outro:[1460,1549]}`.  A source ladder that reads skip only
   from zoko will never skip.
4. **No per-episode art or runtime.** An `/api/episodes` row is exactly
   `link,_id,episodeNumber,slugs,title,slug` — no image, no duration, so an
   episode guide is limited to numbers and titles here (AniKoto publishes `img`).
5. **Rung sets vary per episode.** Some masters publish only 1080 (Jujutsu Kaisen,
   Chainsaw Man, One Piece, Attack on Titan, Bocchi), others 1080/720/360
   (Frieren, Spy x Family, [Oshi no Ko]), and the labels are not a fixed menu:
   `800` on Naruto, `1036` on A Silent Voice, i.e. whatever `RESOLUTION=` says.
   `quality` falls back to the best rung when the asked one is absent.
6. **`sources().subtitles` is always `[]`** — the same dead field as the other four
   exports; tracks only appear after `resolve()`, and each branch publishes
   exactly **1** (English), against AniKoto's 9.
7. **The keyword matcher is literal.** `“Solo Leveling”` (curly quotes),
   `Solo’s Leveling` and `Frieren – Beyond Journey’s End` all return **0 hits**
   even after this module's Unicode normalisation and its raw-query retry, because
   the site's own titles use the ASCII form only.  A punctuation-only query
   (`—`) answers 24 rows and `"` answers 7, while `""` would answer the whole
   2 592-row catalogue — so `search()` returns `[]` for anything that normalises
   to empty instead of letting a junk term look like a browse.
8. **`mal_id` is not unique.** `solo-leveling-e5tfvj` (12 eps) and
   `solo-leveling-ztz88n` "Solo Leveling: Specials" (1 ep) both publish
   `mal_id 52299`, so an identity rule keyed on MAL id cannot separate them; the
   slug and the Mongo `_id` can.
9. **Slugs contain `:`.** `solo-leveling:-reawakening-yq39l7` is a real slug, so
   `details()` un-escapes `%3A` before building the URL, and episode refs keep the
   slug raw.
10. **The cursor route is not a pager for the offset route.** It walks the
    collection in `_id` order (its first page is all `68e…`, filter's first page
    is the newest `6ac…`), so `browse({cursor})` gives you a different ordering,
    not page 2 of what you were reading.  Non-ObjectId cursors are rejected
    locally because upstream answers HTTP 500 with `Cast to ObjectId failed for
    value "61026"`.

## Provider 4 — AnimeKai (`animekai.be`)

Ported and proven live on 2026-10-13. It is the cheapest chain here to drive — the
server group is already in the watch page, so `sources()` costs one request and no
decode hop — and every pair tried measured real (7/7 `distinct`).  That is a
datapoint about one path, not a certificate about the site: HiAnime's zoko row for
the very same title and episode — Solo Leveling ep 1 — answers `copy`
(1,022,156 = 1,022,156), while this site's megaplay row for it answers `distinct`
(626,040 vs 857,656).  Same title, same episode, different verdict per player,
which is exactly the granularity the verdict store has to key at.

| hop | result (measured 2026-10-13) |
|-----|------------------------------|
| site | `animekai.be` answers 200 |
| provider gate | `status=enabled`, tier `RUNTIME_CONFIRMED` |
| search | `/api/search/suggest?q=Solo+Leveling` → 200, 735 B, a **bare JSON array** (no `html` envelope, unlike the WordPress twins), rows carry `slug,title,title_jp,poster_url,type,year,rating,has_sub,has_dub,sub_count,dub_count,ep_count` |
| details | `/watch/solo-leveling` → real HTTP 302, followed to `/ep-1` (118,274 B); `h1.title[data-jp]`, `small.al-title`, `div.info` (rating + per-audio counts + type), `#synopsis-text` |
| episodes | 12 rows (Solo Leveling) / 1,180 rows (One Piece) from `a[…/ep-N][num][data-sub][data-dub][langs]` |
| sources | `div.server-items[data-id=sub|dub] > span.server[data-url]` — the embed is the attribute |
| resolve | `megaplay.buzz/stream/mal/<malId>/<ep>/{sub,dub}` → `#megaplay-player[data-id]` → `getSources` → AES `enc` → `fetch.nexabloom.top/anime/<dir>/<file>/master.m3u8?token=…`, 1 rung @1080, 9 subtitle tracks |
| download | ep 1 sub 626,040 B, ep 1 dub 857,656 B, `0x47` on every 188-byte stride — two different files, both real MPEG-TS |

### What this site does differently

1. **The audio claim is markup, not a schema.** `div.info` prints
   `<span class="sub">12</span>` beside `<span class="dub">12</span>`, and the search
   row prints `sub_count`/`dub_count`/`has_sub`/`has_dub`. Measured on One Piece: the
   page claims 1,180 sub / 1,165 dub, and the listing answers exactly 1,180 anchors of
   which 15 carry no `data-dub` — claim and listing agree. That is a real availability
   signal, and it is the only provider here that publishes it in the page.
2. **Two "servers", one file.** Server 1 and Server 2 of a group carry the same
   `data-url` and differ only by `data-sid` (6970/6991 pair measured: 6970/6971 sub,
   6994/6995 dub). Embeds are deduped by URL, or the failover walk hits one CDN twice
   and calls the repeat a second server.
3. **A dub ask on a sub-only row used to be answered with the sub embed.** Measured on
   One Piece episode 1180: `data-sub="1"`, no `data-dub`, `langs="1"`, and the page
   renders a `sub` group and no `dub` one. The AniVerse provider (and the first draft of
   this file) fell back to "every span on the page" whenever the asked group came up
   empty, so a dub ask returned `megaplay.buzz/stream/s-2/233066/sub` — Japanese audio
   handed back as English. Both now answer **zero embeds** and keep the fallback for the
   one case it was ever for: a page whose spans carry no recognised group at all.
   15 of One Piece's 1,180 rows are shaped like this.
4. **`?autostart=true` and two embed shapes.** MAL-keyed titles are
   `…/stream/mal/<malId>/<ep>/<audio>`, others `…/stream/s-2/<id>/<audio>?autostart=true`;
   `audioOfEmbed` reads the audio off the last segment of either, because it strips the
   query first.
5. **sub and dub resolve into the SAME signed CDN directory.** Solo Leveling ep 1 gives
   `fetch.nexabloom.top/anime/53adb96c…/<file-a>/master.m3u8` for sub and
   `…/anime/53adb96c…/<file-b>/master.m3u8` for dub — one directory, one token, two
   files. Nothing about the paths can prove the audio differs; only the bytes can, and
   that is the whole reason `dubPairVerdict` exists.

### AnimeKai dub census (2026-10-13, `dubPairVerdict`, 262,144 B heads)

| title | ep | verdict | sub head | dub head | note |
|-------|----|---------|----------|----------|------|
| Solo Leveling | 1 | **distinct** | 262,144 B `25f348b6` | 262,144 B `397c4826` | written sizes 626,040 vs 857,656 |
| Solo Leveling | 2 | **distinct** | 262,144 B `88148ad5` | 262,144 B `87b0d186` | rung 1080 both sides |
| Solo Leveling | 7 | **distinct** | 262,144 B `8eaf83a4` | 262,144 B `d6afed4c` | dub declares 1,344,952 B |
| One Piece | 1 | **distinct** | 262,144 B `717104f6` | 262,144 B `bf7886d1` | |
| Jujutsu Kaisen | 1 | **distinct** | 259,064 B `0971f2c8` | 262,144 B `11b1778c` | sub file is smaller than the read window |
| Demon Slayer | 1 | **distinct** | 241,016 B `5eea30ef` | 262,144 B `0798d53e` | dub declares 538,808 B |
| Vinland Saga | 1 | **distinct** | 262,144 B `6b8b05bb` | 262,144 B `4634ee77` | dub declares 743,352 B |

7/7 distinct, and two of those totals are the same numbers the HiAnime rows above
carry for those titles' *real* dubs (Vinland 743,352, Demon Slayer 538,808). Read
together with HiAnime's six zoko `copy` rows, that is the most useful thing in this
section: the same title can be a real dub behind one CDN and a byte-for-byte copy
behind another, so **a verdict is a property of title × server, not of the site** —
which is why the store keys on the extractor and why "is this site honest" is the
wrong question to ask of a pill.

### AnimeKai gaps (measured 2026-10-13)

1. **No `browse()` export.** The site has rails and a `/api/search/suggest`, but no
   catalogue contract was walked, so `cli.mjs browse` stays HiAnime-only.
2. **`year` lives only in the search row.** `/watch/<slug>/ep-1` prints no year, so
   `details()` cannot stamp it and `verify.mjs` reports `year=?` for this provider.
   Not a parse miss: measured by `indexOf`, not by a regex that could miss.
3. **A third language group is possible but unmeasured.** The page's own template
   renders `data-id="' + lang + '"` blocks and rows carry `langs="3"`, yet every page
   walked here published only `sub` and `dub`. If a title ever publishes `hsub`, this
   `sources()` will filter it out of both asks; AniKoto's rule (`wanted = ["sub","hsub"]`)
   is the known fix and is deliberately not applied on an unmeasured shape.
4. **Episode labels are ordinals.** `<span data-jp="">Episode 1180</span>` — this site
   publishes no per-episode titles on the titles walked, so `title` repeats the number
   rather than inventing one.

## Provider 5 — AnimeWave (`animewave.to`)

Ported and proven live on 2026-10-13 — the fifth file, and the one this export had
earlier written off as dead.  The chain is the AniKoto CMS family (same ajax routes,
same opaque `data-ids` token, same `megaplay.buzz` player) with three differences that
each cost a probe to find.

| hop | result (measured 2026-10-13) |
|-----|------------------------------|
| site | `animewave.to` answers 200 |
| search | `/ajax/anime/search?keyword=Solo+Leveling` → 200, 3,939 B, `{status, result:{html}}` — 5 `a.item` cards.  **Needs `x-requested-with: XMLHttpRequest`** (below) |
| details | `/watch/<slug>` → `watchTag[data-id]`, `h1.title.d-title`, `.names` alt titles, `.bmeta` label blocks.  Solo Leveling S2: year **2025**, **13** episodes, status *Finished Airing*, `audioIcons=[sub,dub]` |
| episodes | `/ajax/episode/list/<watchId>?vrf=` → `{status, result:"<html>"}`; anchors carry `data-num/data-slug/data-mal/data-sub/data-dub/data-ids` and `href="#"` |
| sources | `/ajax/server/list?servers=<data-ids>` → `li[data-link-id]` under `div.type[data-type=sub\|dub\|hsub]`; then `/ajax/server?get=<linkId>` → `{result:{url,skip_data}}` → the embed |
| resolve | `megaplay.buzz/stream/s-2/131394/{sub,dub}` → 1 rung @1080, 5 subtitle tracks.  `…?s=tcdn` signs to `megap.shiora.top` (**PNGs**); the plain form signs to `fetch.nexabloom.top` (real MPEG-TS) |
| download | `--provider=animewave download "Frieren" 1 --audio=dub` → 5,163,232 B, `video/mp2t`, `47 40 00 10 …` (sync byte + PAT), ~1560 s, host `fetch.nexabloom.top` |
| verify | `--audio=sub` → **PASS** 436,536 B mpegts `+188-sync`; `--audio=dub` → **PASS** 541,816 B, after `resolve[0]` correctly reported `DECOY_CDN: segments are png` |

### What this site does differently

1. **A 500 that is not a status code.** Every ajax route answers **HTTP 200** and puts
   its complaint in the body.  Omit `x-requested-with` and search returns a 50-byte
   `{"status":500,"result":"Bad request"}` — which is exactly what an earlier probe saw,
   and exactly why this provider was filed as "search answers 500 — dead".  It was never
   dead; the request was missing one header.  The gate is that one header and nothing
   else, measured 2026-10-13 on one URL with each option held constant:

   | request | answer |
   |---------|--------|
   | `x-requested-with` alone | 200, 3,939 B, 5 slugs |
   | `x-requested-with` + `referer` + UA | 200, 3,939 B, 5 slugs |
   | UA + `x-requested-with`, no referer | 200, 3,939 B, 5 slugs |
   | `referer`, no `x-requested-with` | 200, **50 B**, `{"status":500,"result":"Bad request"}` |
   | no headers beyond fetch's own | 200, 50 B, same body |

   So `referer` is decoration on this route and `x-requested-with` is load-bearing —
   `ajaxHeaders` in the file is the whole gate, and a future "simplification" that drops
   it will read as site death again.  A transport-level 200 with an error body is the
   trap: nothing in `fetch` reports it as a failure.

   The trap is now closed in code, in two places.  `readSearchEnvelope()` decides by
   body shape instead of by `res.ok`: a real answer always carries `result` as an
   **object** with an `html` string and the site's own `count`, while the rejection
   carries `result` as a **string** (`"Bad request"`) — that type, not the length, is
   the discriminator, because the length moves (3,939 B in the matrix above, 3,965 B
   on a re-probe 20 minutes later).  `search()` turns a rejected envelope into
   `ApiError(code: "UPSTREAM_REJECTED")` naming the status and body, so a probe that
   drops the header fails loudly instead of returning zero hits.  `verify.mjs` prints
   that as its `probe` line before the walk starts, and asserts the same shape for all
   five providers against "solo leveling", which is listed on every one of them
   (measured 2026-10-13: AniKoto 8, AnimeWave 5, HiAnime 4, AniWatch 2, AnimeKai 2 —
   zero hits from a term that broad is a mis-read envelope, not a thin catalogue).
   The sixth, WatchAnimeWorld, is WordPress HTML rather than an ajax envelope, so the
   body-shape *discriminator* does not carry over; the same line does, and it announces
   its own fault the same way — `search("naruto")` returned 2 hits on 2026-10-14, and a
   zero-hit answer for a term that broad prints `<-- SHAPE FAULT: a term this broad
   returning none is how a mis-read envelope looks`.
2. **Three envelope shapes in one provider.** Search nests its HTML one level deeper
   than the site's other ajax routes (`result.html`, an object), while `episode/list`
   and `server/list` return `result` as a bare string and `server?get` returns
   `result.{url,skip_data}`.  One `jsonHtml()` helper cannot cover all three, hence
   `readSearchEnvelope()` next to the shared unwrapper.  The asymmetry is also why the
   guard belongs to search and not to `jsonHtml()`: on this route a string `result` has
   only ever been observed as the rejection body (the three shapes are recorded in
   `readSearchEnvelope`'s own comment), while `episode/list` and `server/list`
   legitimately put markup in that same slot.
   Every one of these answers is
   JSON-with-HTML-inside, so regexing the raw response body without unwrapping first
   sees `\/ajax\/` instead of `/ajax/` and finds nothing.
3. **The decoy is the FIRST embed, not the last.** The site lists
   `…/sub?s=tcdn` before `…/sub`.  The `tcdn` pair resolves to `megap.shiora.top`
   and answers PNGs; the plain pair resolves to `fetch.nexabloom.top` and answers real
   MPEG-TS.  A failover walk that returns the first thing that resolves plays a poster
   and calls it success — so `resolve()` sniffs the *first segment's bytes*, and the
   declared `content-type` is not evidence: `nexabloom` labels genuine TS segments
   `image/jpeg`.  Container comes from the bytes, never the header.
4. **1,180 rows, one payload, 25 of them lying about dub.** One Piece
   (`watchId 1642`) returns every episode in a single response spread across 12
   `data-range` groups: 1,155 rows carry `data-sub` **and** `data-dub`, **25 carry
   `data-sub` only**, 0 dub-only, 0 unlabelled.  Those 25 are the `#138` lie in its
   purest form — a dub ask on ep 1156's server set publishes one group, `["sub"]`, and
   a `sources()` that falls back to "everything on the page" hands back Japanese audio
   labelled English.  Both the app provider and this file now answer a dub ask on those
   rows with **zero embeds** plus `available:{sub:2,dub:0}`.
5. **`href="#"` — the episode URL is rebuilt, not read.** Anchors point at nothing; the
   URL is `/watch/<series-slug>/ep-<data-slug>`, and the audio the site opens by default
   comes off `data-sub`/`data-dub`.  The `data-ids` value is the same opaque server-set
   token AniKoto carries, percent-encoded **once** at request time — a `[0-9,]`-style
   "sanitising" filter destroys it, and the token is ~200 characters of base64 that
   looks nothing like an id.  `encodeEpisodeRef` is byte-compatible with the AniVerse
   `animewave` provider (`animewave|<serverIds>|<audioType>|<episodeUrl>`), so refs move
   between the app and this export in both directions.

### AnimeWave dub census (2026-10-13, `dubPairVerdict`, same title measured on both embed pairs)

| title | pair | verdict | sub | dub | which rung decided it |
|-------|------|---------|-----|-----|------------------------|
| Vinland Saga | `?s=tcdn` | **unknown** (not media (png)) | — | — | both sides PNG, nothing measured |
| Vinland Saga | plain | **distinct** | `6b8b05bb` | `4634ee77` | declared size 262,144 ≠ 743,352 |
| One Piece | `?s=tcdn` | **unknown** (not media (png)) | — | — | both sides PNG |
| One Piece | plain | **distinct** | `717104f6` | `bf7886d1` | sizes equal at 262,144 — **md5 decided it** |
| Frieren | `?s=tcdn` | **unknown** (not media (png)) | — | — | both sides PNG |
| Frieren | plain | **distinct** | `c9ba1a7f` | `4602e6d3` | sizes equal at 262,144 — md5 |
| Demon Slayer: Mt. Natagumo Arc | plain | **distinct** | `977c98c4` | `bd186b15` | 262,144 ≠ 262,072 |
| Hell's Paradise | plain | **distinct** | `9ef5e2a2` | `4f8be6b3` | 1,540,472 ≠ 1,498,360 |
| Sakamoto Days | plain | **distinct** | `5bab2994` | `bd489089` | 478,648 ≠ 262,144 |
| The Last: Naruto the Movie | plain | **distinct** | `277e5460` | `a26096cb` | 3,934,840 ≠ 262,144 |
| Solo Leveling: Specials | — | **no dub row** | — | — | 1 episode, `data-dub` absent |

7 titles, 7 `distinct` on the plain pair, 0 `copy`, 7 `unknown` on the `tcdn` pair,
1 title with no dub row at all.  Two things fall out of measuring both pairs.

- **`unknown` here is a pairing artifact, not a site property.** Every `unknown` row is
  the same measurement against the PNG-decoy side.  `dubPairVerdict` reads one pair;
  if the pair chosen happens to be the decoy side, the answer is "not media" and the
  bytes on the honest CDN are never looked at.  Same mechanism as AniKoto's 8
  `unknown (png)` rows, and the reason `#145` is a real gap: a detector that gives up on
  its first candidate pair throws away a measurement the second pair would have made.
- **Same bytes as AnimeKai.** Vinland Saga ep 1 measures `6b8b05bb` / `4634ee77` here
  and `6b8b05bb` / `4634ee77` on AnimeKai (the table above); One Piece ep 1 measures
  `717104f6` / `bf7886d1` on **both** sites.  Two "providers" that are front-ends to one
  `megaplay.buzz` backend share assets literally — so cross-site agreement is expected
  here and proves nothing about independence.  Meanwhile **Sakamoto Days ep 1** is
  `copy` behind HiAnime's zoko player (1,420,340 = 1,420,340) and `distinct` behind this
  site's megaplay row (478,648 vs 262,144): the verdict stays a property of title ×
  player, and the player is what the store keys on.

### AnimeWave gaps (measured 2026-10-13)

1. **No `browse()` export.** `/genre/*`, `/status/*` and `/filter?…year[]=…` exist and
   the watch page links them, but no catalogue contract was walked, so `cli.mjs browse`
   stays HiAnime-only.
2. **`skip_data` is all-zero on every embed probed.** The route publishes it and this
   file carries it through, but no skip marks (intro/outro) were proven here, so nothing
   claims them — unlike AniKoto, whose marks were measured.
3. **`hsub` is in the filter but unmeasured.** `wanted = ["sub","hsub"]` follows AniKoto
   because the site's own template knows the group; no title walked today published one.
4. **`year` is derived, not labelled.** The page prints no bare year field; it comes out
   of `Aired: Jan 5, 2025 to Mar 30, 2025` and the `/filter?year[]=` hrefs, and
   `episodeCount` out of `Episodes:`.  Both measured; neither is a first-class field.
5. **5 subtitle tracks, never compared across audio.** Resolve reports them and nothing
   here checks whether the dub's track list is the sub's — the subtitle analog of the
   audio question, still open.

## Provider 6 — WatchAnimeWorld (`watchanimeworld.one`)

Ported and proven live on 2026-10-14 — the sixth file, the last site the dub census
(`#143`) owed, and the only chain here that reaches bytes through **neither an embed
host nor an HLS playlist**.  The contract was recovered on 2026-10-11 off Naruto
Shippuden 5x208, re-walked 2026-10-13, and re-proven end to end on a fresh episode
(Naruto 1x1) on 2026-10-14 with the proxy disabled.

| hop | result (measured 2026-10-14) |
|-----|------------------------------|
| site | `watchanimeworld.one` answers 200 |
| search | `/?s=naruto` → 2 `li#post-<id>` cards (WordPress, `a[href*=/series/]`, protocol-relative `image.tmdb.org` poster) |
| details | `/series/naruto/` → `h1.entry-title` **Naruto**, **220** episodes behind the season picker |
| episodes | `/wp-admin/admin-ajax.php?action=action_select_season&season=1&post=<id>` + `x-requested-with` → `article.episodes`, `span.num-epi` `1x1`; ep 1 = *"Enter: Naruto Uzumaki!"*, ref `watchanimeworld\|naruto\|1\|1\|https://watchanimeworld.one/episode/naruto-1x1/` |
| player page | `/episode/naruto-1x1/` → `div#options-0` iframe `/dub-player/t/<playerId>/`; that page's inline `var CONFIG` names three languages → three abyss slugs.  `div#options-1`'s zephyrix iframe answered **HTTP 523** on 2026-10-11 and is documented, not walked.  `<playerId>` is a site row id, **not** the manifest's `md5_id` — measured pair: player `8507` → `md5_id 24669874` (2026-10-11) |
| manifest | `player.abyssplayer.com/<slug>` → `const datas = "<b64>"` → AES-256-CTR → **8 renditions** over 3 languages |
| sources | **0 embeds + 8 direct MP4 rows**, `available={"sub":0,"dub":8}` |
| probe | `probeCopy` on the 360p Hindi copy (66,508,347 B / 32 parts) → **PASS** |
| stitch | part 0 → **2,097,152 B on disk**, stat matches, `mp4` sniffed from the bytes (`sniff@0066` = bytes[0] `00`, bytes[4] `66` = the `f` of `ftyp`) |
| lang pair | `audioPairVerdict` Hindi/English → **distinct** @1080p |
| verify | `node verify.mjs --provider=watchanimeworld` → **VERDICT PASS** |
| cli | `download "naruto" 1 out.mp4 --max-parts=2 --quality=360` → 4,194,304 B `video/mp4`, `parts 2/32 (cut by --max-parts)`, `audio=dub language=Hindi codec=av1 quality=360` |

### What this site does differently

1. **The part URL *is* the signature.** There is no signed query and no cookie: each
   2 MiB part lives at `https://<sub>.sssrr.org/sora/<size>/<token>` where `token` is
   double unpadded base64 of AES-256-CTR over
   `/mp4/<md5_id>/<res_id>/<size>/<chunk>/<part>`.  The key is
   `md5` over the size's **decimal digit bytes** — md5 of `[6,4,1,5,9,7,4,4]`, *not*
   md5 of `"64159744"` — and the IV is the first 16 ASCII bytes of that same digest;
   `chunk = min(size, 0x200000)`.  Pinned against the CDN's own answer, 2026-10-11,
   and asserted in `watchanimeworld.test.mjs`:

   ```
   abyssToken("/mp4/24669874/2/64159744/2097152/1", 64159744)
     -> Y0h4a0ZaeXRUY25DT3l3STBSNm1yL2F6K1dka1k3MmEyZGc1RWxMKzJJaHNyQQ
   abyssSizeKey(63864921) -> eef01bc2fb1678527fefde2af42109f0   (and != md5("63864921"))
   64,188,987 B -> 31 parts, tail 1,274,427     64,159,744 B -> 31 parts, tail 1,245,184
   ```

   Get the digit-bytes rule wrong and every URL 403s or 404s with no clue why — the
   request is well-formed, the token is simply for a different file.
2. **`datas` must be base64-decoded as latin1.** The JSON inside carries the
   ciphertext's raw bytes; reading it as UTF-8 turns every byte ≥ 0x80 into U+FFFD,
   which **parses fine and decrypts to noise**.  The length does not even change —
   one bad byte is one JS character — so a "sanity check" on string length cannot
   see the corruption.  The test proves it in the only way that works: the two
   reads' bytes differ, and the UTF-8 one throws `manifest is not JSON after
   decrypt`.
3. **Declared size is not evidence; 65 bytes are.** Copies on this pipeline are
   uploaded truncated mid-file, so a rendition whose manifest says 346 MB can serve
   nothing.  `probeCopy` asks for `bytes=4-7` on part 0 and requires **206 with the
   plaintext body `ftyp`** — the file is served unencrypted, so this is the one hop
   where a wrong answer is visible in four ASCII characters — then asks for the
   **last byte of the final part** (`bytes=<len-1>-<len-1>`) and requires 206 again.
   Anything else (403, 404, a 416 tail, a 200 whose body is not `ftyp`, a throw)
   returns `false`, and `sources()` emits a row only when it returns `true`.  That
   costs 2 range requests per rendition and is why the 8 rows in the table below are
   8 files that answered rather than 8 claims.
4. **The host is not the file.** English and Japanese 1080p both live on
   `hgexcwir16.sssrr.org` at different sizes; the 2026-10-14 episode carries three
   `md5_id`s (Hindi `24671452`, English `24671510`, Japanese `24671523`) where the
   2026-10-11 capture had one (`24669874`).  So a subdomain identifies storage, not
   an asset, and ids grow per upload rather than rotating per session — file
   identity is `(sub, size, token)`, never `(sub)` alone.
5. **There is nothing to `resolve`.** `sources()` returns `embeds: []` by design and
   puts the stream in a new `direct[]` array.  Each row carries three addressing
   forms so no caller has to re-derive anything: `url` =
   `https://waw-abyss.invalid/<base64url spec>.mp4` — the virtual origin (reserved
   TLD) the AniVerse player stitches under, so a ref minted here drops into the app
   unchanged; `partUrl` = the byte-exact part-0 URL an operator can `curl`; `spec` =
   the raw `{m,r,s,h}`.  `cli.mjs resolve` refuses this provider with an explicit
   message, and `verify.mjs` grew a direct-source branch instead of faking an embed
   layer.  One extra header is load-bearing: the sora hosts **403** a bare request
   and clear it on `Referer: https://player.abyssplayer.com/`.

### The 8 renditions live (2026-10-14, Naruto ep 1)

| language | quality | codec | `md5_id` | sora sub | declared bytes | parts |
|----------|---------|-------|----------|----------|----------------|-------|
| Hindi | 360p | av1 | 24671452 | `nlv1esuza22` | 66,508,347 | 32 |
| Hindi | 720p | h264 | 24671452 | `pzt9ldgwf52` | 109,978,932 | 53 |
| Hindi | 1080p | h264 | 24671452 | `xpzadzpm46` | 346,955,702 | 166 |
| English | 720p | h264 | 24671510 | `df4xm4cc728` | 178,226,921 | 85 |
| English | 1080p | h264 | 24671510 | `hgexcwir16` | 178,800,371 | 86 |
| Japanese | 360p | h264 | 24671523 | `weifxopsn26` | 125,849,452 | 61 |
| Japanese | 720p | h264 | 24671523 | `vqnj1k1oc7` | 205,567,292 | 99 |
| Japanese | 1080p | h264 | 24671523 | `hgexcwir16` | 254,313,547 | 122 |

Three languages, and 8/8 rows carrying a `probeCopy` PASS.  English publishes no
360p row in this hand-out; whether its manifest lacks that rung or the copy failed
the probe, `sources()` does not say — recorded as a gap below.  Candidates inside one
rung are ordered **h264 before av1, smaller before larger** and the first passing copy
is the one emitted, so an av1 row like the 360p Hindi above means that copy answered —
not that a h264 copy of the same rung was measured and rejected.  Every row is stamped
`audioType:"dub"`, because on this site that is what the whole catalogue is.

### WatchAnimeWorld dub census (2026-10-14) — the site `#143` was waiting on

The pair rule the other five providers measure **cannot fire here, and that is the
finding.** Every episode is a dub; there is no `sub` group in the page, in the
player config or in the manifest.  So `dubPairVerdict` has no peer to read against,
the site's `isDub` claim stays **unmeasured**, and the provenance stays `claimed` —
recorded as a gap for `#145`, not "fixed" by a fallback that would invent a verdict.
This is the census's second population: not bytes that refuse to be read (the
`tcdn` PNG decoys) but **no second file to read at all**.

What *is* measurable is **language against language**, so this file exports
`audioPairVerdict(ref, {left, right})`, which reuses `dubAudio.mjs`'s `sharedRung`
and `headFingerprint` — same 256 KiB head, same `copy|distinct|unknown` vocabulary —
with the pair named by language code instead of by audio group:

| pair | rung | verdict | left head | right head |
|------|------|---------|-----------|------------|
| `hin` vs `eng` | 1080p | **distinct** | `152ddab33d3be23ebf2d80e9397401eb` | `6546d2f7ee525d71548cdf9f81662513` |
| `eng` vs `jpn` | 720p | **distinct** | `9b8cd03920710231292176af162bc3ef` | `8c97604e60fc05bddc105855c3f2ed71` |

2 pairs, 2 `distinct`, 0 `copy`.  Both heads read 262,144 B of a 2,097,152 B part;
the rungs differ because `sharedRung` takes the best quality both sides publish
(English has no 360p).  Note what this does *not* say: `distinct` proves two
uploads differ, which is a weaker claim than "the English track is English audio" —
the language label still comes from the site's `CONFIG.ready`.  The two heads are the
whole reason the pair is checkable at all, and that is why `verify.mjs` prints
`dub truth: unknown …` and `lang truth: distinct …` on two separate lines rather than
collapsing them into one "audio verified" flag.

### WatchAnimeWorld gaps (measured 2026-10-14)

1. **`dubPairVerdict` is absent; `probeCopy` and `audioPairVerdict` are there instead.**
   The shared surface gains two names this file lacks and loses two they share.
   Deliberate: exporting `dubPairVerdict` here would return `unknown` for all 8 rows
   and read like a broken detector.
2. **Only `div#options-0` is walked.** The zephyrix iframe in `div#options-1`
   answered **HTTP 523** on 2026-10-11 and was not re-attempted; if it ever answers,
   this file publishes one of the site's two source groups and the app's failover
   order needs re-measuring.
3. **No subtitle path.** `sources().subtitles` is always `[]`.  The decrypted
   manifest carries `domains` and `fristDatas` beyond `mp4.sources` and this file
   returns them, but no subtitle track was proven live from either, so nothing here
   claims one.
4. **The stitched file is a head, not an episode.** `verify.mjs` writes 1 part and
   the CLI was driven with `--max-parts=2` (4,194,304 B, `ftyp` at 0x04).  A whole
   1080p Hindi copy is **166 sequential 2 MiB requests**; that walk was not run from
   this export, so `download()`'s stitching is proven per part, not per episode.
   (The app's own proxy does the same stitch for the browser and is covered by
   `tests/unit/abyssStream.test.ts`.)
5. **Language priority is a constant.** `LANGUAGE_PRIORITY = ["hin","eng","jpn"]`; a
   fourth slug in `CONFIG.ready` plays only if it happens to be the sole language
   offered, otherwise it is dropped.
6. **`codec` and `label` are the site's claims.** `av1` at 360p is what the manifest
   says; no `ffprobe` pass was run on a stitched part here, so nothing proves the
   elementary stream.
7. **Emission costs 16 range reads per episode** (2 per rendition × 8).  Not a
   defect — the price of `probeCopy` — but it is why a `sources()` call on this
   provider is slower than on a megaplay site.
8. **Rejected candidates are invisible.** `sources()` returns the copies that passed
   and an `available` count; a manifest row whose `ftyp` head or tail byte refused to
   answer is simply absent, with no `dropped` list to say so.  `download()` reports
   `truncatedUpstream` for the copy it was given, but the *comparison* — "this rung
   had two uploads and only one serves" — is not exported, which is what would turn
   the missing English 360p row above into an answer.

## Files

- `anikoto.mjs` — the whole AniKoto chain (provider + MegaPlay + HLS assembly)
- `aniwatch.mjs` — the whole AniWatch chain (REST provider + the same MegaPlay + HLS assembly)
- `animekai.mjs` — the whole AnimeKai chain (suggest-JSON + watch-page provider + the same MegaPlay + HLS assembly)
- `animewave.mjs` — the whole AnimeWave chain (ajax-HTML provider, same CMS family as AniKoto + the same MegaPlay + HLS assembly)
- `hianime.mjs` — the whole HiAnime chain (JSON provider + ZokoAnime `__P` decoder + MegaPlay + HLS assembly), plus `browse()` and the catalogue cursor bridge
- `watchanimeworld.mjs` — the whole WatchAnimeWorld chain (WordPress + ajax season crawl + `var CONFIG` + the abyss manifest decrypt + the part-token pipeline + the stitch).  The only file here with no MegaPlay and no HLS
- `dubAudio.mjs` — the one shared file: is a site's `/dub` its own bytes or a copy of its `/sub`?  Pure rule + `headFingerprint`, bound per provider by `makeDubPairVerdict`
- `dubAudio.test.mjs` / `watchanimeworld.test.mjs` — the offline suite (`node --test`, **73 tests / 13 suites**, no network).  The second one pins the live CDN vectors and round-trips the player's own cipher
- `cli.mjs` — per-feature command driver, `--provider=anikoto|aniwatch|animekai|hianime|animewave|watchanimeworld`
- `verify.mjs` — live end-to-end check: details → sources → resolve → download one segment → prove it is a real container (exit 0 on PASS).  For WatchAnimeWorld the hop is probeCopy → stitch one part → sniff it
- `README.md` — this document

The MegaPlay and HLS code is **duplicated on purpose**.  Each file is the whole
contract for its provider so any one of them can be handed over alone.  The one
exception
is `dubAudio.mjs`: the dub-authenticity rule is a *measurement method*, not a
provider contract, and five copies of it would produce five different verdicts
for the same pair of files — so each provider imports it and binds it to its own
`resolve()` in a single exported line.  Take that file with any provider you hand
over alone.  `watchanimeworld.mjs` binds it differently: it imports `sharedRung`
and `headFingerprint` and builds `audioPairVerdict` — the same rule, paired by
language because the site has no sub/dub pair to bind to.
`hianime.mjs` is the only one of the five MegaPlay files that shares MegaPlay with
the others *and* carries a player of its own — the ZokoAnime branch is where its
`__P` decoder, `ontoOrigin` rewrite and `buildMegaPlayToken` all get exercised.
`watchanimeworld.mjs` is the sixth and shares **no player code with any of them**:
its whole transport is the abyss manifest decrypt plus `abyssPartUrl`, which is why
it is the file to hand over if you want the token rule without the HLS machinery.
`animekai.mjs`, `aniwatch.mjs` and `animewave.mjs` are the same pipeline behind
different provider layers: all three hand out MegaPlay embeds with one rendition,
so their `resolve()` bodies are identical apart from the stamped `provider`.
AniKoto and AnimeWave are additionally the same CMS — same ajax routes, same
opaque `data-ids` server-set token, same `getSources` envelope — which is why
`animewave.mjs` reads like `anikoto.mjs` with three corrections in it.

## One contract across the six files

The duplication is only allowed where the *observable* contract stays identical, so
a caller can swap providers without re-learning the error handling:

- Same exported names, same shapes: `PROVIDER`, `search`, `details`, `episodes`,
  `sources`, `resolve`, `download`, `downloadEpisode`, `sniffContainer`, `ApiError`,
  `default<Provider>Referer`, `dubPairVerdict`.  `resolve()` stamps `provider` on
  every result.  Each file also exports its own internals (`decodeZokoPayload`,
  `decodeEpisodeRef`, `encodeEpisodeRef`, `audioOfEmbed`, `parseServerItems`,
  `parseServerSpans`, `parseServerLinks`, `parseItemCards`, `readSearchEnvelope`,
  `buildMegaPlayToken`, `parseVariants`, …) — those are per-provider and not part
  of the shared surface.
- `watchanimeworld.mjs` keeps that surface with **two names swapped out**, and says
  so rather than faking the other two.  There is no `resolve()` (nothing to resolve:
  `sources().embeds` is `[]` and `sources().direct` is the stream) and no
  `dubPairVerdict` (no `sub` peer exists on the site).  In their place: `probeCopy`,
  `audioPairVerdict`, and the part math (`abyssPartUrl`, `abyssToken`,
  `abyssPartCount`, `parseAbyssRange`, `fetchPart`).  The two harnesses were changed
  to honour the difference instead of papering over it — `cli.mjs resolve` fails with
  `watchanimeworld publishes no embeds — read its sources() direct[] rows instead`,
  `cli.mjs dub-check` answers `verdict=n/a` and points at `lang-check`, and
  `verify.mjs` has a direct-source branch that probes, stitches one part and sniffs
  it.  Everything else — `PROVIDER`, `search`, `details`, `episodes`, `sources`,
  `download`, `downloadEpisode`, `sniffContainer`, `ApiError`, the referer export —
  is the same contract with the same shapes, **including the audio ask**: `sources()`
  honours `audioType`, a `sub` ask answers zero `direct` rows with
  `available:{sub:0,dub:8}` and no `audioType` stamp, so `cli.mjs` never prints
  `(not honoured by this provider)` here either.
- `sniffContainer` keeps the same name and the same verdict set in all six files, so
  `mp4|mpegts|playlist|png|jpeg|unknown` means the same thing whichever provider
  answered — but the implementations are not identical, and `watchanimeworld.mjs` is
  the only one that re-exports `headContainer` from `dubAudio.mjs` instead of
  carrying its own copy.  That is deliberate: the five HLS files sniff a **segment**
  (5 magic-offset `ftyp`, first byte `0x47`, a 64-byte `#EXTM3U` probe) while this
  one sniffs a **stitched MP4 head**, where the widest rule is the safest one.  Do
  not "unify" the five local copies onto the shared one without re-reading that
  difference.
- Two of those "per-provider" names are in fact the same rule in the five embed
  files, because those sites state audio the same way: `audioOfEmbed()` (AniWatch,
  AniKoto, AnimeKai, AnimeWave) and `embedAudioOf()` (HiAnime) all read the last path
  segment of an embed URL and answer `sub` / `dub` / `undefined`, and `resolve()`
  stamps that value as `audio`.  It is the site's **claim**; `dubPairVerdict()` is
  the byte measurement of it.  WatchAnimeWorld has no embed to read a claim off, so
  its claim comes from `CONFIG.ready`'s language slugs and is stamped as
  `language`/`languageLabel` instead.
- `ApiError(message, status, code)` defaults to `code: "ERROR"` in all six files.
  `NETWORK_ERROR` appears only where a fetch *rejection* is caught (no HTTP answer,
  `status: 0`) — a 404 from the provider is a provider answer, not a network fault,
  and labelling it `NETWORK_ERROR` would send a caller down the retry path.
- Every `!res.ok` throw drains the response body first (`drain(res)`), so a refused
  request does not leave a live socket off the pool.  `hianime.mjs` needs this most:
  its segment loop retries a 403 up to 3 times against the same host.
- The CLI never calls `process.exit()` to report a failure.  Measured 2026-10-12 with
  a four-mode probe against `animehot.cc/api/anime/<junk>` (each mode = one shape):

  ```
  answered, body NOT read, event loop allowed to finish        -> exit 0
  8 answered-in-a-row, body NOT read, loop allowed to finish   -> exit 0
  answered, body cancel()ed,   process.exit(1) from .then      -> exit 127
  answered, body NOT read,     process.exit(1) from .then      -> exit 127
      Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), src\win\async.c:94
  ```

  The last two differ **only** by the drain and die identically, so `process.exit()`
  over a live keep-alive socket is the cause — not the unread body that the error
  message blames.  `cli.mjs` therefore sets `process.exitCode = 1` and unwinds to the
  top level, and every failure path prints one line:

  ```
  node cli.mjs --provider=hianime episodes "definitely-not-a-real-slug-zzz"
  FAIL  ERROR: fetch https://animehot.cc/api/anime/definitely-not-a-real-slug-zzz -> 404   exit 1
  node cli.mjs --provider=aniwatch episodes "definitely-not-a-real-slug-zzz"  -> … -> 404   exit 1
  node cli.mjs --provider=anikoto  episodes "definitely-not-a-real-slug-zzz"  -> … -> 404   exit 1
  node cli.mjs --provider=animekai episodes "definitely-not-a-real-slug-zzz"
  FAIL  ERROR: fetch https://animekai.be/watch/definitely-not-a-real-slug-zzz -> 404   exit 1
  node cli.mjs --provider=animewave episodes "definitely-not-a-real-slug-zzz"
  FAIL  ERROR: fetch https://animewave.to/watch/definitely-not-a-real-slug-zzz -> 404   exit 1
  ```

## Verification

```
node verify.mjs                                        # AniKoto
node verify.mjs --provider=aniwatch                    # AniWatch, sub
node verify.mjs --provider=aniwatch --audio=dub        # AniWatch, dub
node verify.mjs --provider=anikoto --audio=dub          # AniKoto, dub ref
node verify.mjs --provider=hianime                     # HiAnime, sub
node verify.mjs --provider=hianime --audio=dub         # HiAnime, dub
node verify.mjs --provider=animekai                    # AnimeKai, sub
node verify.mjs --provider=animekai --audio=dub        # AnimeKai, dub + dubPairVerdict
node verify.mjs --provider=animewave                   # AnimeWave, sub
node verify.mjs --provider=animewave --audio=dub       # AnimeWave, dub + dubPairVerdict
node cli.mjs --provider=animewave download "Frieren" 1 out.ts --max-segments=4 --audio=dub
node cli.mjs --provider=hianime download "Frieren" 1 out.ts --max-segments=3 --audio=dub --quality=360
node --test api/*.test.mjs                                  # 73 tests, no network
node verify.mjs --provider=watchanimeworld          # WatchAnimeWorld: probeCopy + stitch 1 part + sniff
node cli.mjs --provider=watchanimeworld lang-check "watchanimeworld|naruto|1|1|https://watchanimeworld.one/episode/naruto-1x1/" --lang=eng --peer=jpn
node cli.mjs --provider=watchanimeworld download "naruto" 1 out.mp4 --max-parts=2 --quality=360
```

Current live results, every line reproduced over real HTTP with the proxy
disabled; AniKoto, AniWatch and HiAnime measured 2026-10-12, AnimeKai and
AnimeWave on 2026-10-13, WatchAnimeWorld on 2026-10-14:

```
AniKoto   resolve[0] host=megap.shiora.top  -> DECOY_CDN: segments are png   (correctly rejected)
          resolve[1] host=fetch.nexabloom.top q=1080 subs=9 -> mpegts +188-sync, 626,040 B  PASS
AniWatch  resolve[0] host=fetch.nexabloom.top q=1080 subs=5 audio=sub  -> mpegts +188-sync, 436,536 B  PASS
          host=fetch.nexabloom.top q=1080 subs=5 audio=dub -> mpegts +188-sync, 541,816 B  PASS
HiAnime   resolve[0] zokoanime host=hls.dramahot.top q=1080 rungs=1080/360 subs=1 audio=sub
            -> mpegts +188-sync, 1,022,156 B  PASS
          resolve[0] zokoanime host=hls.dramahot.top q=1080 rungs=1080/360 subs=1 audio=dub
            -> mpegts +188-sync, 1,022,156 B  PASS   (and see the dub-authenticity table:
            these identical byte counts are the defect, not a verify bug)
            dub truth : copy rung=1080 sub=1022156B dub=1022156B   <- the measurement says so
          megaplay branch: fetch.nexabloom.top/master.m3u8?token=… rung 1080, AES `enc`
            decrypted -> 3 segments, 4,612,392 B, mpegts, 0x47 every 188 B,
            ffprobe format_name=mpegts duration=17.120000s
AnimeKai  resolve[0] megaplay host=fetch.nexabloom.top q=1080 rungs=1080 subs=9 audio=sub
            -> mpegts +188-sync, 626,040 B  PASS
          resolve[0] megaplay host=fetch.nexabloom.top q=1080 rungs=1080 subs=9 audio=dub
            -> mpegts +188-sync, 857,656 B  PASS
            dub truth : distinct rung=1080        <- and 7/7 measured pairs distinct,
            see the AnimeKai dub census below       so nothing here is a copied /dub
AnimeWave resolve[0] megaplay host=megap.shiora.top q=1080 rungs=1080 subs=5 audio=sub
            -> DECOY_CDN: segments are png, not video — decoy CDN, try the next embed
               (and this is the FIRST embed the site lists — see finding 3 above)
          resolve[1] megaplay host=fetch.nexabloom.top q=1080 rungs=1080 subs=5 audio=sub
            -> mpegts +188-sync, 436,536 B  PASS
          audio=dub: resolve[0] -> DECOY_CDN (png), resolve[1] fetch.nexabloom.top
            -> mpegts +188-sync, 541,816 B  PASS
            dub truth : unknown (segment unreadable: not media (png) not media (png))
               <- verify.mjs pairs by embed host, and both AnimeWave groups share
                  megaplay.buzz before resolve(), so the pair it picks is the tcdn
                  decoy on both sides.  Measured on the plain pair instead, the same
                  titles read distinct — see the AnimeWave dub census above.
          cli download "Frieren" ep 1 --audio=dub -> fetch.nexabloom.top, 4 segments,
            5,163,232 B, video/mp2t, first bytes 47 40 00 10 (sync + PAT), ~1560 s
WatchAnimeWorld  search("naruto") -> 2 hits -> "Naruto", 220 episodes -> ep 1 ref
            watchanimeworld|naruto|1|1|https://watchanimeworld.one/episode/naruto-1x1/
          sources: 0 embed(s) + 8 direct MP4 stream(s) for audio=dub
            available={"sub":0,"dub":8}   <- no sub group exists on this site
          probeCopy(360p Hindi, 66,508,347 B / 32 parts) -> PASS (ftyp at 4-7, last byte of
            part 31 present) -> download(spec, out, {maxParts:1}) ->
            2,097,152 B on disk (stat matches), sniff mp4, declared 66,508,347 B  PASS
            dub truth : unknown — this site publishes no sub group, so the pair rule
                        has no peer here; provenance stays "claimed" (#145)
            lang truth: distinct rung=1080 hin=152ddab3 eng=6546d2f7
          VERDICT PASS: real MP4 bytes on disk from the part pipeline
          cli dub-check "<…naruto-1x1…>" -> offered: sub=0 dub=0 embed(s),
            verdict=n/a — this provider labels LANGUAGES, not sub/dub; run lang-check
          cli lang-check (hin/eng)   -> distinct @1080p  152ddab33d… vs 6546d2f7ee…
          cli lang-check --lang=eng --peer=jpn -> distinct @720p 9b8cd03920… vs 8c97604e60…
          cli resolve "<ref>" -> FAIL resolve: watchanimeworld publishes no embeds —
            read its sources() direct[] rows instead   exit 1   (no fake embed layer)
          cli download "naruto" 1 out.mp4 --max-parts=2 --quality=360 ->
            4,194,304 B video/mp4, parts 2/32 (cut by --max-parts),
            audio=dub language=Hindi codec=av1 quality=360,
            first 16 bytes 00 00 00 20 66 74 79 70 69 73 6f 6d 00 00 02 00 (ftyp@4)
```

Full uncapped episode, 2026-10-12: `Ore dake Level Up na Ken` ep 1 → **305,795,536
bytes** reported and 305,795,536 on disk.  `ffprobe` read `mpegts, 1420.080 s,
1722694 bit/s, h264 1920x1080 @ 25/1`; a frame seeked to 1380 s decoded to the
end-credits roll, and `ffmpeg -i file -f null -` decoded the **whole** file with
exit 0.  That is a complete, playable episode, not a head-only preview.

## AniKoto gaps (measured live 2026-10-12)

Each of these was reproduced against the running site, not inferred.

1. **`audioType` was ignored — fixed 2026-10-12.** `downloadEpisode(q, ep, out,
   { audioType: "dub" })` used to ask for dub and download
   `…/stream/s-2/114721/sub`, i.e. a caller asking for the English audio got the
   Japanese audio, silently.  `sources()` now opens only the group the ask named
   (`wanted = ["dub"]` / `["sub","hsub"]`, `scoped`/`usable` in `anikoto.mjs`), a
   typed page whose asked group is absent answers **zero embeds**, and
   `downloadEpisode` refuses with `no dub embeds for <title> ep <n>` instead of
   falling back.  A row with no `data-type` on any server still answers either ask
   (no claim to contradict).  `resolve()` now also stamps `audio` from the embed
   path (`audioOfEmbed`), which AniWatch and HiAnime already did.
   `cli.mjs --audio` no longer prints `(not honoured by this provider)` for any
   of the five.
2. **Failover lives only in `downloadEpisode`.** `sources → resolve → download`
   (the per-feature path) dies on the first embed, and embed[0] is the decoy CDN
   for sub *and* dub (`megap.shiora.top` → `DECOY_CDN: segments are png`).
3. **No subtitle download.** `resolve()` reports 9 tracks and they are real —
   `eng` answered HTTP 200, 21,389 chars, 343 WebVTT cues — but nothing in this
   export saves one.  Two tracks also share the label `spa`.
4. **`sources().subtitles` is always `[]`** — a dead field; tracks only appear
   after `resolve()`.
5. **No browse/genre/latest listing.** Only keyword search is exported, while
   `/genre/action` and `/filter?type[0]=tv` each publish 30 rows in the same
   `item` markup the parser already reads.  `/` (root) uses other markup and
   yields 0 chunks.
6. **`results[0]` is picked blind.** `search("Hunter x Hunter")` returns two
   rows both titled exactly `Hunter x Hunter` and search rows carry no `year`
   (`id,slug,kind,title,coverUrl,originalTitle`), so the 1999/2011 pair is
   indistinguishable here.  AniVerse's identity rules are not part of this
   export.
7. **Quality is not selectable.** The signed master exposes exactly one
   `#EXT-X-STREAM-INF` (1920x1080) plus one I-FRAME preview, so there is no
   480p/720p rung to request.  Site-side limit, not a parse miss.
8. **No resume.** `download()` restarts at segment 1; a failure at 250 MB of a
   ~305 MB episode re-transfers the whole episode.
9. **Doc drift.** The header comment says `resolve()` returns `headers`; the
   actual keys are `provider,extractor,master,variants,subtitles,note` — a
   caller following the comment reads `undefined`.

Not gaps, checked and cleared: `/filter` has no page 2 (`page=2` → HTTP 404), so
search is not truncated by a missing pager; the parser takes every result row it
publishes (`One Piece` → 30 item-divs, 30 hits); junk and empty queries return
`[]` rather than throwing; `details()` carries no synopsis or rating because the
site's `og:description` is boilerplate ("Watch … online in HD for free").

## Not for production as-is

- MegaPlay's AES key/IV and token secret are the site's public client-side
  crypto; if they rotate, resolution breaks.  So are the two abyss constants in
  `watchanimeworld.mjs` — the manifest key `md5("<user_id>:<slug>:<md5_id>")` and the
  digit-byte part-token key — and the abyss failure mode is worse than MegaPlay's:
  a rotated key still mints well-formed URLs, they just 404 forever.  The upstreams
  change without notice — this is a live-scraping contract, not an API.
- No SSRF guard, rate limiting or auth here (AniVerse has these server-side).
  Any resolver you build on top of `resolve()` must validate that a URL points at
  a public host before fetching it.  `watchanimeworld.mjs` is the case where that
  rule bites hardest, because the host is *built* from data: `spec.h` comes out of a
  decrypted manifest and is interpolated into `https://<h>.sssrr.org/…`, so
  `decodeAbyssSpec` refuses anything outside `/^[a-z0-9-]+$/i` (a dot or a slash
  there is a host-injection primitive riding inside a server-minted token), and the
  `url` handed to a player is the reserved `waw-abyss.invalid` origin rather than a
  live third party.
- Tier is `RUNTIME_CONFIRMED` (live HTTP contract), not on-device APK-observed.
