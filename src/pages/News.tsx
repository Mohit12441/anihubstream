// @ts-check
import { useEffect, useState, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Newspaper, Rss, ArrowRight, Calendar, Clock, Radio, ExternalLink, Search, ChevronLeft, ChevronRight, User } from 'lucide-react';
import { NEWS_ARTICLES } from '../data/newsData';
import { resolveAnime } from '../data/animeResolver';
import { AnimeSpotlightCard } from '../components/AnimeSpotlightCard';
import { useSEO } from '../lib/useSEO';
import INITIAL_LIVE_NEWS from '../../data/news/feed.json';
import '../styles/news.css';

const CATEGORIES = ['All', 'Seasonal Guide', 'Rankings', 'Analysis'];
const LIVE_SOURCES = ['All Sources', 'Anime Corner', 'Anime News Network', 'MyAnimeList', 'Crunchyroll News'];

interface LiveNewsItem {
  id: string;
  title: string;
  originalTitle?: string;
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

function formatTimeAgo(timestamp: number): string {
  const diffMinutes = Math.floor((Date.now() - timestamp) / 60000);
  if (diffMinutes < 60) return `${Math.max(1, diffMinutes)}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

function getAuthorForSource(source: string): { name: string; role: string } {
  switch (source) {
    case 'Anime News Network':
      return { name: 'Kenji Sato', role: 'Senior Anime Journalist' };
    case 'Anime Corner':
      return { name: 'Elena Rostova', role: 'Anime Industry Correspondent' };
    case 'Crunchyroll News':
      return { name: 'Marcus Vance', role: 'Broadcast Syndication Analyst' };
    case 'MyAnimeList':
      return { name: 'Daiki Tanaka', role: 'Franchise Data Specialist' };
    default:
      return { name: 'AniHub Editorial Desk', role: 'Anime News Curator' };
  }
}

const PAGE_SIZE = 12;

export function News() {
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<'live' | 'editorial'>('live');
  const [selectedCat, setSelectedCat] = useState('All');
  const [selectedSource, setSelectedSource] = useState('All Sources');
  const [searchQuery, setSearchQuery] = useState('');
  const [liveNews, setLiveNews] = useState<LiveNewsItem[]>(INITIAL_LIVE_NEWS as unknown as LiveNewsItem[]);
  const [liveLoading, setLiveLoading] = useState(false);

  const currentPage = Math.max(1, parseInt(searchParams.get('page') || '1', 10));

  useSEO({
    title: 'Anime News, Industry Announcements & Broadcast Schedules | AniHubStream',
    description: 'Track breaking anime news, studio production updates, release dates, staff and voice cast reveals, and seasonal broadcast schedules on AniHubStream.',
    canonicalUrl: currentPage > 1 ? `https://anihubstream.com/news?page=${currentPage}` : 'https://anihubstream.com/news',
    jsonLd: {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'CollectionPage',
          name: 'AniHubStream Anime News & Editorial Hub',
          url: currentPage > 1 ? `https://anihubstream.com/news?page=${currentPage}` : 'https://anihubstream.com/news',
          description: 'Track breaking anime news, studio production updates, release dates, and seasonal schedules.',
        },
        {
          '@type': 'ItemList',
          itemListElement: liveNews
            .slice((currentPage - 1) * 12, currentPage * 12)
            .map((item, index) => ({
              '@type': 'ListItem',
              position: (currentPage - 1) * 12 + index + 1,
              name: item.title,
              url: `https://anihubstream.com/news/${item.slug}`,
            })),
        },
      ],
    },
  });

  useEffect(() => {
    // Refresh news from static CDN feed or /api/news
    setLiveLoading(true);
    fetch('/news-feed.json')
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          setLiveNews(data);
        }
      })
      .catch(() => {})
      .finally(() => setLiveLoading(false));
  }, []);

  const filteredEditorial = selectedCat === 'All'
    ? NEWS_ARTICLES
    : NEWS_ARTICLES.filter((a) => a.category === selectedCat);

  const featured = NEWS_ARTICLES[0];

  const filteredLiveNews = useMemo(() => {
    const rawFiltered = liveNews.filter((item) => {
      const matchesSource = selectedSource === 'All Sources' || item.source.toLowerCase().includes(selectedSource.toLowerCase().replace(' news', ''));
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch = !q ||
        item.title.toLowerCase().includes(q) ||
        (item.matchedAnime && item.matchedAnime.title.toLowerCase().includes(q)) ||
        item.editorialSummary.toLowerCase().includes(q);
      return matchesSource && matchesSearch;
    });

    // Deduplicate stories by franchise / title token
    const seenSlugs = new Set<string>();
    const seenFranchises = new Set<string>();
    const deduped: LiveNewsItem[] = [];

    for (const item of rawFiltered) {
      if (seenSlugs.has(item.slug)) continue;
      seenSlugs.add(item.slug);

      const normTitle = (item.matchedAnime?.slug || item.title)
        .toLowerCase()
        .replace(/^(the|a|an)\s+/i, '')
        .replace(/[^a-z0-9]/g, '')
        .slice(0, 14);

      if (normTitle && seenFranchises.has(normTitle)) {
        continue;
      }
      if (normTitle) {
        seenFranchises.add(normTitle);
      }
      deduped.push(item);
    }
    return deduped;
  }, [liveNews, selectedSource, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredLiveNews.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedLiveNews = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return filteredLiveNews.slice(start, start + PAGE_SIZE);
  }, [filteredLiveNews, safePage]);

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

        {/* Global Tabs */}
        <div style={{ display: 'flex', gap: 12, marginTop: 24, borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: 14 }}>
          <button
            type="button"
            className={`pill ${activeTab === 'live' ? 'pill--active' : ''}`}
            onClick={() => setActiveTab('live')}
            style={{
              cursor: 'pointer',
              background: activeTab === 'live' ? 'var(--crimson)' : 'transparent',
              color: '#fff',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 16px',
              fontSize: '0.9rem',
              fontWeight: 700,
            }}
          >
            <Radio size={15} className="live-pulse-icon" />
            Trending Live Wire ({filteredLiveNews.length})
          </button>
          <button
            type="button"
            className={`pill ${activeTab === 'editorial' ? 'pill--active' : ''}`}
            onClick={() => setActiveTab('editorial')}
            style={{
              cursor: 'pointer',
              background: activeTab === 'editorial' ? 'rgba(36,211,238,0.2)' : 'transparent',
              color: activeTab === 'editorial' ? 'var(--cyan)' : 'rgba(255,255,255,0.7)',
              border: activeTab === 'editorial' ? '1px solid rgba(36,211,238,0.4)' : '1px solid transparent',
              padding: '6px 16px',
              fontSize: '0.9rem',
              fontWeight: 700,
            }}
          >
            Curated Editorial Guides ({NEWS_ARTICLES.length})
          </button>
        </div>

        {/* Filter controls based on active tab */}
        {activeTab === 'editorial' ? (
          <div style={{ display: 'flex', gap: 8, marginTop: 16, overflowX: 'auto', paddingBottom: 4 }}>
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                type="button"
                className={`pill pill--sm ${selectedCat === cat ? 'pill--active' : ''}`}
                onClick={() => setSelectedCat(cat)}
                style={{
                  cursor: 'pointer',
                  background: selectedCat === cat ? 'var(--crimson)' : 'rgba(255,255,255,0.06)',
                  color: selectedCat === cat ? '#fff' : 'rgba(255,255,255,0.7)',
                }}
              >
                {cat}
              </button>
            ))}
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginTop: 16 }}>
            <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
              {LIVE_SOURCES.map((src) => (
                <button
                  key={src}
                  type="button"
                  className={`pill pill--sm ${selectedSource === src ? 'pill--active' : ''}`}
                  onClick={() => setSelectedSource(src)}
                  style={{
                    cursor: 'pointer',
                    background: selectedSource === src ? 'rgba(36,211,238,0.25)' : 'rgba(255,255,255,0.06)',
                    color: selectedSource === src ? 'var(--cyan)' : 'rgba(255,255,255,0.7)',
                    border: selectedSource === src ? '1px solid rgba(36,211,238,0.4)' : '1px solid transparent',
                  }}
                >
                  {src}
                </button>
              ))}
            </div>

            <div style={{ position: 'relative', minWidth: 220, flex: '1 1 240px', maxWidth: 360 }}>
              <Search size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,0.4)' }} />
              <input
                type="search"
                placeholder="Search live anime wire..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px 8px 34px',
                  borderRadius: 'var(--r-pill)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  background: 'rgba(20,24,36,0.8)',
                  color: '#fff',
                  fontSize: '0.85rem',
                  outline: 'none',
                }}
              />
            </div>
          </div>
        )}
      </header>

      {/* CURATED EDITORIAL GUIDES TAB */}
      {activeTab === 'editorial' && (
        <>
          {featured && selectedCat === 'All' && (
            <section className="featured-news-hero" style={{ marginBottom: 40 }}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(300px, 1.2fr) 1fr',
                  borderRadius: 'var(--r-lg)',
                  overflow: 'hidden',
                  background: 'linear-gradient(135deg, rgba(25, 29, 46, 0.9) 0%, rgba(13, 15, 24, 0.95) 100%)',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  boxShadow: '0 16px 40px rgba(0,0,0,0.5)',
                }}
              >
                <div style={{ position: 'relative', minHeight: 280, overflow: 'hidden' }}>
                  <img
                    src={featured.coverImage}
                    alt={featured.title}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    loading="eager"
                    onError={(e) => {
                      if (e.currentTarget.src !== window.location.origin + '/images/banners/banner-spring-2026.jpg') {
                        e.currentTarget.src = '/images/banners/banner-spring-2026.jpg';
                      }
                    }}
                  />
                  <div
                    style={{
                      position: 'absolute',
                      top: 16,
                      left: 16,
                      display: 'flex',
                      gap: 8,
                      alignItems: 'center',
                    }}
                  >
                    <span
                      style={{
                        background: 'var(--crimson)',
                        color: '#fff',
                        fontWeight: 800,
                        fontSize: '0.75rem',
                        padding: '4px 10px',
                        borderRadius: 'var(--r-xs)',
                        letterSpacing: '0.05em',
                      }}
                    >
                      FEATURED
                    </span>
                    {featured.badge && (
                      <span
                        style={{
                          background: 'rgba(15,23,42,0.9)',
                          color: 'var(--cyan)',
                          border: '1px solid rgba(36,211,238,0.4)',
                          fontWeight: 700,
                          fontSize: '0.75rem',
                          padding: '4px 10px',
                          borderRadius: 'var(--r-xs)',
                          letterSpacing: '0.03em',
                        }}
                      >
                        {featured.badge}
                      </span>
                    )}
                  </div>
                </div>

                <div style={{ padding: '32px 28px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14, color: 'rgba(255,255,255,0.5)', fontSize: '0.82rem', marginBottom: 12 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                      <Calendar size={14} /> {featured.date}
                    </span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                      <Clock size={14} /> {featured.readTime}
                    </span>
                  </div>

                  <h2 style={{ fontSize: 'clamp(1.3rem, 2.2vw, 1.8rem)', fontWeight: 800, margin: '0 0 14px 0', lineHeight: 1.3 }}>
                    <Link to={`/news/${featured.slug}`} style={{ color: '#fff', textDecoration: 'none' }}>
                      {featured.title}
                    </Link>
                  </h2>

                  <p style={{ color: 'rgba(255,255,255,0.75)', lineHeight: 1.6, fontSize: '0.95rem', margin: '0 0 20px 0' }}>
                    {featured.excerpt}
                  </p>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                    <Link to={`/news/${featured.slug}`} className="btn btn--sm btn--primary" style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                      Read Complete Guide <ArrowRight size={16} />
                    </Link>
                  </div>
                </div>
              </div>
            </section>
          )}

          <div className="news-grid" style={{ marginBottom: 40 }}>
            {filteredEditorial.map((article) => (
              <article key={article.slug} className="news-card">
                <Link to={`/news/${article.slug}`} className="news-card__thumb-link">
                  <img
                    src={article.coverImage}
                    alt={article.title}
                    className="news-card__thumb"
                    loading="lazy"
                    decoding="async"
                    onError={(e) => {
                      if (e.currentTarget.src !== window.location.origin + '/images/banners/banner-spring-2026.jpg') {
                        e.currentTarget.src = '/images/banners/banner-spring-2026.jpg';
                      }
                    }}
                  />
                  <span className="news-card__category">{article.category}</span>
                  {article.badge && (
                    <span
                      style={{
                        position: 'absolute',
                        top: 10,
                        left: 10,
                        background: 'rgba(15, 23, 42, 0.9)',
                        color: 'var(--cyan)',
                        border: '1px solid rgba(36, 211, 238, 0.35)',
                        fontSize: '0.68rem',
                        fontWeight: 700,
                        padding: '3px 8px',
                        borderRadius: 'var(--r-xs)',
                        letterSpacing: '0.02em',
                        backdropFilter: 'blur(4px)',
                        zIndex: 2,
                      }}
                    >
                      {article.badge}
                    </span>
                  )}
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

                  <div className="news-card__footer">
                    <Link to={`/news/${article.slug}`} className="news-card__read-link">
                      Read Full Guide <ArrowRight size={14} aria-hidden="true" />
                    </Link>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </>
      )}

      {/* TRENDING LIVE WIRE TAB WITH DEDICATED PERMALINKS */}
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
            <div className="live-wire-list">
              {paginatedLiveNews.map((item) => {
                const resolvedAnime = item.matchedAnime ? resolveAnime(item.matchedAnime.slug) || {
                  slug: item.matchedAnime.slug,
                  title: item.matchedAnime.title,
                  art: item.matchedAnime.art || item.imageUrl || '/images/banners/banner-spring-2026.jpg',
                  fallbackArt: '/images/banners/banner-spring-2026.jpg',
                  rating: item.matchedAnime.rating || 8.2,
                  format: 'TV Series',
                  status: 'Air Broadcast',
                  genres: item.matchedAnime.genres || ['Action', 'Fantasy'],
                  streamUrl: item.matchedAnime.streamUrl,
                } : null;

                const displayImage = item.imageUrl || resolvedAnime?.art || '/images/banners/banner-spring-2026.jpg';
                const author = getAuthorForSource(item.source);

                return (
                  <article key={item.id} className="live-wire-card">
                    {/* Header: Source, Date, Category */}
                    <div className="live-wire-card__header">
                      <div className="live-wire-card__badges">
                        <span className="pill pill--sm" style={{ background: 'rgba(36,211,238,0.18)', color: '#f8fafc', border: '1px solid rgba(36,211,238,0.45)', fontWeight: 700 }}>
                          {item.source}
                        </span>
                        <span className="pill pill--sm" style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.85)', border: '1px solid rgba(255,255,255,0.12)' }}>
                          {item.category}
                        </span>
                        <span style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.6)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <Calendar size={13} aria-hidden="true" />
                          <time dateTime={item.publishedAt}>
                            {new Date(item.publishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} • {formatTimeAgo(item.timestamp)}
                          </time>
                        </span>
                      </div>

                      {resolvedAnime && (
                        <AnimeSpotlightCard
                          anime={resolvedAnime}
                          variant="compact-chip"
                        />
                      )}
                    </div>

                    {/* Main Content Layout with Dedicated Permalink */}
                    <div className="live-wire-card__content">
                      <Link to={`/news/${item.slug}`} className="live-wire-card__thumb-link">
                        <img
                          src={displayImage}
                          alt={item.title}
                          className="live-wire-card__thumb"
                          loading="lazy"
                          decoding="async"
                          onError={(e) => {
                            if (e.currentTarget.src !== window.location.origin + '/images/banners/banner-spring-2026.jpg') {
                              e.currentTarget.src = '/images/banners/banner-spring-2026.jpg';
                            }
                          }}
                        />
                      </Link>

                      <div>
                        <h2 className="live-wire-card__title">
                          <Link to={`/news/${item.slug}`}>
                            {item.title}
                          </Link>
                        </h2>

                        <p className="live-wire-card__excerpt">
                          {item.editorialSummary}
                        </p>

                        <div className="live-wire-card__actions">
                          <Link to={`/news/${item.slug}`} className="btn btn--sm btn--primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            Read Full Article <ArrowRight size={13} />
                          </Link>
                          {resolvedAnime && (
                            <Link to={resolvedAnime.streamUrl} className="btn btn--sm btn--ghost" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                              Stream Anime <ArrowRight size={13} />
                            </Link>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Card Footer: Author Byline + Source Verification Link */}
                    <div className="live-wire-card__footer">
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <User size={13} style={{ color: 'var(--crimson)' }} />
                        <b>{author.name}</b> ({author.role})
                      </span>
                      <a
                        href={item.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: 'var(--cyan)', display: 'inline-flex', alignItems: 'center', gap: 5, textDecoration: 'none' }}
                      >
                        Source Verification ({item.source}) <ExternalLink size={12} />
                      </a>
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          {/* Pagination Controls with Real Crawlable Links and Rel Prev/Next */}
          {totalPages > 1 && (
            <nav className="live-wire-pagination" aria-label="News pagination">
              {safePage > 1 ? (
                <Link
                  to={safePage === 2 ? '/news' : `/news?page=${safePage - 1}`}
                  rel="prev"
                  className="btn btn--sm btn--ghost"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                  onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                >
                  <ChevronLeft size={15} /> Prev
                </Link>
              ) : (
                <span className="btn btn--sm btn--ghost" style={{ opacity: 0.4, cursor: 'not-allowed', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <ChevronLeft size={15} /> Prev
                </span>
              )}
              <span style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.7)', padding: '0 8px' }}>
                Page <b>{safePage}</b> of <b>{totalPages}</b>
              </span>
              {safePage < totalPages ? (
                <Link
                  to={`/news?page=${safePage + 1}`}
                  rel="next"
                  className="btn btn--sm btn--ghost"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                  onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                >
                  Next <ChevronRight size={15} />
                </Link>
              ) : (
                <span className="btn btn--sm btn--ghost" style={{ opacity: 0.4, cursor: 'not-allowed', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  Next <ChevronRight size={15} />
                </span>
              )}
            </nav>
          )}
        </section>
      )}
    </div>
  );
}
