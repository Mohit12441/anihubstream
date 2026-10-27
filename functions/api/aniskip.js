// @ts-check
import { HttpError, errorResponse, json } from './_lib.js';

const ANISKIP_BASE = 'https://api.aniskip.com/v2';
const TIMEOUT_MS = 6000;

/**
 * Edge proxy for AniSkip v2 API with Cloudflare edge caching,
 * relation rules remapping, and negative caching to shield upstream.
 */
export const onRequestGet = async ({ request, env }) => {
  try {
    const url = new URL(request.url);

    // Support relation rules query or path: /api/aniskip/relation-rules/:malId
    const rulePathMatch = url.pathname.match(/\/relation-rules\/(\d+)/);
    if (rulePathMatch || url.searchParams.has('relationRules')) {
      const relMalId = Number.parseInt(rulePathMatch ? rulePathMatch[1] : url.searchParams.get('relationRules') || '0', 10);
      if (!Number.isInteger(relMalId) || relMalId <= 0) {
        throw new HttpError(400, 'bad_request', 'malId must be a positive integer');
      }
      try {
        const ruleRes = await fetch(`${ANISKIP_BASE}/relation-rules/${encodeURIComponent(relMalId)}`, {
          headers: { accept: 'application/json' },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (ruleRes.ok) {
          const ruleData = await ruleRes.json().catch(() => null);
          return json(ruleData || { statusCode: 200, message: 'Rules found', found: false, rules: [] }, { status: 200, cache: 'public, max-age=86400' });
        }
        return json({ statusCode: 404, message: 'Not found', found: false, rules: [] }, { status: 200, cache: 'public, max-age=3600' });
      } catch {
        return json({ statusCode: 502, message: 'Upstream error', found: false, rules: [] }, { status: 200, cache: 'public, max-age=300' });
      }
    }

    let malIdRaw = url.searchParams.get('malId') ?? '';
    let epRaw = url.searchParams.get('ep') ?? '1';
    let durationRaw = url.searchParams.get('duration') ?? url.searchParams.get('episodeLength') ?? '0';

    // Support path-based format: /api/aniskip/skip-times/:malId/:ep
    const skipPathMatch = url.pathname.match(/\/skip-times\/(\d+)\/(\d+)/);
    if (skipPathMatch) {
      malIdRaw = skipPathMatch[1];
      epRaw = skipPathMatch[2];
    }

    const malId = Number.parseInt(malIdRaw, 10);
    const ep = Number.parseInt(epRaw, 10);
    const duration = Number.parseFloat(durationRaw) || 0;

    if (!Number.isInteger(malId) || malId <= 0) {
      throw new HttpError(400, 'bad_request', 'malId must be a positive integer');
    }
    if (!Number.isInteger(ep) || ep <= 0) {
      throw new HttpError(400, 'bad_request', 'ep must be a positive integer');
    }

    let targetMalId = malId;
    let targetEp = ep;

    // Check relation rules for franchise episode remapping
    try {
      const ruleRes = await fetch(`${ANISKIP_BASE}/relation-rules/${encodeURIComponent(malId)}`, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (ruleRes.ok) {
        const ruleData = await ruleRes.json().catch(() => null);
        if (ruleData?.found && Array.isArray(ruleData.rules)) {
          for (const rule of ruleData.rules) {
            const fromStart = Number(rule.from?.start ?? 1);
            const fromEnd = rule.from?.end !== undefined ? Number(rule.from.end) : Number.POSITIVE_INFINITY;
            if (ep >= fromStart && ep <= fromEnd) {
              const toMalId = Number(rule.to?.malId);
              const toStart = Number(rule.to?.start ?? 1);
              if (Number.isInteger(toMalId) && toMalId > 0) {
                targetMalId = toMalId;
                targetEp = toStart + (ep - fromStart);
                break;
              }
            }
          }
        }
      }
    } catch {
      // Proceed with original malId and episode
    }

    // Query AniSkip skip times
    const queryUrl = new URL(`${ANISKIP_BASE}/skip-times/${encodeURIComponent(targetMalId)}/${encodeURIComponent(targetEp)}`);
    queryUrl.searchParams.append('types[]', 'op');
    queryUrl.searchParams.append('types[]', 'ed');
    queryUrl.searchParams.append('types[]', 'mixed-op');
    queryUrl.searchParams.append('types[]', 'mixed-ed');
    queryUrl.searchParams.append('types[]', 'recap');
    queryUrl.searchParams.set('episodeLength', String(duration > 0 ? duration : 0));

    let res;
    try {
      res = await fetch(queryUrl.toString(), {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      return json({ found: false, message: 'upstream_timeout', results: [] }, { status: 200, cache: 'public, max-age=300' });
    }

    if (!res.ok) {
      const status = res.status;
      if (status === 404) {
        return json(
          { found: false, message: 'not_found', malId: targetMalId, episode: targetEp, results: [] },
          { status: 200, cache: 'public, max-age=3600' }
        );
      }
      return json(
        { found: false, message: `upstream_${status}`, results: [] },
        { status: 200, cache: 'public, max-age=300' }
      );
    }

    const data = await res.json().catch(() => null);
    if (!data || !data.found || !Array.isArray(data.results)) {
      return json(
        { found: false, message: 'no_results', malId: targetMalId, episode: targetEp, results: [] },
        { status: 200, cache: 'public, max-age=3600' }
      );
    }

    // Standardize opening and ending intervals
    let op = null;
    let ed = null;
    let recap = null;

    for (const r of data.results) {
      const type = r.skipType;
      const interval = r.interval;
      if (!interval || typeof interval.startTime !== 'number' || typeof interval.endTime !== 'number') continue;
      const formatted = {
        start: interval.startTime,
        end: interval.endTime,
        label: type === 'recap' ? 'Recap' : type.includes('op') ? 'Opening' : 'Ending',
      };
      if (type === 'op' || type === 'mixed-op') op ??= formatted;
      else if (type === 'ed' || type === 'mixed-ed') ed ??= formatted;
      else if (type === 'recap') recap ??= formatted;
    }

    // Edge Write-Through: Persist discovered skip markers into episode.markers in D1
    const markers = [];
    if (op) markers.push({ kind: 'intro', start: Math.round(op.start), end: Math.round(op.end), label: op.label });
    if (ed) markers.push({ kind: 'outro', start: Math.round(ed.start), end: Math.round(ed.end), label: ed.label });
    if (recap) markers.push({ kind: 'recap', start: Math.round(recap.start), end: Math.round(recap.end), label: recap.label });

    if (env?.ANIHUB && markers.length > 0) {
      try {
        const animeRow = await env.ANIHUB.prepare(
          `SELECT a.id FROM anime a
           LEFT JOIN anime_id_map m ON m.anime_id = a.id
           WHERE m.mal_id = ?1 OR json_extract(a.source_ids, '$.mal') = ?1
           LIMIT 1`,
        ).bind(targetMalId).first().catch(() => null);

        if (animeRow?.id) {
          const epId = `${animeRow.id}:${targetEp}`;
          await env.ANIHUB.prepare(
            `UPDATE episode SET markers = ?1
             WHERE (id = ?2 OR (anime_id = ?3 AND n = ?4))
               AND (markers IS NULL OR markers = '[]')`,
          ).bind(JSON.stringify(markers), epId, animeRow.id, targetEp).run().catch(() => {});
        }
      } catch {
        // Non-blocking write-through
      }
    }

    return json(
      {
        found: true,
        malId: targetMalId,
        episode: targetEp,
        results: data.results,
        op,
        ed,
        recap,
      },
      {
        status: 200,
        cache: 'public, max-age=86400, s-maxage=86400',
      }
    );
  } catch (err) {
    return errorResponse(err);
  }
};
