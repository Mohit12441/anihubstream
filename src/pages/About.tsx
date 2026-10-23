import { useSEO } from '../lib/useSEO';
import { Shield, Sparkles, Zap } from 'lucide-react';
import '../styles/pages.css';

export function About() {
  useSEO({
    title: 'About AniHubStream — Free Cinematic Anime Streaming',
    description: 'Learn about AniHubStream, our mission, high-performance streaming technology, and community attribution.',
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
            Every title, poster, episode summary, and broadcast schedule is curated to ensure instant search, clean navigation,
            and zero buffering while you stream.
          </p>
        </section>

        <section>
          <h2><Zap size={20} className="inline-icon" /> Next-Generation Streaming Technology</h2>
          <p>
            AniHubStream is powered by ultra-low-latency global edge streaming with multi-server redundancy across
            AniKoto, HiAnime, and AniWatch. Trending rankings, release schedules, and video sources update in real time
            to deliver the smoothest streaming experience across all devices.
          </p>
        </section>

        <section>
          <h2><Shield size={20} className="inline-icon" /> Community Attribution & Rights</h2>
          <p>
            AniHubStream features community-contributed episode skip markers. All anime titles, artwork, posters,
            and promotional media belong to their respective creators, production committees, and copyright holders.
          </p>
        </section>
      </div>
    </div>
  );
}
