// @ts-check
import { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Newspaper, Rss, ArrowRight, Calendar, Clock, Radio, ExternalLink, Search } from 'lucide-react';
import { NEWS_ARTICLES } from '../data/newsData';
import { resolveAnime } from '../data/animeResolver';
import { AnimeSpotlightCard } from '../components/AnimeSpotlightCard';
import { useSEO } from '../lib/useSEO';
import '../styles/news.css';

const CATEGORIES = ['All', 'Seasonal Guide', 'Rankings', 'Analysis'];
const LIVE_SOURCES = ['All Sources', 'Anime News Network', 'MyAnimeList', 'Crunchyroll News'];

interface LiveNewsItem {
  id: string;
  title: string;
  slug: string;
  source: string;
  sourceUrl: string;
  publishedAt: string;
  timestamp: number;
  category: string;
  imageUrl?: string | null;
  matchedAnime?: {
    title: string;
    slug: string;
    streamUrl: string;
    art?: string | null;
    rating?: number | null;
    genres?: string[];
  } | null;
  editorialSummary: string;
  wordCount: number;
}

export function News() {
  const [activeTab, setActiveTab] = useState<'editorial' | 'live'>('editorial');
  const [selectedCat, setSelectedCat] = useState('All');
  const [selectedSource, setSelectedSource] = useState('All Sources');
  const [searchQuery, setSearchQuery] = useState('');
  const [liveNews, setLiveNews] = useState<LiveNewsItem[]>([]);
  const [liveLoading, setLiveLoading] = useState(false);

  useSEO({
    title: 'Anime News, Guides & Episode Schedules | AniHubStream',
    description: 'Explore the latest anime news, seasonal schedule breakdowns, top 10 rankings, and deep-dive analysis on AniHubStream.',
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: 'AniHubStream Anime News & Editorial',
      url: 'https://anihubstream.com/news',
      description: 'Explore the latest anime news, seasonal guides, and rankings.',
    },
  });

  useEffect(() => {
    if (activeTab === 'live' && liveNews.length === 0) {
      setLiveLoading(true);
      fetch('/api/news.json')
        .then((res) => (res.ok ? res.json() : []))
        .then((data) => {
          if (Array.isArray(data)) setLiveNews(data);
        })
        .catch(() => {})
        .finally(() => setLiveLoading(false));
    }
  }, [activeTab, liveNews.length]);

  const filteredEditorial = selectedCat === 'All'
    ? NEWS_ARTICLES
    : NEWS_ARTICLES.filter((a) => a.category === selectedCat);

  const featured = NEWS_ARTICLES[0];

  const filteredLiveNews = useMemo(() => {
    return liveNews.filter((item) => {
      const matchesSource = selectedSource === 'All Sources' || item.source.toLowerCase().includes(selectedSource.toLowerCase().replace(' news', ''));
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch = !q ||
        item.title.toLowerCase().includes(q) ||
        (item.matchedAnime && item.matchedAnime.title.toLowerCase().includes(q)) ||
        item.editorialSummary.toLowerCase().includes(q);
      return matchesSource && matchesSearch;
    });
  }, [liveNews, selectedSource, searchQuery]);

  return (
    <div className="page news-page shell">
      <header className="page-head" style={{ marginBottom: 28, paddingTop: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 14 }}>
          <div>
            <h1 style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 'clamp(1.8rem, 3vw, 2.4rem)', margin: 0 }}>
              <Newspaper size={32} style={{ color: 'var(--crimson)' }} aria-hidden="true" />
              Anime News &amp; Editorial Hub
            </h1>
            <p style={{ color: 'rgba(255,255,255,0.65)', marginTop: 8, fontSize: '0.95rem' }}>
              Original seasonal guides, episode breakdowns, rankings, and real-time curated industry updates.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <a
              href="/sitemap-news.xml"
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn--sm btn--ghost"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              News Sitemap
            </a>
            <a
              href="/rss.xml"
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn--sm btn--ghost"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
            >
              <Rss size={16} style={{ color: 'var(--orange)' }} />
              RSS Feed
            </a>
          </div>
        </div>

        {/* Tab Switcher: Curated vs Live Wire */}
        <div style={{ display: 'flex', gap: 12, marginTop: 20, borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: 12 }}>
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => setActiveTab('editorial')}
            style={{
              background: activeTab === 'editorial' ? 'var(--crimson)' : 'rgba(255,255,255,0.06)',
              color: '#fff',
              fontWeight: 700,
            }}
          >
            Curated Editorial Guides
          </button>
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => setActiveTab('live')}
            style={{
              background: activeTab === 'live' ? 'var(--blue)' : 'rgba(255,255,255,0.06)',
              color: '#fff',
              fontWeight: 700,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <Radio size={15} style={{ color: activeTab === 'live' ? '#fff' : 'var(--cyan)' }} />
            Trending Live Wire ({liveNews.length > 0 ? liveNews.length : 'Live'})
          </button>
        </div>

        {/* Category / Source Controls */}
        {activeTab === 'editorial' ? (
          <div style={{ display: 'flex', gap: 8, marginTop: 18, flexWrap: 'wrap' }}>
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                type="button"
                className={`pill ${selectedCat === cat ? 'pill--active' : ''}`}
                onClick={() => setSelectedCat(cat)}
                style={{
                  cursor: 'pointer',
                  background: selectedCat === cat ? 'var(--crimson)' : 'rgba(255,255,255,0.06)',
                  color: '#fff',
                  border: '1px solid rgba(255,255,255,0.1)',
                  padding: '6px 14px',
                  borderRadius: 'var(--r-pill)',
                  fontSize: '0.84rem',
                  fontWeight: 600,
                }}
              >
                {cat}
              </button>
            ))}
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 12, marginTop: 18, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {LIVE_SOURCES.map((source) => (
                <button
                  key={source}
                  type="button"
                  className={`pill ${selectedSource === source ? 'pill--active' : ''}`}
                  onClick={() => setSelectedSource(source)}
                  style={{
                    cursor: 'pointer',
                    background: selectedSource === source ? 'var(--blue)' : 'rgba(255,255,255,0.06)',
                    color: '#fff',
                    border: '1px solid rgba(255,255,255,0.1)',
                    padding: '5px 12px',
                    borderRadius: 'var(--r-pill)',
                    fontSize: '0.82rem',
                    fontWeight: 600,
                  }}
                >
                  {source}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,0.06)', borderRadius: 'var(--r-pill)', padding: '4px 12px', border: '1px solid rgba(255,255,255,0.1)' }}>
              <Search size={14} style={{ color: 'rgba(255,255,255,0.5)' }} />
              <input
                type="text"
                placeholder="Search news or anime..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: '0.82rem', outline: 'none', width: 160 }}
              />
            </div>
          </div>
        )}
      </header>

      {/* EDITORIAL GUIDES TAB */}
      {activeTab === 'editorial' && (
        <>
          {selectedCat === 'All' && featured && (
            <section className="featured-news-hero" style={{ marginBottom: 36 }}>
              <div
                style={{
                  position: 'relative',
                  borderRadius: 'var(--r-lg)',
                  overflow: 'hidden',
                  background: 'linear-gradient(180deg, rgba(20,24,38,0.85) 0%, rgba(10,12,18,0.98) 100%)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  display: 'grid',
                  gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 1fr)',
                  gap: 24,
                  boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
                }}
              >
                <Link to={`/news/${featured.slug}`} style={{ display: 'block', minHeight: 280, position: 'relative' }}>
                  <img
                    src={featured.coverImage}
                    alt={featured.title}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                  <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, transparent 40%, rgba(10,12,18,0.8) 100%)' }} />
                </Link>
                <div style={{ padding: '24px 24px 24px 0', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                    <span className="pill pill--sm" style={{ background: 'var(--crimson)', color: '#fff', fontWeight: 800 }}>
                      FEATURED
                    </span>
                    <span style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.5)' }}>
                      <Calendar size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                      {featured.date}
                    </span>
                    <span style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.5)' }}>
                      <Clock size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                      {featured.readTime}
                    </span>
                  </div>
                  <h2 style={{ fontSize: 'clamp(1.4rem, 2.5vw, 1.8rem)', fontWeight: 800, margin: '0 0 12px 0', lineHeight: 1.3 }}>
                    <Link to={`/news/${featured.slug}`} style={{ color: '#fff', textDecoration: 'none' }}>
                      {featured.title}
                    </Link>
                  </h2>
                  <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.92rem', lineHeight: 1.6, margin: '0 0 16px 0' }}>
                    {featured.excerpt}
                  </p>

                  {/* Picture Logic: Featured Mentioned Anime Chips */}
                  {featured.relatedAnimeSlugs && featured.relatedAnimeSlugs.length > 0 && (
                    <div style={{ marginBottom: 18 }}>
                      <div style={{ fontSize: '0.74rem', color: 'rgba(255,255,255,0.5)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 700 }}>
                        Featured Series in this Guide:
                      </div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {featured.relatedAnimeSlugs.map((slug) => {
                          const resolved = resolveAnime(slug);
                          if (!resolved) return null;
                          return (
                            <AnimeSpotlightCard
                              key={slug}
                              anime={resolved}
                              variant="compact-chip"
                            />
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div>
                    <Link
                      to={`/news/${featured.slug}`}
                      className="btn btn--sm btn--primary"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 700 }}
                    >
                      Read Complete Guide <ArrowRight size={15} />
                    </Link>
                  </div>
                </div>
              </div>
            </section>
          )}

          <div className="news-grid">
            {filteredEditorial.map((article) => {
              const matchedEntities = (article.relatedAnimeSlugs || [])
                .map((slug) => resolveAnime(slug))
                .filter((a): a is NonNullable<typeof a> => Boolean(a));

              return (
                <article key={article.slug} className="news-card">
                  <Link to={`/news/${article.slug}`} className="news-card__thumb-link">
                    <img
                      src={article.coverImage}
                      alt={article.title}
                      className="news-card__thumb"
                      loading="lazy"
                      decoding="async"
                    />
                    <span className="news-card__category">{article.category}</span>
                  </Link>

                  <div className="news-card__body">
                    <div className="news-card__meta">
                      <span className="news-card__date">
                        <Calendar size={13} aria-hidden="true" />
                        {article.date}
                      </span>
                      <span className="news-card__read">
                        <Clock size={13} aria-hidden="true" />
                        {article.readTime}
                      </span>
                    </div>

                    <h3 className="news-card__title">
                      <Link to={`/news/${article.slug}`}>{article.title}</Link>
                    </h3>

                    <p className="news-card__excerpt">{article.excerpt}</p>

                    {/* Picture Logic with Name of Anime in News Cards */}
                    {matchedEntities.length > 0 && (
                      <div style={{ margin: '10px 0 14px 0', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {matchedEntities.slice(0, 2).map((anime) => (
                          <AnimeSpotlightCard
                            key={anime.slug}
                            anime={anime}
                            variant="compact-chip"
                          />
                        ))}
                      </div>
                    )}

                    <div className="news-card__footer">
                      <Link to={`/news/${article.slug}`} className="news-card__read-link">
                        Read Full Guide <ArrowRight size={14} aria-hidden="true" />
                      </Link>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </>
      )}

      {/* TRENDING LIVE WIRE TAB (Auto-Enriched News with Anime Picture Logic) */}
      {activeTab === 'live' && (
        <section className="live-wire-section">
          {liveLoading ? (
            <div style={{ padding: '60px 0', textAlign: 'center', color: 'rgba(255,255,255,0.6)' }}>
              Loading real-time curated anime news wire...
            </div>
          ) : filteredLiveNews.length === 0 ? (
            <div style={{ padding: '40px 0', textAlign: 'center', color: 'rgba(255,255,255,0.6)' }}>
              No recent news items match your criteria.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              {filteredLiveNews.map((item) => {
                const resolvedAnime = item.matchedAnime ? resolveAnime(item.matchedAnime.slug) || {
                  slug: item.matchedAnime.slug,
                  title: item.matchedAnime.title,
                  art: item.matchedAnime.art || item.imageUrl || '/art/poster-shadow-hunter.jpg',
                  fallbackArt: '/art/poster-shadow-hunter.jpg',
                  rating: item.matchedAnime.rating || 8.2,
                  format: 'TV Series',
                  status: 'Air Broadcast',
                  genres: item.matchedAnime.genres || ['Action', 'Fantasy'],
                  streamUrl: item.matchedAnime.streamUrl,
                } : null;

                const displayImage = item.imageUrl || resolvedAnime?.art || null;

                return (
                  <article
                    key={item.id}
                    style={{
                      background: 'linear-gradient(135deg, rgba(20,24,36,0.85) 0%, rgba(11,13,20,0.95) 100%)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: 'var(--r-md)',
                      padding: 22,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 16,
                      boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                    }}
                  >
                    {/* Header: Source, Date, Category */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span className="pill pill--sm" style={{ background: 'rgba(36,211,238,0.15)', color: 'var(--cyan)', border: '1px solid rgba(36,211,238,0.3)', fontWeight: 700 }}>
                          {item.source}
                        </span>
                        <span className="pill pill--sm" style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.8)', border: '1px solid rgba(255,255,255,0.1)' }}>
                          {item.category}
                        </span>
                        <span style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.5)' }}>
                          <Calendar size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                          {new Date(item.publishedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                        </span>
                      </div>

                      {resolvedAnime && (
                        <AnimeSpotlightCard
                          anime={resolvedAnime}
                          variant="compact-chip"
                        />
                      )}
                    </div>

                    {/* Main Content Layout with Picture Logic */}
                    <div style={{ display: 'grid', gridTemplateColumns: displayImage ? '180px 1fr' : '1fr', gap: 20, alignItems: 'start' }}>
                      {displayImage && (
                        <div style={{ position: 'relative', borderRadius: 'var(--r-md)', overflow: 'hidden', aspectRatio: '16/10', border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 6px 16px rgba(0,0,0,0.4)' }}>
                          <img
                            src={displayImage}
                            alt={item.title}
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            loading="lazy"
                            decoding="async"
                          />
                        </div>
                      )}

                      <div>
                        <h3 style={{ fontSize: '1.24rem', fontWeight: 800, margin: '0 0 10px 0', color: '#fff', lineHeight: 1.4 }}>
                          {item.title}
                        </h3>

                        <p style={{ color: 'rgba(255,255,255,0.82)', fontSize: '0.94rem', lineHeight: 1.7, margin: 0 }}>
                          {item.editorialSummary}
                        </p>
                      </div>
                    </div>

                    {/* If Anime is matched: Show Featured Anime Picture Logic Widget */}
                    {resolvedAnime && (
                      <AnimeSpotlightCard
                        anime={resolvedAnime}
                        variant="live-badge"
                      />
                    )}

                    {/* Card Footer: Word Count + Original External Citation */}
                    <div style={{ marginTop: 4, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
                      <span style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.45)' }}>
                        Original Editorial Analysis &bull; {item.wordCount} words
                      </span>
                      <a
                        href={item.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ fontSize: '0.82rem', color: 'var(--cyan)', display: 'inline-flex', alignItems: 'center', gap: 5, textDecoration: 'none' }}
                      >
                        Source Verification ({item.source}) <ExternalLink size={13} />
                      </a>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
