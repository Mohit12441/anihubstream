// @ts-check
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet as getAniskip } from '../functions/api/aniskip.js';
import { onRequestGet as getIdMap, onRequestPost as postIdMap } from '../functions/api/id-map.js';
import { onRequestGet as getPlay } from '../functions/api/play.js';

/**
 * Creates a mock D1 database environment
 */
function createMockEnv(initialData = {}) {
  const animeTable = initialData.anime || [];
  const idMapTable = initialData.idMap || [];
  const episodeTable = initialData.episodes || [];

  return {
    STREAM_BRIDGE_URL: 'http://127.0.0.1:8795',
    ANIHUB: {
      prepare(sql) {
        return {
          bind(...args) {
            return {
              async first() {
                if (sql.includes('FROM anime_id_map WHERE anime_id = ?1')) {
                  const [animeId] = args;
                  return idMapTable.find((r) => r.anime_id === animeId) || null;
                }
                if (sql.includes('FROM anime_id_map WHERE mal_id = ?1')) {
                  const [malId] = args;
                  return idMapTable.find((r) => r.mal_id === malId) || null;
                }
                if (sql.includes('FROM anime_id_map WHERE anilist_id = ?1')) {
                  const [anilistId] = args;
                  return idMapTable.find((r) => r.anilist_id === anilistId) || null;
                }
                if (sql.includes('FROM anime_id_map WHERE kitsu_id = ?1')) {
                  const [kitsuId] = args;
                  return idMapTable.find((r) => r.kitsu_id === kitsuId) || null;
                }
                if (sql.includes('FROM anime WHERE id = ?1')) {
                  const [id] = args;
                  return animeTable.find((r) => r.id === id) || null;
                }
                if (sql.includes('FROM anime a') && sql.includes('LEFT JOIN episode e')) {
                  const [id, ep] = args;
                  const anime = animeTable.find((r) => r.id === id);
                  if (!anime) return null;
                  const episode = episodeTable.find((e) => e.anime_id === id && e.n === ep);
                  const idMap = idMapTable.find((m) => m.anime_id === id);
                  return {
                    id: anime.id,
                    title: anime.title,
                    source_ids: anime.source_ids,
                    skip_key_id: anime.skip_key_id,
                    skip_key_space: anime.skip_key_space,
                    runtime_seconds: episode?.runtime_seconds || 1440,
                    mal_id: idMap?.mal_id || null,
                    kitsu_id: idMap?.kitsu_id || null,
                    anilist_id: idMap?.anilist_id || null,
                  };
                }
                return null;
              },
              async all() {
                return { results: [] };
              },
              async run() {
                if (sql.includes('INSERT INTO anime_id_map')) {
                  const [animeId, malId, anilistId, kitsuId, anikotoSlug, hianimeSlug, aniwatchSlug, adbSlug, wawSlug] = args;
                  const existingIdx = idMapTable.findIndex((r) => r.anime_id === animeId);
                  const newRow = {
                    anime_id: animeId,
                    mal_id: malId,
                    anilist_id: anilistId,
                    kitsu_id: kitsuId,
                    anikoto_slug: anikotoSlug,
                    hianime_slug: hianimeSlug,
                    aniwatch_slug: aniwatchSlug,
                    adb_slug: adbSlug,
                    waw_slug: wawSlug,
                    updated_at: new Date().toISOString(),
                  };
                  if (existingIdx >= 0) {
                    idMapTable[existingIdx] = { ...idMapTable[existingIdx], ...newRow };
                  } else {
                    idMapTable.push(newRow);
                  }
                  return { success: true };
                }
                return { success: true };
              },
            };
          },
        };
      },
    },
  };
}

