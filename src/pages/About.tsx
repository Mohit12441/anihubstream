import { useSEO } from '../lib/useSEO';
import { Shield, Sparkles, Zap } from 'lucide-react';
import '../styles/pages.css';

export function About() {
  useSEO({
    title: 'About AniHubStream — Free Cinematic Anime Streaming',
    description: 'Learn about AniHubStream, our mission, high-performance edge architecture, and community data sources.',
  });

  return (
    <div className="shell page-block">
      <header className="page-header">
        <h1 className="page-title">About AniHubStream</h1>
        <p className="page-sub">Next-generation cinematic anime exploration platform.</p>
      </header>

      <div className="prose">
        <section>
          <h2><Sparkles size={20} className="inline-icon" /> Our Mission</h2>
          <p>
            AniHubStream was built to provide anime fans with a lightning-fast, ad-free, cinematic streaming interface.
            Every title, poster, episode summary, and broadcast schedule is indexed into a distributed database to ensure
            instant search and zero lag while you browse.
          </p>
        </section>

        <section>
          <h2><Zap size={20} className="inline-icon" /> Autonomous Edge Architecture</h2>
          <p>
            Unlike legacy sites that depend on slow web-scraping backends, AniHubStream runs entirely on Cloudflare's
            global edge network and Cloudflare D1 SQLite storage. Title syncs, trending rank adjustments, and airing
            times update automatically in the cloud every 30 minutes with zero human intervention.
          </p>
        </section>

        <section>
          <h2><Shield size={20} className="inline-icon" /> Data & Attribution</h2>
          <p>
            AniHubStream aggregates rich metadata from the Kitsu and AniList community databases, and episode intro/outro
            skip markers from AniSkip. Artwork and promotional media belong to their respective creators and production committees.
          </p>
        </section>
      </div>
    </div>
  );
}
