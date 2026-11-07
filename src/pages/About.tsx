import { useSEO } from '../lib/useSEO';
import { HelpCircle, Shield, Sparkles, Zap } from 'lucide-react';
import '../styles/pages.css';

export function About() {
  useSEO({
    title: 'About AniHubStream — Free Cinematic Anime Streaming',
    description: 'Learn about AniHubStream, our mission, high-performance streaming technology, and community attribution.',
    jsonLd: {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'AboutPage',
          name: 'About AniHubStream',
          description: 'Learn about AniHubStream, our mission, catalog data sources (Kitsu, AniList), and high-performance streaming architecture.',
        },
        {
          '@type': 'FAQPage',
          mainEntity: [
            {
              '@type': 'Question',
              name: 'What is AniHubStream?',
              acceptedAnswer: {
                '@type': 'Answer',
                text: 'AniHubStream is a free, high-speed anime streaming platform providing subbed and dubbed anime with fast playback, weekly airing schedules, and full episode guides.',
              },
            },
            {
              '@type': 'Question',
              name: 'Is AniHubStream free to use?',
              acceptedAnswer: {
                '@type': 'Answer',
                text: 'Yes, AniHubStream is completely free with no registration, subscription, or paywalls required.',
              },
            },
            {
              '@type': 'Question',
              name: 'Does AniHubStream support subbed and dubbed anime?',
              acceptedAnswer: {
                '@type': 'Answer',
                text: 'Yes, AniHubStream supports original Japanese audio with multi-language subtitles as well as English and regional dubbed audio streams.',
              },
            },
            {
              '@type': 'Question',
              name: 'Where does AniHubStream source its anime metadata?',
              acceptedAnswer: {
                '@type': 'Answer',
                text: 'All series information, episode synopses, and broadcast schedules are verified and synchronized from AniList, Kitsu, and MyAnimeList.',
              },
            },
            {
              '@type': 'Question',
              name: 'Does AniHubStream support auto-skipping openings and endings?',
              acceptedAnswer: {
                '@type': 'Answer',
                text: 'Yes, AniHubStream integrates AniSkip community timestamps to automatically skip intros and outros.',
              },
            },
          ],
        },
      ],
    },
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
            AniHubStream is powered by ultra-low-latency global edge streaming with multi-server redundancy. Trending rankings, release schedules, and video sources update in real time
            to deliver the smoothest streaming experience across all devices.
          </p>
        </section>

        <section>
          <h2><Shield size={20} className="inline-icon" /> Community Attribution &amp; Rights</h2>
          <p>
            AniHubStream features community-contributed episode skip markers. All anime titles, artwork, posters,
            and promotional media belong to their respective creators, production committees, and copyright holders.
          </p>
        </section>

        <section>
          <h2><HelpCircle size={20} className="inline-icon" /> Frequently Asked Questions</h2>
          <div className="about-faq">
            <h3>What is AniHubStream?</h3>
            <p>
              AniHubStream is a free, high-speed anime streaming platform providing subbed and dubbed anime with fast playback, weekly airing schedules, and full episode guides.
            </p>

            <h3>Is AniHubStream free to use?</h3>
            <p>
              Yes, AniHubStream is completely free with no registration, subscription, or paywalls required.
            </p>

            <h3>Does AniHubStream support subbed and dubbed anime?</h3>
            <p>
              Yes, AniHubStream supports original Japanese audio with multi-language subtitles as well as English and regional dubbed audio streams.
            </p>

            <h3>Where does AniHubStream source its anime metadata?</h3>
            <p>
              All series information, episode synopses, and broadcast schedules are verified and synchronized from AniList, Kitsu, and MyAnimeList.
            </p>

            <h3>Does AniHubStream support auto-skipping openings and endings?</h3>
            <p>
              Yes, AniHubStream integrates AniSkip community timestamps to automatically skip intros and outros.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
