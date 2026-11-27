// @ts-check
import { useEffect, useState, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Newspaper, Rss, ArrowRight, Calendar, Clock, Radio, ExternalLink, Search, ChevronLeft, ChevronRight, User, X, Sparkles, Film } from 'lucide-react';
import { NEWS_ARTICLES } from '../data/newsData';
import { resolveAnime } from '../data/animeResolver';
import { AnimeSpotlightCard } from '../components/AnimeSpotlightCard';
import { useSEO } from '../lib/useSEO';
import INITIAL_LIVE_NEWS from '../../data/news/feed.json';
import '../styles/news.css';

const CATEGORIES = ['All', 'Seasonal Guide', 'Rankings', 'Analysis'];
const LIVE_SOURCES = [
  'All Sources',
  'Anime Corner',
  'MyAnimeList',
  'Crunchyroll News',
  'Anime Trending',
  'Otaku USA Magazine',
  'Dexerto Anime',
  'CBR Anime',
];

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
    case 'Anime Corner':
      return { name: 'Elena Rostova', role: 'Anime Industry Correspondent' };
    case 'Crunchyroll News':
      return { name: 'Marcus Vance', role: 'Broadcast Syndication Analyst' };
    case 'MyAnimeList':
      return { name: 'Daiki Tanaka', role: 'Franchise Data Specialist' };
    case 'Anime Trending':
      return { name: 'Kento Takahashi', role: 'Global Anime Trends Analyst' };
    case 'Otaku USA Magazine':
      return { name: 'Joseph Luster', role: 'Senior Feature Journalist' };
    case 'Dexerto Anime':
      return { name: 'Liam Croft', role: 'Entertainment & Gaming Editor' };
    case 'CBR Anime':
      return { name: 'David Caballero', role: 'Comics & Manga Specialist' };
    default:
      return { name: 'Kenji Sato', role: 'Senior Anime Journalist' };
  }
}

const PAGE_SIZE = 12;

