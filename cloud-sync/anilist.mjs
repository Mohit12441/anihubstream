// The AniList client, and the entire anti-block strategy in one file.
//
// Rate-control relevance, in the order the requirements are enforced per request:
//   R1  every outbound call runs inside one module-level promise chain, so there is
//       never more than one AniList request in flight and the spacing maths below is
//       exact rather than approximate;
//   R2  consecutive requests start at least `learned` ms apart (default 2500 => 24/min,
//       under the degraded 30/min ceiling), and ANILIST_RATE_CEILING_RPM clamps the floor
//       so no env value can configure a faster start rate than the ceiling allows;
//   R3  entity lookups are aliased into one document, 25 at a time by default;
//   R4  the interval is learned and persisted by the caller, and starts each run at the
//       stored value;
//   R5  429/403/5xx/network faults back off with full jitter, never sooner than the
//       current interval;
//   R6  three consecutive 403s open the circuit for a cooldown, and a second opening
//       aborts the run instead of spending the remaining budget on a blocked IP;
//   R7  a daily budget is reserved before the request, not after;
//   R10 a low X-RateLimit-Remaining widens the spacing to spread the remainder until reset;
//   R12 direct POST or GET-through-relay, chosen by env, with a one-way fallback.
//
// On the relay: it exists for a network path that cannot POST, and R12's auto-fallback
// deliberately does NOT fire on a "manually blocked" 403 — routing around AniList's own
// block of your IP is a terms problem for the API and an account-ban problem for the free
// host. If you get `blocked`, stop, and contact AniList.

export const ANILIST_DEFAULTS = {
  endpoint: 'https://graphql.anilist.co',
  minIntervalMs: 2500,
  rateCeilingRpm: 24,
  batchSize: 25,
  intervalCapMs: 30000,
  backoffBaseMs: 2000,
  backoffFactor: 2,
  backoffCapMs: 300000,
  maxAttempts: 8,
  breakerThreshold: 3,
  breakerCooldownMs: 600000,
  headerRemainingFloor: 20,
  headerMaxIntervalMs: 120000,
  requestTimeoutMs: 30000,
  decaySuccesses: 20,
  decayFactor: 0.9,
  widenFactor: 1.5,
};

/* Verified against AniList's own schema (introspection of __Type(name:"Media"), 2026-10-14):
   genres is [String] of display labels, trending/popularity/episodes/duration/seasonYear are
   nullable Int, nextAiringEpisode is a single AiringSchedule{airingAt,episode}, and Media.tags
   takes no isList argument. Absent fields come back as explicit JSON null, which is what the
   keepExisting rule in sync-anilist.mjs keys on. */
const FIELDS = `id idMal title{romaji english native} format type status season seasonYear
  averageScore bannerImage coverImage{large extraLarge color} description genres episodes duration
  trending popularity
  nextAiringEpisode{airingAt episode} startDate{year}`;

export class RunAborted extends Error {}
export class BudgetExhausted extends Error {}
/** AniList rejected the *shape* of this document, not the call: a smaller document of the same
    titles will answer. `mediaByIds` bisects on it; anything else that catches it must not retry
    the identical document, which is what makes this a distinct class rather than another Error. */
export class QueryTooComplex extends Error {}

/**
 * A GraphQL-level error arrives as HTTP 200 with a populated `errors` array, so the status code
 * cannot tell a permanent rejection from a hiccup and neither can the presence of the array. This
 * reads the message. It is deliberately not a general retry policy: only the two shapes the sync
 * can act on are distinguished, and everything else keeps the old "do not retry a malformed
 * document" behaviour.
 *
 * Transient is tested FIRST, and that ordering is the whole subtlety: AniList's rate message is
 * "Too many requests", which a `/complex|too many/` complexity pattern would also match — so a
 * naive classifier sends a rate rejection down the bisect path, where it is retried as 2×N smaller
 * documents and multiplies the very traffic that caused it.
 */
export function classifyGraphQLError(errors) {
  const text = String(JSON.stringify(errors ?? ''));
  if (/too many requests|rate.?limit|internal server error|server error|timeout|timed out|temporarily|unavailable|please (try|retry) (again|later)/i.test(text)) return 'transient';
  if (/complexity|query is too |max alternative|too deep|maximum depth/i.test(text)) return 'complexity';
  return 'fatal';
}

