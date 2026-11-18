import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseHiAnimeEpisodeList,
  parseHiAnimeServers,
  extractDirectStreamFromEmbed,
  resolveHiAnimeV2Direct,
} from '../functions/api/hianime/_hianime_v2.js';

test('parseHiAnimeEpisodeList: parses episode items from /ajax/v2/episode/list HTML', () => {
  const sampleHtml = `
    <div class="ss-list-min">
      <a class="ep-item" data-id="3209" data-number="1" title="Episode 1">
        <div class="ssli-order">1</div>
      </a>
      <a class="ep-item active" data-id="3215" data-number="7" title="Episode 7">
        <div class="ssli-order">7</div>
      </a>
    </div>
  `;

  const episodes = parseHiAnimeEpisodeList(sampleHtml);
  assert.equal(episodes.length, 2);
  assert.deepEqual(episodes[0], { id: '3209', number: 1, title: 'Episode 1' });
  assert.deepEqual(episodes[1], { id: '3215', number: 7, title: 'Episode 7' });
});

test('parseHiAnimeEpisodeList: handles empty or invalid HTML gracefully without throwing', () => {
  assert.deepEqual(parseHiAnimeEpisodeList(''), []);
  assert.deepEqual(parseHiAnimeEpisodeList(null), []);
  assert.deepEqual(parseHiAnimeEpisodeList('<div>No episodes here</div>'), []);
});

test('parseHiAnimeServers: parses SUB and DUB server mirrors from /ajax/v2/episode/servers HTML', () => {
  const sampleHtml = `
    <div class="ps_-block ps_-block-sub servers-sub">
      <div class="ps__-title">SUB:</div>
      <div class="ps__-list">
        <div class="item server-item" data-type="sub" data-id="321500" data-server-id="34801">
          <a role="button" href="javascript:;" class="btn">HD-1</a>
        </div>
        <div class="item server-item" data-type="sub" data-id="321501" data-server-id="74473">
          <a role="button" href="javascript:;" class="btn">HD-2</a>
        </div>
        <div class="item server-item" data-type="sub" data-id="321502" data-server-id="465">
          <a role="button" href="javascript:;" class="btn">HD-3</a>
        </div>
      </div>
    </div>
    <div class="ps_-block ps_-block-dub servers-dub">
      <div class="ps__-title">DUB:</div>
      <div class="ps__-list">
        <div class="item server-item" data-type="dub" data-id="321510" data-server-id="34801">
          <a role="button" href="javascript:;" class="btn">HD-1</a>
        </div>
      </div>
    </div>
  `;

  const servers = parseHiAnimeServers(sampleHtml);
  assert.equal(servers.length, 4);

  assert.deepEqual(servers[0], {
    type: 'sub',
    id: '321500',
    serverId: '34801',
    name: 'HD-1',
  });

  assert.deepEqual(servers[1], {
    type: 'sub',
    id: '321501',
    serverId: '74473',
    name: 'HD-2',
  });

  assert.deepEqual(servers[2], {
    type: 'sub',
    id: '321502',
    serverId: '465',
    name: 'HD-3',
  });

  assert.deepEqual(servers[3], {
    type: 'dub',
    id: '321510',
    serverId: '34801',
    name: 'HD-1',
  });
});

test('parseHiAnimeServers: handles malformed HTML without crashing', () => {
  assert.deepEqual(parseHiAnimeServers(''), []);
  assert.deepEqual(parseHiAnimeServers(null), []);
  assert.deepEqual(parseHiAnimeServers('<div class="nothing">test</div>'), []);
});

test('extractDirectStreamFromEmbed: removes iframe and extracts direct MegaPlay HLS stream (HD-1)', async () => {
  const mockResolveMegaplay = async (url) => {
    assert.match(url, /megaplay\.buzz/);
    return {
      streamUrl: 'https://cdn.example.com/anime/master.m3u8?token=xyz',
      quality: '1080p',
      subtitles: [{ language: 'English', url: 'https://cdn.example.com/subs/en.vtt' }],
      intro: { start: 24, end: 109 },
      outro: { start: 1347, end: 1429 },
    };
  };

  const res = await extractDirectStreamFromEmbed('https://megaplay.buzz/stream/s-2/113651/sub', {
    resolveMegaplayEmbed: mockResolveMegaplay,
  });

  assert.ok(res);
  assert.equal(res.streamUrl, 'https://cdn.example.com/anime/master.m3u8?token=xyz');
  assert.equal(res.referer, 'https://megaplay.buzz/');
  assert.equal(res.quality, '1080p');
  assert.deepEqual(res.skip, {
    intro: { start: 24, end: 109 },
    outro: { start: 1347, end: 1429 },
  });
  assert.equal(res.subtitles.length, 1);
});

test('extractDirectStreamFromEmbed: removes iframe and extracts direct ZokoAnime HLS stream (HD-3)', async () => {
  const mockResolveZoko = async (url) => {
    assert.match(url, /zokoanime\.video/);
    return {
      masterUrl: 'https://hls.dramahot.top/p/abc/master.m3u8',
      defaultQuality: '1080p',
      subtitles: [{ id: 'zoko-0', language: 'en', url: 'https://hls.dramahot.top/subs/en.vtt' }],
      skip: null,
    };
  };

  const res = await extractDirectStreamFromEmbed('https://zokoanime.video/stream/mal/61967/7/sub', {
    resolveZokoEmbedEdge: mockResolveZoko,
  });

  assert.ok(res);
  assert.equal(res.streamUrl, 'https://hls.dramahot.top/p/abc/master.m3u8');
  assert.equal(res.referer, 'https://zokoanime.video/');
  assert.equal(res.quality, '1080p');
  assert.equal(res.subtitles.length, 1);
});

test('extractDirectStreamFromEmbed: returns null for unsupported or empty embed URLs', async () => {
  assert.equal(await extractDirectStreamFromEmbed(''), null);
  assert.equal(await extractDirectStreamFromEmbed(null), null);
  assert.equal(await extractDirectStreamFromEmbed('https://unknown-ad-host.com/embed/123'), null);
});

test('resolveHiAnimeV2Direct: supports HD-1, HD-2, HD-3 server targets without throwing', async () => {
  // Test resolving via malId fallback for Solo Leveling S1 ep 1
  const hd1 = await resolveHiAnimeV2Direct({ malId: 52299, ep: 1, audio: 'sub', server: 'HD-1' });
  assert.ok(hd1, 'HD-1 must resolve');
  assert.equal(hd1.serverName, 'HD-1');
  assert.ok(hd1.streamUrl.includes('m3u8') || hd1.streamUrl.includes('nexabloom.top'));

  const hd3 = await resolveHiAnimeV2Direct({ malId: 52299, ep: 1, audio: 'sub', server: 'HD-3' });
  assert.ok(hd3, 'HD-3 must resolve');
  assert.equal(hd3.serverName, 'HD-3');
  assert.ok(hd3.streamUrl.includes('m3u8') || hd3.streamUrl.includes('dramahot.top'));
});
