// @ts-check

export async function probeTrendingStreams({ limit = 20, baseUrl = 'http://127.0.0.1:8899', silent = false } = {}) {
  let homeData;
  try {
    const homeRes = await fetch(`${baseUrl}/api/home?bypass=1`, {
      signal: AbortSignal.timeout(6000),
    });
    homeData = await homeRes.json();
  } catch (err) {
    if (!silent) console.warn('[Stream Probe] Could not reach home API:', err.message);
    return { ok: false, error: err.message, results: [], providerStats: {} };
  }

  const allTrending = homeData.trending || [];
  const trending = allTrending.slice(0, limit);

  if (!silent) {
    console.log(`Probing stream availability for top ${trending.length} trending anime...\n`);
  }

  const results = [];
  let streamableCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  const providerStats = {
    anikoto: { status: 'healthy', latencyMs: 85, successCount: 0, totalCount: 0 },
    hianime: { status: 'healthy', latencyMs: 140, successCount: 0, totalCount: 0 },
    aniwatch: { status: 'healthy', latencyMs: 210, successCount: 0, totalCount: 0 },
  };

  for (let i = 0; i < trending.length; i++) {
    const anime = trending[i];
    if (anime.status === 'Upcoming' || anime.status === 'NOT_YET_RELEASED' || anime.episodeCount === 0) {
      if (!silent) {
        console.log(`[${i + 1}/${trending.length}] ⏳ ${anime.title} (${anime.id}) - SKIPPED (Unreleased / 0 episodes)`);
      }
      skippedCount++;
      results.push({ id: anime.id, title: anime.title, status: 'skipped', streamOk: true });
      continue;
    }

    const startMs = Date.now();
    try {
      const playRes = await fetch(`${baseUrl}/api/play?id=${encodeURIComponent(anime.id)}&ep=1`, {
        signal: AbortSignal.timeout(10000),
      });
      const elapsed = Date.now() - startMs;
      const playData = await playRes.json();

      const readyServers = playData.servers?.filter((s) => s.status === 'ready' && s.streamUrl) || [];
      const hasStream = readyServers.length > 0;

      if (hasStream) {
        streamableCount++;
        const serverName = readyServers[0].name || '';
        const detectedProvider = (readyServers[0].provider || (serverName.toLowerCase().includes('hianime') ? 'hianime' : serverName.toLowerCase().includes('aniwatch') ? 'aniwatch' : 'anikoto')).toLowerCase();

        if (providerStats[detectedProvider]) {
          providerStats[detectedProvider].successCount++;
          providerStats[detectedProvider].totalCount++;
          providerStats[detectedProvider].latencyMs = Math.round(
            (providerStats[detectedProvider].latencyMs + elapsed) / 2
          );
        }

        results.push({
          id: anime.id,
          title: anime.title,
          status: 'ok',
          streamOk: true,
          server: readyServers[0].name,
          latencyMs: elapsed,
        });
        if (!silent) {
          console.log(`[${i + 1}/${trending.length}] ✅ ${anime.title} (${anime.id}) - Stream OK in ${elapsed}ms (${readyServers[0].name}: ${readyServers[0].streamUrl.slice(0, 50)}...)`);
        }
      } else {
        failedCount++;
        results.push({
          id: anime.id,
          title: anime.title,
          status: 'no_stream',
          streamOk: false,
          error: playData.error || 'no ready servers',
        });
        if (!silent) {
          console.log(`[${i + 1}/${trending.length}] ⚠️ ${anime.title} (${anime.id}) - 0 ready streams:`, playData.error || 'no ready stream');
        }
      }
    } catch (err) {
      failedCount++;
      results.push({
        id: anime.id,
        title: anime.title,
        status: 'error',
        streamOk: false,
        error: err.message,
      });
      if (!silent) {
        console.log(`[${i + 1}/${trending.length}] ❌ ${anime.title} (${anime.id}) - Error: ${err.message}`);
      }
    }
  }

  // Calculate status for each provider
  for (const [key, stat] of Object.entries(providerStats)) {
    if (stat.totalCount > 0 && stat.successCount === 0) {
      stat.status = 'degraded';
    } else {
      stat.status = 'healthy';
    }
  }

  return {
    ok: failedCount === 0,
    timestamp: new Date().toISOString(),
    checkedCount: trending.length,
    streamableCount,
    skippedCount,
    failedCount,
    providerStats,
    results,
  };
}

if (process.argv[1] && process.argv[1].endsWith('probe-trending-streams.mjs')) {
  probeTrendingStreams().catch(console.error);
}
