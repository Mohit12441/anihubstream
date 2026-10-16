import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { run } from './sync-anilist.mjs';

const realFetch = globalThis.fetch;
const realEnv = { ...process.env };

describe('sync-anilist terminal cursor persistence', () => {
  let calls;
  let storedMeta;
  let leaseOwner;

  beforeEach(() => {
    calls = [];
    storedMeta = new Map();
    leaseOwner = null;

    process.env.CF_ACCOUNT_ID = 'test-account-id';
    process.env.CF_DATABASE_ID = 'test-database-id';
    process.env.CF_API_TOKEN = 'test-token';
    process.env.MODE = 'mirror';
    process.env.LEGACY_WRITER_ACTIVE = '1';
    process.env.CLOUD_CREATES_ROWS = '0';
    process.env.CLOUD_OWNS_SCHEDULE = '0';
    process.env.CLOUD_OWNS_GENRES = '0';
    process.env.ANILIST_MIN_INTERVAL_MS = '20';
    process.env.MAX_ITEMS_PER_RUN = '100';

    globalThis.fetch = async (url, init = {}) => {
      calls.push({ url, init });
      const body = init.body ? JSON.parse(init.body) : {};
      const sql = body.sql || '';
      const params = body.params || [];

      // D1 query dispatcher
      if (sql.includes('pragma_table_info')) {
        const pragma = [
          { name: 'id', type: 'TEXT', notnull: 1, dflt_value: null, pk: 1 },
          { name: 'title', type: 'TEXT', notnull: 1, dflt_value: "''" },
          { name: 'native', type: 'TEXT', notnull: 1, dflt_value: "''" },
          { name: 'year', type: 'INTEGER', notnull: 1, dflt_value: '0' },
          { name: 'rating', type: 'REAL', notnull: 1, dflt_value: '0' },
          { name: 'season', type: 'TEXT', notnull: 1, dflt_value: "''" },
          { name: 'kind', type: 'TEXT', notnull: 1, dflt_value: "'TV'" },
          { name: 'status', type: 'TEXT', notnull: 1, dflt_value: "'Finished'" },
          { name: 'art', type: 'TEXT', notnull: 1, dflt_value: "''" },
          { name: 'key_art', type: 'TEXT', notnull: 1, dflt_value: "''" },
          { name: 'accent', type: 'TEXT', notnull: 1, dflt_value: "''" },
          { name: 'synopsis', type: 'TEXT', notnull: 1, dflt_value: "''" },
          { name: 'rank', type: 'INTEGER', notnull: 0, dflt_value: null },
          { name: 'trend_rank', type: 'INTEGER', notnull: 0, dflt_value: null },
          { name: 'alt_seasons', type: 'TEXT', notnull: 0, dflt_value: null },
          { name: 'sched_day', type: 'INTEGER', notnull: 0, dflt_value: null },
          { name: 'sched_day_label', type: 'TEXT', notnull: 0, dflt_value: null },
          { name: 'sched_date', type: 'TEXT', notnull: 0, dflt_value: null },
          { name: 'sched_time', type: 'TEXT', notnull: 0, dflt_value: null },
          { name: 'sched_season', type: 'TEXT', notnull: 0, dflt_value: null },
          { name: 'source_ids', type: 'TEXT', notnull: 0, dflt_value: null },
          { name: 'skip_key_id', type: 'TEXT', notnull: 0, dflt_value: null },
          { name: 'skip_key_space', type: 'TEXT', notnull: 0, dflt_value: null },
          { name: 'episode_total', type: 'INTEGER', notnull: 0, dflt_value: null },
          { name: 'added_at', type: 'TEXT', notnull: 0, dflt_value: null },
          { name: 'search_text', type: 'TEXT', notnull: 0, dflt_value: null },
          { name: 'cloud_synced_at', type: 'INTEGER', notnull: 0, dflt_value: null },
          { name: 'catalogue_synced_at', type: 'INTEGER', notnull: 0, dflt_value: null },
        ];
        return {
          status: 200,
          ok: true,
          text: async () => JSON.stringify({ success: true, result: [{ results: pragma, success: true, meta: {} }] }),
        };
      }

      if (sql.includes('FROM sqlite_master WHERE type =')) {
        const tables = [
          'anime', 'genre', 'anime_genre', 'sync_lock', 'api_usage', 'sync_runs', 'sync_meta', 'sync_pending',
        ].map((name) => ({ name }));
        return {
          status: 200,
          ok: true,
          text: async () => JSON.stringify({ success: true, result: [{ results: tables, success: true, meta: {} }] }),
        };
      }

      if (sql.includes('SELECT value FROM sync_meta WHERE key = ?')) {
        const key = params[0];
        const val = storedMeta.get(key);
        const results = val !== undefined ? [{ value: val }] : [];
        return {
          status: 200,
          ok: true,
          text: async () => JSON.stringify({ success: true, result: [{ results, success: true, meta: {} }] }),
        };
      }

      if (sql.includes('INSERT INTO sync_meta (key, value) VALUES (?1, ?2)') || sql.includes('INSERT INTO sync_meta (key, value) VALUES (?, ?)')) {
        const key = params[0];
        const val = params[1];
        storedMeta.set(key, val);
        return {
          status: 200,
          ok: true,
          text: async () => JSON.stringify({ success: true, result: [{ results: [], success: true, meta: { changes: 1 } }] }),
        };
      }

      if (sql.includes('INSERT INTO sync_lock')) {
        leaseOwner = params[1];
        return {
          status: 200,
          ok: true,
          text: async () => JSON.stringify({ success: true, result: [{ results: [], success: true, meta: { changes: 1 } }] }),
        };
      }

      if (sql.includes('SELECT owner FROM sync_lock WHERE name = ?1')) {
        return {
          status: 200,
          ok: true,
          text: async () => JSON.stringify({ success: true, result: [{ results: [{ owner: leaseOwner }], success: true, meta: {} }] }),
        };
      }

      if (sql.includes('DELETE FROM sync_lock')) {
        leaseOwner = null;
        return {
          status: 200,
          ok: true,
          text: async () => JSON.stringify({ success: true, result: [{ results: [], success: true, meta: { changes: 1 } }] }),
        };
      }

      if (sql.includes('SELECT requests FROM api_usage')) {
        return {
          status: 200,
          ok: true,
          text: async () => JSON.stringify({ success: true, result: [{ results: [{ requests: 0 }], success: true, meta: {} }] }),
        };
      }

      if (sql.includes('SELECT id, label FROM genre')) {
        return {
          status: 200,
          ok: true,
          text: async () => JSON.stringify({ success: true, result: [{ results: [], success: true, meta: {} }] }),
        };
      }

      if (sql.includes('FROM anime WHERE id > ? ORDER BY id')) {
        // Return empty slice so catalogue is at end
        return {
          status: 200,
          ok: true,
          text: async () => JSON.stringify({ success: true, result: [{ results: [], success: true, meta: {} }] }),
        };
      }

      if (sql.includes('INSERT INTO sync_runs')) {
        return {
          status: 200,
          ok: true,
          text: async () => JSON.stringify({ success: true, result: [{ results: [], success: true, meta: { changes: 1 } }] }),
        };
      }

      return {
        status: 200,
        ok: true,
        text: async () => JSON.stringify({ success: true, result: [{ results: [], success: true, meta: {} }] }),
      };
    };
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    for (const k of Object.keys(process.env)) {
      if (realEnv[k] === undefined) delete process.env[k];
      else process.env[k] = realEnv[k];
    }
  });

  it('persists terminal cursor with done:true when slice is empty', async () => {
    const summary = await run({ forceTakeover: false });

    assert.equal(summary.exit_reason, 'catalogue_end');
    assert.ok(summary.cursor, 'summary should have cursor');
    assert.equal(summary.cursor.done, true);
    assert.equal(summary.cursor.after, '');
    assert.equal(summary.cursor.pendingAfter, 0);
    assert.ok(summary.cursor.doneAt > 0);

    const rawPersisted = storedMeta.get('cloud_anilist_cursor:mirror');
    assert.ok(rawPersisted, 'cursor must be persisted in sync_meta under cloud_anilist_cursor:mirror');
    const persisted = JSON.parse(rawPersisted);
    assert.equal(persisted.done, true);
    assert.equal(persisted.after, '');
    assert.equal(persisted.pendingAfter, 0);
    assert.equal(persisted.doneAt, summary.cursor.doneAt);
  });

  function createSyncMockFetch({ catalogueRows = [], pendingRows = [], mediaMap = {}, onInsert = null }) {
    const prevFetch = globalThis.fetch;
    return async (url, init = {}) => {
      const u = String(url);
      if (u.includes('graphql.anilist.co')) {
        const body = init.body ? JSON.parse(init.body) : {};
        const q = body.query || '';
        if (q.includes('Page(')) {
          return {
            status: 200,
            headers: new Headers(),
            ok: true,
            text: async () => JSON.stringify({ data: { Page: { pageInfo: { hasNextPage: false }, media: [] } } }),
          };
        }
        const data = {};
        for (const [, alias, id] of q.matchAll(/m(\d+):\s*Media\(id:\s*(\d+)\)/g)) {
          const numId = Number(id);
          if (mediaMap[numId]) {
            data[`m${alias}`] = mediaMap[numId];
            continue;
          }
          const title = numId >= 3000 ? `Pending ${numId - 3000}` : `Catalogue ${numId - 2000}`;
          data[`m${alias}`] = {
            id: numId,
            idMal: null,
            title: { english: title, romaji: null, native: null },
            format: 'TV',
            type: 'ANIME',
            status: 'FINISHED',
            season: 'FALL',
            seasonYear: 2024,
            averageScore: 80,
            episodes: 12,
            duration: 24,
            coverImage: { large: 'https://art/poster.jpg', extraLarge: null, color: '#22aa44' },
            bannerImage: null,
            description: 'desc',
            genres: ['Action'],
            trending: 50,
            nextAiringEpisode: null,
            startDate: { year: 2024 },
          };
        }
        return {
          status: 200,
          headers: new Headers(),
          ok: true,
          text: async () => JSON.stringify({ data }),
        };
      }

      const body = init.body ? JSON.parse(init.body) : {};
      const sql = body.sql || '';
      const params = body.params || [];

      if (sql.includes('FROM anime WHERE id > ? ORDER BY id')) {
        const after = params[0] || '';
        const limit = Number(sql.match(/LIMIT\s+(\d+)/)?.[1] ?? 100);
        const filtered = catalogueRows.filter((r) => r.id > after).slice(0, limit);
        return {
          status: 200,
          ok: true,
          text: async () => JSON.stringify({ success: true, result: [{ results: filtered, success: true, meta: {} }] }),
        };
      }

      if (sql.includes('FROM anime WHERE') && (sql.includes('anime.id IN') || sql.includes('json_extract'))) {
        const matched = [];
        for (const r of catalogueRows) {
          let anilistId = null;
          try { anilistId = JSON.parse(r.source_ids ?? '{}').anilist; } catch {}
          if (params.includes(r.id) || (anilistId && params.includes(anilistId))) {
            matched.push(r);
          }
        }
        return {
          status: 200,
          ok: true,
          text: async () => JSON.stringify({ success: true, result: [{ results: matched, success: true, meta: {} }] }),
        };
      }

      if (sql.includes('INSERT INTO anime')) {
        if (typeof onInsert === 'function') onInsert({ sql, params });
        return {
          status: 200,
          ok: true,
          text: async () => JSON.stringify({ success: true, result: [{ results: [], success: true, meta: { changes: 1 } }] }),
        };
      }

      if (sql.includes('FROM sync_pending')) {
        const after = params[0] || 0;
        const limit = Number(sql.match(/LIMIT\s+(\d+)/)?.[1] ?? 100);
        const filtered = pendingRows.filter((r) => r.anilist_id > after).slice(0, limit);
        return {
          status: 200,
          ok: true,
          text: async () => JSON.stringify({ success: true, result: [{ results: filtered, success: true, meta: {} }] }),
        };
      }

      if (sql.includes('DELETE FROM sync_pending WHERE anilist_id IN') || sql.includes('DELETE FROM sync_pending WHERE id IN')) {
        return {
          status: 200,
          ok: true,
          text: async () => JSON.stringify({ success: true, result: [{ results: [], success: true, meta: { changes: params.length } }] }),
        };
      }

      return prevFetch(url, init);
    };
  }

  it('prioritizes pending queue items then allocates remaining budget to catalogue slice under strict cap', async () => {
    process.env.MODE = 'delta';
    process.env.CLOUD_CREATES_ROWS = '1';
    process.env.MAX_ITEMS_PER_RUN = '10';

    const mockCatalogueRows = Array.from({ length: 10 }, (_, i) => ({
      id: `catalogue-${i}`,
      title: `Catalogue ${i}`,
      native: '',
      year: 2024,
      rating: 8.0,
      season: 'Fall 2024',
      kind: 'TV',
      status: 'Finished',
      art: 'art.jpg',
      key_art: 'key.jpg',
      accent: '#fff',
      synopsis: 'synopsis',
      source_ids: JSON.stringify({ anilist: 2000 + i }),
      added_at: '2026-01-01',
      catalogue_synced_at: 1000,
    }));

    const mockPendingRows = Array.from({ length: 4 }, (_, i) => ({
      id: i + 1,
      anilist_id: 3000 + i,
      slug: `pending-${i}`,
      added_at: Date.now(),
      note: 'test',
    }));

    globalThis.fetch = createSyncMockFetch({ catalogueRows: mockCatalogueRows, pendingRows: mockPendingRows });

    const mod = await import(`./sync-anilist.mjs?case=${Date.now()}-strict1`);
    const summary = await mod.run({ forceTakeover: false });

    // Cap of 10 with 4 pending items: processes 4 pending items + 6 catalogue items = exactly 10
    assert.equal(summary.items_processed, 10, 'strictly respects MAX_ITEMS_PER_RUN cap');
    assert.equal(summary.created, 4, 'all 4 pending queue entries created');
    assert.equal(summary.exit_reason, 'item_cap');
    assert.equal(summary.cursor.pendingAfter, 3003, 'all 4 pending queue entries consumed');
    assert.equal(summary.cursor.after, 'catalogue-5', 'catalogue cursor advanced to the 6th row (index 5)');
  });

  it('enforces strict cap when pending queue has more items than remaining budget', async () => {
    process.env.MODE = 'delta';
    process.env.CLOUD_CREATES_ROWS = '1';
    process.env.MAX_ITEMS_PER_RUN = '3';

    const mockCatalogueRows = Array.from({ length: 10 }, (_, i) => ({
      id: `catalogue-${i}`,
      title: `Catalogue ${i}`,
      native: '',
      year: 2024,
      rating: 8.0,
      season: 'Fall 2024',
      kind: 'TV',
      status: 'Finished',
      art: 'art.jpg',
      key_art: 'key.jpg',
      accent: '#fff',
      synopsis: 'synopsis',
      source_ids: JSON.stringify({ anilist: 2000 + i }),
      added_at: '2026-01-01',
      catalogue_synced_at: 1000,
    }));

    const mockPendingRows = Array.from({ length: 5 }, (_, i) => ({
      id: i + 1,
      anilist_id: 3000 + i,
      slug: `pending-${i}`,
      added_at: Date.now(),
      note: 'test',
    }));

    globalThis.fetch = createSyncMockFetch({ catalogueRows: mockCatalogueRows, pendingRows: mockPendingRows });

    const mod = await import(`./sync-anilist.mjs?case=${Date.now()}-strict2`);
    const summary = await mod.run({ forceTakeover: false });

    // Cap of 3 with 5 pending items: processes exactly 3 pending items and 0 catalogue items
    assert.equal(summary.items_processed, 3, 'strictly halts at cap without reading catalogue rows');
    assert.equal(summary.created, 3, 'first 3 pending queue entries created');
    assert.equal(summary.exit_reason, 'item_cap');
    assert.equal(summary.cursor.pendingAfter, 3002, 'pending cursor advanced to 3rd entry (index 2)');
    assert.equal(summary.cursor.after, '', 'catalogue cursor left untouched since no catalogue rows read');
  });

  it('processes pending queue items and halts with catalogue_end when catalogue slice is empty', async () => {
    process.env.MODE = 'delta';
    process.env.CLOUD_CREATES_ROWS = '1';
    process.env.MAX_ITEMS_PER_RUN = '10';

    const mockPendingRows = Array.from({ length: 4 }, (_, i) => ({
      id: i + 1,
      anilist_id: 3000 + i,
      slug: `pending-${i}`,
      added_at: Date.now(),
      note: 'test',
    }));

    globalThis.fetch = createSyncMockFetch({ catalogueRows: [], pendingRows: mockPendingRows });

    const mod = await import(`./sync-anilist.mjs?case=${Date.now()}-strict3`);
    const summary = await mod.run({ forceTakeover: false });

    assert.equal(summary.items_processed, 4, 'processes all 4 pending items');
    assert.equal(summary.created, 4, 'creates all 4 pending items');
    assert.equal(summary.exit_reason, 'catalogue_end', 'reaches catalogue_end when catalogue is empty');
    assert.equal(summary.cursor.done, true, 'persists terminal cursor with done: true');
  });

  it('reuses canonical stored id when AniList media title produces a different slug, updating instead of inserting', async () => {
    process.env.MODE = 'delta';
    process.env.CLOUD_CREATES_ROWS = '1';
    process.env.MAX_ITEMS_PER_RUN = '10';

    const mockCatalogueRows = [{
      id: 'stored-canonical-slug',
      title: 'Stored Japanese Title',
      native: '',
      year: 2024,
      rating: 8.5,
      season: 'Fall 2024',
      kind: 'TV',
      status: 'Finished',
      art: 'art.jpg',
      key_art: 'key.jpg',
      accent: '#fff',
      synopsis: 'synopsis',
      source_ids: JSON.stringify({ anilist: 5001 }),
      added_at: '2026-01-01',
      catalogue_synced_at: 1000,
    }];

    const mediaMap = {
      5001: {
        id: 5001,
        idMal: null,
        title: { english: 'English Divergent Title', romaji: 'Stored Japanese Title', native: null },
        format: 'TV',
        type: 'ANIME',
        status: 'FINISHED',
        season: 'FALL',
        seasonYear: 2024,
        averageScore: 85,
        episodes: 12,
        duration: 24,
        coverImage: { large: 'https://art/poster.jpg', extraLarge: null, color: '#22aa44' },
        bannerImage: null,
        description: 'desc',
        genres: ['Action'],
        trending: 10,
        nextAiringEpisode: null,
        startDate: { year: 2024 },
      },
    };

    let upsertedRowId = null;
    globalThis.fetch = createSyncMockFetch({
      catalogueRows: mockCatalogueRows,
      pendingRows: [],
      mediaMap,
      onInsert: ({ params }) => {
        upsertedRowId = params[0];
      },
    });

    const mod = await import(`./sync-anilist.mjs?case=${Date.now()}-canon-id`);
    const summary = await mod.run({ forceTakeover: false });

    assert.equal(summary.created, 0, 'no new row should be created for divergent slug');
    assert.equal(summary.planned_creates, 0, 'zero planned creations');
    assert.equal(summary.updated, 1, 'record identified and updated as existing');
    assert.equal(upsertedRowId, 'stored-canonical-slug', 'reused existing canonical stored id');
  });

  it('resolves existing records outside the current 10-row catalogue slice, preventing false creations', async () => {
    process.env.MODE = 'delta';
    process.env.CLOUD_CREATES_ROWS = '1';
    process.env.MAX_ITEMS_PER_RUN = '10';

    // 15 catalogue rows: catalogue-00 to catalogue-14
    const mockCatalogueRows = Array.from({ length: 15 }, (_, i) => ({
      id: `catalogue-${String(i).padStart(2, '0')}`,
      title: `Catalogue ${i}`,
      native: '',
      year: 2024,
      rating: 8.0,
      season: 'Fall 2024',
      kind: 'TV',
      status: 'Finished',
      art: 'art.jpg',
      key_art: 'key.jpg',
      accent: '#fff',
      synopsis: 'synopsis',
      source_ids: JSON.stringify({ anilist: 4000 + i }),
      added_at: '2026-01-01',
      catalogue_synced_at: 1000,
    }));

    // Queue has title 4014 (which exists at index 14, outside the first 10 rows)
    const mockPendingRows = [{
      id: 1,
      anilist_id: 4014,
      slug: 'catalogue-14',
      added_at: Date.now(),
      note: 'test-outside-slice',
    }];

    globalThis.fetch = createSyncMockFetch({ catalogueRows: mockCatalogueRows, pendingRows: mockPendingRows });

    const mod = await import(`./sync-anilist.mjs?case=${Date.now()}-outside-slice`);
    const summary = await mod.run({ forceTakeover: false });

    assert.equal(summary.created, 0, 'candidate existing outside slice must NOT be reported as created');
    assert.equal(summary.planned_creates, 0, 'planned_creates must be 0 for existing item');
    assert.equal(summary.updated, 10, '1 pending update + 9 catalogue slice updates = 10 updates');
    assert.equal(summary.items_processed, 10, 'strictly respects item cap');
  });

  it('accurately accounts for genuine new titles, updates, and skipped titles with distinct counters', async () => {
    process.env.MODE = 'delta';
    process.env.CLOUD_CREATES_ROWS = '1';
    process.env.MAX_ITEMS_PER_RUN = '10';

    const mockCatalogueRows = [{
      id: 'catalogue-standalone',
      title: 'Catalogue Standalone Title',
      native: '',
      year: 2024,
      rating: 7.0,
      season: 'Fall 2024',
      kind: 'TV',
      status: 'Finished',
      art: 'art.jpg',
      key_art: 'key.jpg',
      accent: '#fff',
      synopsis: 'synopsis',
      source_ids: JSON.stringify({ anilist: 7000 }),
      added_at: '2026-01-01',
      catalogue_synced_at: 1000,
    }, {
      id: 'existing-stored-title',
      title: 'Existing Stored Title',
      native: '',
      year: 2024,
      rating: 7.0,
      season: 'Fall 2024',
      kind: 'TV',
      status: 'Finished',
      art: 'art.jpg',
      key_art: 'key.jpg',
      accent: '#fff',
      synopsis: 'synopsis',
      source_ids: JSON.stringify({ anilist: 7001 }),
      added_at: '2026-01-01',
      catalogue_synced_at: 1000,
    }];

    const mockPendingRows = [
      { id: 1, anilist_id: 7001, slug: 'existing-stored-title', added_at: Date.now(), note: 'existing' },
      { id: 2, anilist_id: 7002, slug: 'brand-new-title', added_at: Date.now(), note: 'new' },
      { id: 3, anilist_id: 7003, slug: 'no-artwork-title', added_at: Date.now(), note: 'no-art' },
    ];

    const mediaMap = {
      7000: {
        id: 7000,
        idMal: null,
        title: { english: 'Catalogue Standalone Title', romaji: null, native: null },
        format: 'TV',
        type: 'ANIME',
        status: 'FINISHED',
        season: 'FALL',
        seasonYear: 2024,
        averageScore: 70,
        episodes: 12,
        duration: 24,
        coverImage: { large: 'https://art/poster0.jpg', extraLarge: null, color: '#22aa44' },
        bannerImage: null,
        description: 'desc',
        genres: ['Action'],
        trending: null,
        nextAiringEpisode: null,
        startDate: { year: 2024 },
      },
      7001: {
        id: 7001,
        idMal: null,
        title: { english: 'Existing Stored Title', romaji: null, native: null },
        format: 'TV',
        type: 'ANIME',
        status: 'FINISHED',
        season: 'FALL',
        seasonYear: 2024,
        averageScore: 70,
        episodes: 12,
        duration: 24,
        coverImage: { large: 'https://art/poster.jpg', extraLarge: null, color: '#22aa44' },
        bannerImage: null,
        description: 'desc',
        genres: ['Action'],
        trending: null,
        nextAiringEpisode: null,
        startDate: { year: 2024 },
      },
      7002: {
        id: 7002,
        idMal: null,
        title: { english: 'Brand New Title', romaji: null, native: null },
        format: 'TV',
        type: 'ANIME',
        status: 'FINISHED',
        season: 'FALL',
        seasonYear: 2024,
        averageScore: 88,
        episodes: 24,
        duration: 24,
        coverImage: { large: 'https://art/new.jpg', extraLarge: null, color: '#33bb55' },
        bannerImage: null,
        description: 'desc',
        genres: ['Action'],
        trending: 25,
        nextAiringEpisode: null,
        startDate: { year: 2024 },
      },
      7003: {
        id: 7003,
        idMal: null,
        title: { english: 'No Artwork Title', romaji: null, native: null },
        format: 'TV',
        type: 'ANIME',
        status: 'FINISHED',
        season: 'FALL',
        seasonYear: 2024,
        averageScore: 60,
        episodes: 12,
        duration: 24,
        coverImage: { large: null, extraLarge: null, color: null },
        bannerImage: null,
        description: 'desc',
        genres: ['Comedy'],
        trending: null,
        nextAiringEpisode: null,
        startDate: { year: 2024 },
      },
    };

    globalThis.fetch = createSyncMockFetch({ catalogueRows: mockCatalogueRows, pendingRows: mockPendingRows, mediaMap });

    const mod = await import(`./sync-anilist.mjs?case=${Date.now()}-counters`);
    const summary = await mod.run({ forceTakeover: false });

    assert.equal(summary.created, 1, 'exactly 1 genuine new title inserted');
    assert.equal(summary.planned_creates, 1, 'exactly 1 planned creation');
    assert.equal(summary.updated, 2, '2 updates: 1 from pending + 1 from catalogue slice');
    assert.equal(summary.skipped, 1, '1 title skipped for lack of artwork');
  });

  it('does not increase catalogue count or created counter on rerun of an existing title', async () => {
    process.env.MODE = 'delta';
    process.env.CLOUD_CREATES_ROWS = '1';
    process.env.MAX_ITEMS_PER_RUN = '10';

    const mockCatalogueRows = [{
      id: 'existing-title',
      title: 'Existing Title',
      native: '',
      year: 2024,
      rating: 8.0,
      season: 'Fall 2024',
      kind: 'TV',
      status: 'Finished',
      art: 'art.jpg',
      key_art: 'key.jpg',
      accent: '#fff',
      synopsis: 'synopsis',
      source_ids: JSON.stringify({ anilist: 8001 }),
      added_at: '2026-01-01',
      catalogue_synced_at: 1000,
    }];

    globalThis.fetch = createSyncMockFetch({ catalogueRows: mockCatalogueRows, pendingRows: [] });

    const mod = await import(`./sync-anilist.mjs?case=${Date.now()}-rerun`);
    const summary = await mod.run({ forceTakeover: false });

    assert.equal(summary.created, 0, 'rerun must not increment created');
    assert.equal(summary.planned_creates, 0, 'rerun must have 0 planned_creates');
    assert.equal(summary.updated, 1, 'rerun must be counted as updated');
  });

  it('preserves trend_rank and schedule ownership under delta mode', async () => {
    const mod = await import(`./sync-anilist.mjs?case=${Date.now()}-ownership`);

    // In delta mode, trend_rank is NOT in the update set
    const deltaUpdate = mod.updateSet('delta');
    assert.equal(deltaUpdate.includes('trend_rank'), false, 'trend_rank must never be updated in delta mode');
    assert.equal(deltaUpdate.includes('sched_day'), false, 'sched_* must not be updated by default in delta mode');

    // With fillSchedule = true, sched_* is added to update set with SCHED_FILL_GUARD
    const fillUpdate = mod.updateSet('delta', { fillSchedule: true });
    assert.equal(fillUpdate.includes('trend_rank'), false, 'trend_rank remains excluded even with fillSchedule');
    assert.equal(fillUpdate.includes('sched_day'), true, 'sched_day included in fillSchedule');
    assert.match(mod.SCHED_FILL_GUARD, /catalogue_synced_at IS NULL/, 'fill guard protects rows stamped by local task');
    assert.match(mod.SCHED_FILL_GUARD, /sched_day IS NULL/, 'fill guard protects non-empty schedule slots');

    // rowFromMedia stamps trendRank for new rows
    const newRow = mod.rowFromMedia({ id: 9001, title: { english: 'New' } }, null, { trendRank: 12 });
    assert.equal(newRow.trend_rank, 12, 'new row receives trend_rank');

    // rowFromMedia preserves canonical id when existing is provided
    const updatedRow = mod.rowFromMedia({ id: 9001, title: { english: 'Divergent English' } }, { id: 'canonical-orig' });
    assert.equal(updatedRow.id, 'canonical-orig', 'rowFromMedia reuses canonical id');
  });
});