describe('Phase 1: Edge APIs & Layer 1 Data Contract', () => {
  describe('functions/api/id-map.js', () => {
    it('rejects GET requests without identifier parameters with 400', async () => {
      const env = createMockEnv();
      const req = new Request('http://localhost/api/id-map');
      const res = await getIdMap({ request: req, env });
      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.strictEqual(data.error, 'bad_request');
    });

    it('rejects POST requests without animeId with 400', async () => {
      const env = createMockEnv();
      const req = new Request('http://localhost/api/id-map', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ malId: 12345 }),
      });
      const res = await postIdMap({ request: req, env });
      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.strictEqual(data.error, 'bad_request');
    });

    it('upserts and retrieves mappings across MAL, AniList, and Kitsu IDs', async () => {
      const env = createMockEnv();

      // Upsert mapping
      const postReq = new Request('http://localhost/api/id-map', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          animeId: 'frieren-beyond-journeys-end',
          malId: 52991,
          anilistId: 154587,
          kitsuId: 46474,
          anikotoSlug: 'frieren-beyond-journeys-end',
          hianimeSlug: 'frieren-beyond-journeys-end-18413',
        }),
      });
      const postRes = await postIdMap({ request: postReq, env });
      assert.strictEqual(postRes.status, 200);

      // Query by animeId
      const getReq = new Request('http://localhost/api/id-map?animeId=frieren-beyond-journeys-end');
      const getRes = await getIdMap({ request: getReq, env });
      assert.strictEqual(getRes.status, 200);
      const data = await getRes.json();
      assert.strictEqual(data.animeId, 'frieren-beyond-journeys-end');
      assert.strictEqual(data.malId, 52991);
      assert.strictEqual(data.anilistId, 154587);
      assert.strictEqual(data.anikotoSlug, 'frieren-beyond-journeys-end');
      assert.strictEqual(data.hianimeSlug, 'frieren-beyond-journeys-end-18413');

      // Query by malId
      const malReq = new Request('http://localhost/api/id-map?malId=52991');
      const malRes = await getIdMap({ request: malReq, env });
      assert.strictEqual(malRes.status, 200);
      const malData = await malRes.json();
      assert.strictEqual(malData.animeId, 'frieren-beyond-journeys-end');
    });

    it('falls back to D1 catalogue anime table if mapping is not in anime_id_map', async () => {
      const env = createMockEnv({
        anime: [
          {
            id: 'solo-leveling',
            title: 'Solo Leveling',
            source_ids: JSON.stringify({ mal: 52299, anilist: 151807, kitsu: 45876 }),
            skip_key_id: 52299,
            skip_key_space: 'mal',
          },
        ],
      });

      const req = new Request('http://localhost/api/id-map?animeId=solo-leveling');
      const res = await getIdMap({ request: req, env });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.animeId, 'solo-leveling');
      assert.strictEqual(data.malId, 52299);
      assert.strictEqual(data.anilistId, 151807);
      assert.strictEqual(data.fromCatalogue, true);
    });
  });

  describe('functions/api/aniskip.js', () => {
    it('rejects missing or invalid malId and ep with 400 Bad Request', async () => {
      const req1 = new Request('http://localhost/api/aniskip?malId=abc&ep=1');
      const res1 = await getAniskip({ request: req1 });
      assert.strictEqual(res1.status, 400);

      const req2 = new Request('http://localhost/api/aniskip?malId=52299&ep=-1');
      const res2 = await getAniskip({ request: req2 });
      assert.strictEqual(res2.status, 400);
    });
  });

  describe('functions/api/play.js Layer 1 schema', () => {
    it('rejects play request without title or resolvable id with 400', async () => {
      const env = createMockEnv();
      const req = new Request('http://localhost/api/play?ep=1');
      const res = await getPlay({ request: req, env });
      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.strictEqual(data.error, 'bad_request');
    });

    it('resolves anime title and malId from catalogue and formats Layer 1 contract', async () => {
      const env = createMockEnv({
        anime: [
          {
            id: 'demon-slayer',
            title: 'Demon Slayer: Kimetsu no Yaiba',
            source_ids: JSON.stringify({ mal: 38000, kitsu: 41370 }),
            skip_key_id: 38000,
            skip_key_space: 'mal',
          },
        ],
        episodes: [
          {
            anime_id: 'demon-slayer',
            n: 1,
            runtime_seconds: 1420,
          },
        ],
      });

      // Mock global fetch for stream bridge and aniskip
      const originalFetch = globalThis.fetch;
      // @ts-ignore
      globalThis.fetch = async (url, opts) => {
        const u = typeof url === 'string' ? url : url.toString();
        if (u.includes('/resolve')) {
          return new Response(JSON.stringify({
            session: 'sid-ds-1',
            provider: 'anikoto',
            kind: 'hls',
            title: 'Demon Slayer: Kimetsu no Yaiba',
            episode: { number: 1, title: 'Cruelty' },
            quality: '1080p',
            variants: ['1080p', '720p', '360p'],
            audio: 'sub',
            skip: {
              intro: { start: 90.0, end: 180.0 },
              outro: { start: 1300.0, end: 1390.0 },
            },
            master: '/stream/sid-ds-1/master.m3u8',
            subtitles: [
              { language: 'en', name: 'English', url: '/stream/sid-ds-1/sub/0.vtt' },
            ],
            downloads: [
              { name: '1080p Pahe', quality: '1080p', url: 'https://cdn.example.com/ep1.mp4' },
            ],
            servers: [
              { id: 'HD-1', name: 'HD-1', type: 'hls' },
              { id: 'HD-2', name: 'HD-2', type: 'hls' },
            ],
          }), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        if (u.includes('aniskip.com')) {
          return new Response(JSON.stringify({
            found: true,
            results: [
              { skipType: 'op', interval: { startTime: 90.5, endTime: 180.5 } },
              { skipType: 'ed', interval: { startTime: 1300.5, endTime: 1390.5 } },
            ],
          }), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        return originalFetch(url, opts);
      };

      try {
        const req = new Request('http://localhost/api/play?id=demon-slayer&ep=1&audio=sub');
        const res = await getPlay({ request: req, env });
        assert.strictEqual(res.status, 200);

        const data = await res.json();
        assert.strictEqual(data.title, 'Demon Slayer: Kimetsu no Yaiba');
        assert.strictEqual(data.episode, 1);
        assert.strictEqual(data.malId, 38000);

        // Verify servers array
        assert.ok(Array.isArray(data.servers));
        assert.strictEqual(data.servers.length, 2);

        const primary = data.servers[0];
        assert.strictEqual(primary.provider, 'anikoto');
        assert.strictEqual(primary.type, 'hls');
        assert.strictEqual(primary.quality, '1080p');
        assert.strictEqual(primary.streamUrl, 'http://127.0.0.1:8795/stream/sid-ds-1/master.m3u8');
        assert.strictEqual(primary.subtitles.length, 1);
        assert.strictEqual(primary.subtitles[0].url, 'http://127.0.0.1:8795/stream/sid-ds-1/sub/0.vtt');
        assert.strictEqual(primary.downloads.length, 1);

        // Verify alternative server
        const alt = data.servers[1];
        assert.strictEqual(alt.id, 'anikoto:HD-2');

        // Verify aniskip standardized object
        assert.ok(data.aniskip);
        assert.strictEqual(data.aniskip.op.start, 90.5);
        assert.strictEqual(data.aniskip.op.end, 180.5);
        assert.strictEqual(data.aniskip.ed.start, 1300.5);
        assert.strictEqual(data.aniskip.ed.end, 1390.5);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('falls back to provider skip times if aniskip upstream yields no results', async () => {
      const env = createMockEnv({
        anime: [
          {
            id: 'mushoku-tensei',
            title: 'Jobless Reincarnation',
            source_ids: JSON.stringify({ mal: 39535 }),
          },
        ],
      });

      const originalFetch = globalThis.fetch;
      // @ts-ignore
      globalThis.fetch = async (url, opts) => {
        const u = typeof url === 'string' ? url : url.toString();
        if (u.includes('/resolve')) {
          return new Response(JSON.stringify({
            session: 'sid-mt-1',
            provider: 'anikoto',
            kind: 'hls',
            title: 'Jobless Reincarnation',
            skip: {
              intro: { start: 105.0, end: 195.0 },
              outro: { start: 1250.0, end: 1340.0 },
            },
            master: '/stream/sid-mt-1/master.m3u8',
          }), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        if (u.includes('aniskip.com')) {
          return new Response(JSON.stringify({ found: false, results: [] }), { status: 404 });
        }
        return originalFetch(url, opts);
      };

      try {
        const req = new Request('http://localhost/api/play?id=mushoku-tensei&ep=1');
        const res = await getPlay({ request: req, env });
        assert.strictEqual(res.status, 200);

        const data = await res.json();
        // Provider skip times fallback
        assert.strictEqual(data.aniskip.op.start, 105.0);
        assert.strictEqual(data.aniskip.op.end, 195.0);
        assert.strictEqual(data.aniskip.ed.start, 1250.0);
        assert.strictEqual(data.aniskip.ed.end, 1340.0);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