export function News() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState<'editorial' | 'live'>(tabParam === 'live' ? 'live' : 'editorial');
  const [selectedCat, setSelectedCat] = useState('All');
  const [selectedSource, setSelectedSource] = useState('All Sources');
  const [searchQuery, setSearchQuery] = useState('');
  const [liveNews, setLiveNews] = useState<LiveNewsItem[]>(INITIAL_LIVE_NEWS as unknown as LiveNewsItem[]);
  const [liveLoading, setLiveLoading] = useState(false);

  useEffect(() => {
    if (tabParam === 'live' && activeTab !== 'live') {
      setActiveTab('live');
    } else if (!tabParam && activeTab !== 'editorial') {
      setActiveTab('editorial');
    }
  }, [tabParam]);

  const switchTab = (tab: 'editorial' | 'live') => {
    setActiveTab(tab);
    const nextParams = new URLSearchParams(searchParams);
    if (tab === 'live') {
      nextParams.set('tab', 'live');
    } else {
      nextParams.delete('tab');
      nextParams.delete('page');
    }
    setSearchParams(nextParams, { replace: true });
  };

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

  const [editorialArticles, setEditorialArticles] = useState(NEWS_ARTICLES);

  useEffect(() => {
    // Refresh editorial guides dynamically from CDN
    fetch('/editorial.json')
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          setEditorialArticles(data);
        }
      })
      .catch(() => {});
  }, []);

  const filteredEditorial = useMemo(() => {
    return editorialArticles.filter((a) => {
      const matchesCat = selectedCat === 'All' || a.category === selectedCat;
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch = !q ||
        a.title.toLowerCase().includes(q) ||
        a.excerpt.toLowerCase().includes(q) ||
        (a.tags && a.tags.some((t: string) => t.toLowerCase().includes(q))) ||
        (a.relatedAnimeSlugs && a.relatedAnimeSlugs.some((s: string) => s.toLowerCase().includes(q)));
      return matchesCat && matchesSearch;
    });
  }, [editorialArticles, selectedCat, searchQuery]);

  const featured = editorialArticles[0] || NEWS_ARTICLES[0];

  const liveSources = useMemo(() => {
    const sources = new Set<string>();
    for (const item of liveNews) {
      if (item.source) sources.add(item.source);
    }
    const dynamicSources = Array.from(sources);
    return ['All Sources', ...(dynamicSources.length > 0 ? dynamicSources : LIVE_SOURCES.slice(1))];
  }, [liveNews]);

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

    // Deduplicate stories by slug and normalized headline prefix (preventing false drops of distinct news)
    const seenSlugs = new Set<string>();
    const seenTitles = new Set<string>();
    const deduped: LiveNewsItem[] = [];

    for (const item of rawFiltered) {
      if (seenSlugs.has(item.slug)) continue;
      seenSlugs.add(item.slug);

      const titleKey = item.title
        .toLowerCase()
        .replace(/^(the|a|an)\s+/i, '')
        .replace(/[^a-z0-9]/g, '')
        .slice(0, 36);

      if (titleKey && seenTitles.has(titleKey)) {
        continue;
      }
      if (titleKey) {
        seenTitles.add(titleKey);
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
      <header className="news-page-head">
        <div className="news-hero-top">
          <div className="news-hero-brand">
            <div className="news-live-beacon">
              <span className="news-live-beacon__dot" aria-hidden="true" />
              <span>Anime News Wire • 24/7 Global Curation</span>
            </div>
            <h1 className="news-hero-title">
              <Newspaper size={34} className="news-hero-title__icon" aria-hidden="true" />
              <span>Anime News &amp; Editorial Hub</span>
            </h1>
            <p className="news-hero-desc">
              Comprehensive seasonal guides, rankings, and real-time studio announcements from Tokyo to worldwide simulcasts.
            </p>
          </div>

          <div className="news-hero-actions">
            <a
              href="/sitemap-news.xml"
              target="_blank"
              rel="noopener noreferrer"
              className="news-link-btn"
              title="View News XML Sitemap"
            >
              <span>News Sitemap</span>
              <ExternalLink size={13} aria-hidden="true" />
            </a>
            <a
              href="/rss.xml"
              target="_blank"
              rel="noopener noreferrer"
              className="news-link-btn news-link-btn--rss"
              title="Subscribe via RSS Feed"
            >
              <Rss size={15} style={{ color: 'var(--orange)' }} aria-hidden="true" />
              <span>RSS Feed</span>
            </a>
          </div>
        </div>

        {/* Unified Segmented Nav Tabs */}
        <nav className="news-nav-bar" aria-label="News sections">
          <button
            type="button"
            className={`news-nav-tab news-nav-tab--editorial ${activeTab === 'editorial' ? 'news-nav-tab--active' : ''}`}
            onClick={() => switchTab('editorial')}
          >
            <Sparkles size={16} aria-hidden="true" />
            <span>Curated Editorial Guides</span>
            <span className="news-nav-count">{editorialArticles.length}</span>
          </button>
          <button
            type="button"
            className={`news-nav-tab news-nav-tab--live ${activeTab === 'live' ? 'news-nav-tab--active' : ''}`}
            onClick={() => switchTab('live')}
          >
            <Radio size={16} aria-hidden="true" />
            <span>Trending Live Wire</span>
            <span className="news-nav-count">{filteredLiveNews.length}</span>
          </button>
        </nav>

        {/* Filter Strip */}
        <div className="news-filter-strip">
          {activeTab === 'editorial' ? (
            <>
              <div className="news-pill-scroller">
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    className={`news-filter-pill ${selectedCat === cat ? 'news-filter-pill--active' : ''}`}
                    onClick={() => setSelectedCat(cat)}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              <div className="news-search-wrap">
                <Search size={15} className="news-search-icon" aria-hidden="true" />
                <input
                  type="search"
                  placeholder="Search 14+ guides, rankings & anime..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="news-search-input"
                  aria-label="Search editorial guides"
                />
                {searchQuery && (
                  <button
                    type="button"
                    className="news-search-clear"
                    onClick={() => setSearchQuery('')}
                    title="Clear search"
                    aria-label="Clear search input"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="news-pill-scroller">
                {liveSources.map((src) => (
                  <button
                    key={src}
                    type="button"
                    className={`news-filter-pill ${selectedSource === src ? 'news-filter-pill--cyan-active' : ''}`}
                    onClick={() => setSelectedSource(src)}
                  >
                    {src}
                  </button>
                ))}
              </div>

              <div className="news-search-wrap">
                <Search size={15} className="news-search-icon" aria-hidden="true" />
                <input
                  type="search"
                  placeholder="Search live anime wire..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="news-search-input"
                  aria-label="Search anime news stories"
                />
                {searchQuery && (
                  <button
                    type="button"
                    className="news-search-clear"
                    onClick={() => setSearchQuery('')}
                    title="Clear search"
                    aria-label="Clear search input"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </header>

      {/* CURATED EDITORIAL GUIDES TAB */}
      {activeTab === 'editorial' && (
        <>
          {featured && selectedCat === 'All' && !searchQuery && (
            <section className="featured-news-hero" aria-label="Featured Story">
              <div className="featured-news-hero__grid">
                <div className="featured-news-hero__cover-wrap">
                  <img
                    src={featured.coverImage}
                    alt={featured.title}
                    className="featured-news-hero__cover"
                    loading="eager"
                    onError={(e) => {
                      const target = e.currentTarget;
                      if (!target.getAttribute('data-fallback-tried')) {
                        target.setAttribute('data-fallback-tried', 'true');
                        target.src = '/images/banners/banner-spring-2026.jpg';
                      }
                    }}
                  />
                  <div className="featured-news-hero__cover-scrim" aria-hidden="true" />
                  <div className="featured-news-hero__badges">
                    <span className="featured-badge-pill featured-badge-pill--lead">
                      FEATURED
                    </span>
                    {featured.badge && (
                      <span className="featured-badge-pill featured-badge-pill--badge">
                        {featured.badge}
                      </span>
                    )}
                  </div>
                </div>

                <div className="featured-news-hero__body">
                  <div className="featured-news-hero__meta">
                    <span>
                      <Calendar size={14} aria-hidden="true" />
                      <time dateTime={featured.date}>{featured.date}</time>
                    </span>
                    <span>
                      <Clock size={14} aria-hidden="true" />
                      <span>{featured.readTime}</span>
                    </span>
                  </div>

                  <h2 className="featured-news-hero__title">
                    <Link to={`/news/${featured.slug}`}>
                      {featured.title}
                    </Link>
                  </h2>

                  <p className="featured-news-hero__excerpt">
                    {featured.excerpt}
                  </p>

                  <div className="featured-news-hero__actions">
                    <Link to={`/news/${featured.slug}`} className="featured-news-hero__btn">
                      <span>Read Complete Guide</span>
                      <ArrowRight size={16} aria-hidden="true" />
                    </Link>
                  </div>
                </div>
              </div>
            </section>
          )}

          {filteredEditorial.length === 0 ? (
            <div style={{ padding: '60px 0', textAlign: 'center', color: 'rgba(255,255,255,0.6)' }}>
              <p style={{ fontSize: '1.1rem', marginBottom: 12 }}>No editorial guides match "{searchQuery}".</p>
              <button
                type="button"
                onClick={() => { setSearchQuery(''); setSelectedCat('All'); }}
                className="btn btn--sm btn--ghost"
              >
                Clear search &amp; filters
              </button>
            </div>
          ) : (
            <div className="news-grid">
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
                        const target = e.currentTarget;
                        if (!target.getAttribute('data-fallback-tried')) {
                          target.setAttribute('data-fallback-tried', 'true');
                          target.src = '/images/banners/banner-spring-2026.jpg';
                        }
                      }}
                    />
                    <div className="news-card__badge-cluster">
                      <span className="news-card__category">{article.category}</span>
                      {article.badge && (
                        <span className="news-card__badge">{article.badge}</span>
                      )}
                    </div>
                  </Link>

                  <div className="news-card__body">
                    <div className="news-card__meta">
                      <span>
                        <Calendar size={13} aria-hidden="true" />
                        <time dateTime={article.date}>{article.date}</time>
                      </span>
                      <span>
                        <Clock size={13} aria-hidden="true" />
                        <span>{article.readTime}</span>
                      </span>
                    </div>

                    <h3 className="news-card__title">
                      <Link to={`/news/${article.slug}`}>{article.title}</Link>
                    </h3>

                    <p className="news-card__excerpt">{article.excerpt}</p>

                    <div className="news-card__footer">
                      <Link to={`/news/${article.slug}`} className="news-card__read-link">
                        <span>Read Full Guide</span>
                        <ArrowRight size={14} aria-hidden="true" />
                      </Link>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      )}

      {/* TRENDING LIVE WIRE TAB WITH DEDICATED PERMALINKS */}
      {activeTab === 'live' && (
        <section className="live-wire-section" aria-label="Trending News Wire">
          {liveLoading ? (
            <div style={{ padding: '60px 0', textAlign: 'center', color: 'rgba(255,255,255,0.6)' }}>
              Loading real-time curated anime news wire...
            </div>
          ) : filteredLiveNews.length === 0 ? (
            <div style={{ padding: '50px 0', textAlign: 'center', color: 'rgba(255,255,255,0.6)' }}>
              <p style={{ fontSize: '1.05rem', marginBottom: 12 }}>No stories match your current filter.</p>
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="btn btn--sm btn--ghost"
                >
                  Clear search query
                </button>
              )}
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
                    {/* Header: Badges & Spotlight */}
                    <div className="live-wire-card__header">
                      <div className="live-wire-card__badges">
                        <span className="live-wire-source-pill">
                          {item.source}
                        </span>
                        <span className="live-wire-cat-pill">
                          {item.category}
                        </span>
                        <span className="live-wire-card__time">
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

                    {/* Content: Thumbnail & Body */}
                    <div className="live-wire-card__content">
                      <Link to={`/news/${item.slug}`} className="live-wire-card__thumb-link">
                        <img
                          src={displayImage}
                          alt={item.title}
                          className="live-wire-card__thumb"
                          loading="lazy"
                          decoding="async"
                          onError={(e) => {
                            const target = e.currentTarget;
                            if (!target.getAttribute('data-fallback-tried')) {
                              target.setAttribute('data-fallback-tried', 'true');
                              target.src = '/images/banners/banner-spring-2026.jpg';
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
                          <Link to={`/news/${item.slug}`} className="btn btn--sm btn--primary">
                            <span>Read Full Article</span>
                            <ArrowRight size={13} aria-hidden="true" />
                          </Link>
                          {resolvedAnime && (
                            <Link to={resolvedAnime.streamUrl} className="btn btn--sm btn--ghost">
                              <Film size={13} aria-hidden="true" />
                              <span>Stream Anime</span>
                            </Link>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Card Footer: Author & Source */}
                    <div className="live-wire-card__footer">
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <User size={13} style={{ color: 'var(--crimson)' }} aria-hidden="true" />
                        <b>{author.name}</b> ({author.role})
                      </span>
                      <a
                        href={item.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: 'var(--cyan)', display: 'inline-flex', alignItems: 'center', gap: 5, textDecoration: 'none' }}
                      >
                        <span>Source Verification ({item.source})</span>
                        <ExternalLink size={12} aria-hidden="true" />
                      </a>
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          {/* Pagination Controls with Accessible Rel Links */}
          {totalPages > 1 && (
            <nav className="live-wire-pagination" aria-label="News pagination">
              {safePage > 1 ? (
                <Link
                  to={safePage === 2 ? '/news?tab=live' : `/news?tab=live&page=${safePage - 1}`}
                  rel="prev"
                  className="pagination-btn"
                  onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                >
                  <ChevronLeft size={15} aria-hidden="true" />
                  <span>Prev</span>
                </Link>
              ) : (
                <button type="button" disabled className="pagination-btn">
                  <ChevronLeft size={15} aria-hidden="true" />
                  <span>Prev</span>
                </button>
              )}

              <span className="pagination-page-indicator">
                Page <b>{safePage}</b> of <b>{totalPages}</b>
              </span>

              {safePage < totalPages ? (
                <Link
                  to={`/news?tab=live&page=${safePage + 1}`}
                  rel="next"
                  className="pagination-btn"
                  onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                >
                  <span>Next</span>
                  <ChevronRight size={15} aria-hidden="true" />
                </Link>
              ) : (
                <button type="button" disabled className="pagination-btn">
                  <span>Next</span>
                  <ChevronRight size={15} aria-hidden="true" />
                </button>
              )}
            </nav>
          )}
        </section>
      )}
    </div>
  );
}