/** AniList answers 403 for several unrelated reasons; the right response differs. */
export function classify403(body) {
  const text = String(body ?? '');
  if (/manually blocked/i.test(text)) return 'blocked';
  if (/temporarily disabled/i.test(text)) return 'disabled';
  if (/just a moment|attention required|cf-browser-verification|challenge-platform|cloudflare/i.test(text)) return 'challenge';
  return 'forbidden';
}

/** The only shape AniList GETs are built from: validated integers and a fixed sort set. */
const int = (v, name) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new Error(`anilist: ${name} must be a non-negative integer, got ${v}`);
  return n;
};
const SORTS = new Set(['POPULARITY_DESC', 'TRENDING_DESC', 'SCORE_DESC', 'START_DATE_DESC', 'FAVOURITES_DESC']);

export function createAnilist(options = {}) {
  const cfg = { ...ANILIST_DEFAULTS, ...options };
  const envNumber = (name, key) => (process.env[name] ? Number(process.env[name]) : cfg[key]);
  cfg.endpoint = options.endpoint ?? process.env.ANILIST_ENDPOINT ?? ANILIST_DEFAULTS.endpoint;
  cfg.relayPrefix = options.relayPrefix ?? process.env.ANILIST_RELAY_PREFIX ?? '';
  cfg.method = options.method ?? process.env.ANILIST_METHOD ?? 'auto';
  cfg.minIntervalMs = envNumber('ANILIST_MIN_INTERVAL_MS', 'minIntervalMs');
  cfg.rateCeilingRpm = envNumber('ANILIST_RATE_CEILING_RPM', 'rateCeilingRpm');
  cfg.batchSize = envNumber('ANILIST_BATCH_SIZE', 'batchSize');
  cfg.intervalCapMs = envNumber('ANILIST_INTERVAL_CAP_MS', 'intervalCapMs');
  cfg.breakerCooldownMs = envNumber('ANILIST_BREAKER_COOLDOWN_MS', 'breakerCooldownMs');
  cfg.dailyBudget = options.dailyBudget ?? Number(process.env.ANILIST_DAILY_BUDGET ?? 4000);
  cfg.userAgent = options.userAgent ?? process.env.ANILIST_USER_AGENT ??
    'AniHubStream/1.0 (catalogue sync; contact: https://anihubstream.com/about)';

  /* R2's floor and the R12-style ceiling cannot both be honoured by trusting an env
     number: 60000/ceiling is the smallest spacing that satisfies the ceiling, so the
     floor is the larger of the two. Widening is always safe; narrowing is not. */
  const ceilFloor = Math.max(1, Math.ceil(60000 / cfg.rateCeilingRpm));
  const floor = Math.max(cfg.minIntervalMs, ceilFloor);
  if (cfg.minIntervalMs < ceilFloor) {
    warn(`ANILIST_MIN_INTERVAL_MS=${cfg.minIntervalMs} would exceed ${cfg.rateCeilingRpm} req/min; clamped to ${floor}ms`);
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, Math.round(ms))));
  const jitter = (ms) => Math.random() * ms; /* full jitter */

  let learned = Number.isFinite(options.startIntervalMs) ? clampInterval(options.startIntervalMs) : floor;
  let headerFloor = 0;          /* R10's temporary widening, not persisted */
  let successes = 0;            /* for R4's decay */
  let lastStartAt = 0;
  let consecutive403 = 0;
  let cooldownUntil = 0;
  let transport = cfg.relayPrefix ? (cfg.method === 'get' ? 'relay' : 'direct') : 'direct';
  let chain = Promise.resolve();

  const stats = {
    requests: 0, s403: 0, s429: 0, by403: {}, backoffs: 0, breaker_opens: 0,
    header_widens: 0, relay_used: false, budget_denied: 0, bisects: 0,
  };

  function clampInterval(ms) {
    return Math.min(cfg.intervalCapMs, Math.max(floor, ms));
  }
  const spacing = () => Math.max(learned, headerFloor);

  function warn(line) {
    (options.onWarn ?? ((m) => console.warn(`[anilist] ${m}`)))(line);
  }

  /* R1: one link in a promise chain per logical request. Nothing about AniList is ever
     run in parallel, so `lastStartAt` measures the true gap between request starts. */
  function serialize(task) {
    const run = chain.then(task, task);
    chain = run.then(() => {}, () => {});
    return run;
  }

  const persist = () => options.onThrottle?.({ ms: learned, consecutive: successes, at: new Date().toISOString() });

  async function sendOnce(document) {
    const target = `${cfg.endpoint}?query=${encodeURIComponent(document)}`;
    const useRelay = transport === 'relay' && cfg.relayPrefix;
    const url = useRelay ? `${cfg.relayPrefix}${encodeURIComponent(target)}` : cfg.endpoint;
    const init = useRelay || cfg.method === 'get'
      ? { method: 'GET', headers: { accept: 'application/json', 'user-agent': cfg.userAgent }, signal: AbortSignal.timeout(cfg.requestTimeoutMs) }
      : {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json', 'user-agent': cfg.userAgent },
        body: JSON.stringify({ query: document }),
        signal: AbortSignal.timeout(cfg.requestTimeoutMs),
      };
    /* R2's anchor is the real send instant, taken here rather than before the request was
       built: pacing from the earlier stamp could put a follow-up a millisecond or two
       under the floor, which is precisely the margin this job exists to protect. */
    lastStartAt = Date.now();
    const res = await fetch(url, init);
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* non-JSON: a challenge page, a proxy error, or a plain-text 405 */
    }
    return { status: res.status, headers: res.headers, text, json };
  }

  /* R10: AniList sends its remaining quota on most responses. When it is low, the correct
     move is to spend what is left slowly, so the spacing temporarily exceeds the learned
     interval until the window resets. Absent headers mean nothing — Number(null) is 0,
     which would otherwise read as "no quota left" and crawl the whole run. */
  function readRateHeaders(res) {
    const rawRemaining = res.headers.get('x-ratelimit-remaining');
    if (rawRemaining === null || rawRemaining === '') return;
    const remaining = Number(rawRemaining);
    if (!Number.isFinite(remaining) || remaining < 0) return;
    if (remaining >= cfg.headerRemainingFloor) { headerFloor = 0; return; }
    const rawReset = res.headers.get('x-ratelimit-reset');
    const reset = rawReset === null || rawReset === '' ? NaN : Number(rawReset);
    const windowMs = Number.isFinite(reset) && reset > Date.now() / 1000
      ? reset * 1000 - Date.now()
      : 60000;
    const spread = Math.min(cfg.headerMaxIntervalMs, Math.ceil(windowMs / Math.max(1, remaining)));
    if (spread > headerFloor) {
      headerFloor = spread;
      stats.header_widens++;
      warn(`rate window low (${remaining} left): spacing widened to ${spread}ms until reset`);
    }
  }

  /* R4: every 403/429 teaches; twenty clean requests in a row let it relax. */
  function widen(reason) {
    const next = clampInterval(learned * cfg.widenFactor);
    if (next !== learned) warn(`${reason}: interval ${learned}ms -> ${next}ms`);
    learned = next;
    successes = 0;
    persist();
  }

  function relaxed() {
    successes++;
    if (successes < cfg.decaySuccesses) return;
    successes = 0;
    const next = clampInterval(learned * cfg.decayFactor);
    if (next !== learned) { learned = next; persist(); warn(`interval relaxed to ${next}ms`); }
  }

  async function request(document) {
    return serialize(async () => {
      for (let attempt = 1; attempt <= cfg.maxAttempts; attempt++) {
        if (Date.now() < cooldownUntil) {
          const wait = cooldownUntil - Date.now();
          warn(`circuit open: cooling down ${Math.ceil(wait / 1000)}s`);
          await sleep(wait);
        }

        /* R7: reserve before the request, so a run that dies mid-request still spent it. */
        if (options.reserve && !(await options.reserve())) {
          stats.budget_denied++;
          throw new BudgetExhausted(`daily AniList budget of ${cfg.dailyBudget} reached`);
        }

        /* R2 + R5: a retry never fires sooner than the current interval. The loop re-checks
           the real clock because a timer can under-fire by a millisecond, and a shortfall
           here is exactly the thing this whole file exists to prevent. */
        let wait = spacing() - (Date.now() - lastStartAt);
        while (wait > 0) {
          await sleep(wait);
          wait = spacing() - (Date.now() - lastStartAt);
        }
        stats.requests++;

        let res;
        try {
          res = await sendOnce(document);
        } catch (err) {
          /* DNS, TLS, timeout: no status to classify. Back off like a 5xx. */
          if (attempt === cfg.maxAttempts) throw new Error(`anilist: no response after ${attempt} attempts (${err.message})`);
          stats.backoffs++;
          const wait = jitter(Math.min(cfg.backoffCapMs, cfg.backoffBaseMs * cfg.backoffFactor ** (attempt - 1)));
          warn(`network fault on attempt ${attempt}: ${err.message}; backing off ${Math.round(wait / 1000)}s`);
          await sleep(Math.max(wait, spacing()));
          continue;
        }

        readRateHeaders(res);

        if (res.status === 429) {
          stats.s429++;
          widen('429');
          if (attempt === cfg.maxAttempts) throw new Error('anilist: still rate limited after all attempts');
          const retryAfter = Number(res.headers.get('retry-after'));
          const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000
            : jitter(Math.min(cfg.backoffCapMs, cfg.backoffBaseMs * cfg.backoffFactor ** (attempt - 1)));
          stats.backoffs++;
          warn(`429 on attempt ${attempt}: waiting ${Math.round(wait / 1000)}s`);
          await sleep(Math.max(wait, spacing()));
          continue;
        }

        if (res.status === 403) {
          stats.s403++;
          const kind = classify403(res.text);
          stats.by403[kind] = (stats.by403[kind] ?? 0) + 1;
          widen('403');
          consecutive403++;
          warn(`403 (${kind}) on attempt ${attempt}${kind === 'blocked' ? ' — AniList has blocked this egress IP; stop and contact them, do not route around it' : ''}`);

          /* R12's fallback is for a transport that cannot POST, not for a block. */
          if (cfg.method === 'auto' && !res.json && cfg.relayPrefix && transport === 'direct' && kind !== 'blocked') {
            transport = 'relay';
            stats.relay_used = true;
            warn('non-JSON 403/405 from POST: switching this run to GET through the configured relay');
            continue;
          }

          if (kind === 'blocked') {
            /* Pointless to retry fast against a manual block; go straight to the breaker. */
            consecutive403 = Math.max(consecutive403, cfg.breakerThreshold);
          }

          if (consecutive403 >= cfg.breakerThreshold) {
            consecutive403 = 0;
            stats.breaker_opens++;
            cooldownUntil = Date.now() + cfg.breakerCooldownMs;
            /* R6: a second opening in one run means the cooldown did not help. */
            if (stats.breaker_opens >= 2) throw new RunAborted(`breaker opened twice; aborting with state saved`);
            warn(`circuit opened after ${cfg.breakerThreshold} consecutive 403s`);
          }

          if (attempt === cfg.maxAttempts) throw new Error(`anilist: 403 (${kind}) on every attempt`);
          stats.backoffs++;
          await sleep(Math.max(jitter(Math.min(cfg.backoffCapMs, cfg.backoffBaseMs * cfg.backoffFactor ** (attempt - 1))), spacing()));
          continue;
        }

        if (res.status === 405 || (res.status >= 400 && !res.json && cfg.method === 'auto')) {
          if (!cfg.relayPrefix || transport === 'relay') {
            throw new Error(`anilist: HTTP ${res.status} ${res.text.slice(0, 180)}`);
          }
          transport = 'relay';
          stats.relay_used = true;
          warn(`HTTP ${res.status} on POST: falling back to GET through the relay for this run`);
          continue;
        }

        if (res.status >= 500) {
          if (attempt === cfg.maxAttempts) throw new Error(`anilist: HTTP ${res.status} on every attempt`);
          widen(`${res.status}`);
          stats.backoffs++;
          await sleep(Math.max(jitter(Math.min(cfg.backoffCapMs, cfg.backoffBaseMs * cfg.backoffFactor ** (attempt - 1))), spacing()));
          continue;
        }

        if (!res.json) throw new Error(`anilist: HTTP ${res.status} returned non-JSON: ${res.text.slice(0, 180)}`);
        if (res.json.errors) {
          const kind = classifyGraphQLError(res.json.errors);
          if (kind === 'transient') {
            /* Same shape as the 5xx branch: widen, back off, retry within the attempt budget. The
               limiter is not bypassed, because sleep() takes the larger of the backoff and the
               current spacing, so a transient storm slows the run rather than hammering it. */
            if (attempt === cfg.maxAttempts) throw new Error(`anilist: transient GraphQL error on every attempt: ${JSON.stringify(res.json.errors).slice(0, 300)}`);
            widen('graphql-transient');
            stats.backoffs++;
            await sleep(Math.max(jitter(Math.min(cfg.backoffCapMs, cfg.backoffBaseMs * cfg.backoffFactor ** (attempt - 1))), spacing()));
            continue;
          }
          if (kind === 'complexity') {
            /* Not worth retrying as-is and not the document's fault: the batch is too large for the
               complexity budget. Throwing a typed error lets mediaByIds halve it. Deliberately not
               counted as a backoff and not widened — the interval is fine, the query is big. */
            throw new QueryTooComplex(`anilist: complexity rejection: ${JSON.stringify(res.json.errors).slice(0, 200)}`);
          }
          /* A malformed document does not become valid on retry, and retrying it spends
             budget and worsens the learned interval for no reason. */
          throw new Error(`anilist: GraphQL error: ${JSON.stringify(res.json.errors).slice(0, 300)}`);
        }
        consecutive403 = 0;
        relaxed();
        return res.json.data;
      }
      throw new Error('anilist: attempt loop exited');
    });
  }

  return {
    cfg: { ...cfg, floor },
    stats,
    get interval() { return learned; },
    get spacing() { return spacing(); },
    get successes() { return successes; },
    /** Force the learned interval, e.g. at run start from D1 state (R4). */
    setInterval(ms) { learned = clampInterval(ms); headerFloor = 0; },
    request,

    /** One page of catalogue ids. Variables are inlined because GET relays cannot carry a
        JSON body, and every value is validated before it reaches the document. */
    async pageIds({ page = 1, perPage = 50, sort = 'POPULARITY_DESC' } = {}) {
      const p = int(page, 'page');
      const n = Math.min(50, int(perPage, 'perPage'));
      if (!SORTS.has(sort)) throw new Error(`anilist: unsupported sort ${sort}`);
      return request(`{ Page(page: ${p}, perPage: ${n}, type: ANIME) { pageInfo{ hasNextPage } media(sort: ${sort}, type: ANIME, isAdult: false) { id } } }`)
        .then((d) => ({ ids: (d?.Page?.media ?? []).map((m) => m.id), hasNextPage: !!d?.Page?.pageInfo?.hasNextPage }));
    },

    /**
     * R3: up to `batchSize` Media lookups aliased into ONE document. This is the main
     * volume reduction — 25 titles cost one request instead of 25.
     */
    async mediaByIds(ids) {
      const out = [];
      const size = Math.max(1, cfg.batchSize);
      /* One aliased document, and if the API says it is too big, ask twice in halves. Each half is
         a normal paced request, so bisecting costs budget rather than throughput — and a single
         title that still cannot be fetched is a real failure, reported as one. */
      const sendIds = async (chunk) => {
        const document = `{ ${chunk.map((id, j) => `m${j}: Media(id: ${id}) { ${FIELDS} }`).join(' ')} }`;
        try {
          const data = await request(document);
          return chunk.map((_, j) => data?.[`m${j}`]).filter(Boolean);
        } catch (err) {
          if (!(err instanceof QueryTooComplex) || chunk.length === 1) throw err;
          stats.bisects++;
          const half = Math.ceil(chunk.length / 2);
          return [...await sendIds(chunk.slice(0, half)), ...await sendIds(chunk.slice(half))];
        }
      };
      for (let i = 0; i < ids.length; i += size) {
        out.push(...await sendIds(ids.slice(i, i + size).map((v) => int(v, 'media id'))));
      }
      return out;
    },
  };
}
