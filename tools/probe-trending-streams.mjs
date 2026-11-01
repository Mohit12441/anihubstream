async function probeTrendingStreams() {
  const homeRes = await fetch('http://127.0.0.1:8899/api/home?bypass=1');
  const homeData = await homeRes.json();
  const trending = homeData.trending || [];

  console.log(`Probing stream availability for top ${trending.length} trending anime...\n`);

  for (let i = 0; i < trending.length; i++) {
    const anime = trending[i];
    if (anime.status === 'Upcoming' || anime.status === 'NOT_YET_RELEASED' || anime.episodeCount === 0) {
      console.log(`[${i + 1}/${trending.length}] ⏳ ${anime.title} (${anime.id}) - SKIPPED (Unreleased / 0 episodes)`);
      continue;
    }

    try {
      const playRes = await fetch(`http://127.0.0.1:8899/api/play?id=${anime.id}&ep=1`);
      const playData = await playRes.json();
      
      const serverCount = playData.servers?.length || 0;
      const readyServers = playData.servers?.filter(s => s.status === 'ready' && s.streamUrl) || [];
      const hasStream = readyServers.length > 0;
      
      if (hasStream) {
        console.log(`[${i + 1}/${trending.length}] ✅ ${anime.title} (${anime.id}) - Stream OK (${readyServers[0].name}: ${readyServers[0].streamUrl.slice(0, 50)}...)`);
      } else {
        console.log(`[${i + 1}/${trending.length}] ⚠️ ${anime.title} (${anime.id}) - ${serverCount} servers found, 0 ready streams:`, playData.error || 'no ready stream');
      }
    } catch (err) {
      console.log(`[${i + 1}/${trending.length}] ❌ ${anime.title} (${anime.id}) - Error: ${err.message}`);
    }
  }
}

probeTrendingStreams().catch(console.error);
