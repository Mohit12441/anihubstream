import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Newspaper, ArrowRight, Clock, Calendar, Sparkles, Radio, ExternalLink } from 'lucide-react';
import { NEWS_ARTICLES } from '../data/newsData';
import INITIAL_LIVE_NEWS from '../../data/news/feed.json';
import '../styles/news.css';

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

export function NewsSpotlight() {
  const [tab, setTab] = useState<'live' | 'guides'>('live');
  const spotlightArticles = NEWS_ARTICLES.slice(0, 3);
  const liveArticles = (INITIAL_LIVE_NEWS as unknown as LiveNewsItem[]).slice(0, 3);

  return (
    <section className="home__row news-spotlight" aria-labelledby="row-news-spotlight">
      <div className="sec-head" style={{ flexWrap: 'wrap', gap: 12 }}>
        <h2 id="row-news-spotlight">
          <Newspaper size={21} aria-hidden="true" />
          Anime News &amp; Editorial Guides
          <Link to="/news" className="sec-head__link" aria-label="Browse all anime guides and news">
            <ArrowRight size={18} aria-hidden="true" />
          </Link>
        </h2>

        <div className="news-spotlight__controls" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div className="news-spotlight__tabs" style={{ display: 'flex', background: 'rgba(255, 255, 255, 0.05)', borderRadius: 'var(--r-pill)', padding: 3, border: '1px solid rgba(255, 255, 255, 0.08)' }}>
            <button
              type="button"
              className={`pill pill--sm ${tab === 'live' ? 'pill--active' : ''}`}
              style={{
                background: tab === 'live' ? 'var(--crimson)' : 'transparent',
                color: '#fff',
                border: 'none',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 12px',
                borderRadius: 'var(--r-pill)',
                fontWeight: 600,
                fontSize: '0.8rem',
                transition: 'all 0.2s ease',
              }}
              onClick={() => setTab('live')}
            >
              <Radio size={13} className="live-pulse-icon" style={{ color: '#fff' }} />
              Breaking Wire (Live)
            </button>
            <button
              type="button"
              className={`pill pill--sm ${tab === 'guides' ? 'pill--active' : ''}`}
              style={{
                background: tab === 'guides' ? 'rgba(36, 211, 238, 0.2)' : 'transparent',
                color: tab === 'guides' ? 'var(--cyan)' : 'rgba(255, 255, 255, 0.7)',
                border: tab === 'guides' ? '1px solid rgba(36, 211, 238, 0.4)' : '1px solid transparent',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 12px',
                borderRadius: 'var(--r-pill)',
                fontWeight: 600,
                fontSize: '0.8rem',
                transition: 'all 0.2s ease',
              }}
              onClick={() => setTab('guides')}
            >
              <Sparkles size={13} />
              Curated Guides
            </button>
          </div>

          <Link to="/news" className="btn btn--sm btn--ghost" style={{ fontSize: '0.8rem', padding: '4px 10px' }}>
            View All ({liveArticles.length > 0 ? `${(INITIAL_LIVE_NEWS as unknown as LiveNewsItem[]).length}+ Live` : 'Guides'}) <ArrowRight size={13} />
          </Link>
        </div>
      </div>

      {tab === 'live' ? (
        <div className="news-spotlight__grid">
          {liveArticles.map((article) => (
            <article key={article.id} className="news-card live-news-card">
              <Link to="/news" className="news-card__thumb-link">
                <img
                  src={article.imageUrl || '/images/banners/banner-spring-2026.jpg'}
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
                <span className="news-card__category" style={{ background: 'rgba(36, 211, 238, 0.9)', color: '#090a10', fontWeight: 800 }}>
                  {article.source}
                </span>
              </Link>

              <div className="news-card__body">
                <div className="news-card__meta">
                  <span className="news-card__date">
                    <Calendar size={13} aria-hidden="true" />
                    {formatTimeAgo(article.timestamp)}
                  </span>
                  <span className="news-card__read">
                    <Clock size={13} aria-hidden="true" />
                    {article.category}
                  </span>
                </div>

                <h3 className="news-card__title">
                  <Link to="/news">{article.title}</Link>
                </h3>

                <p className="news-card__excerpt" style={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                  {article.editorialSummary}
                </p>

                <div className="news-card__footer" style={{ marginTop: 'auto', paddingTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  {article.matchedAnime ? (
                    <Link to={article.matchedAnime.streamUrl} className="pill pill--sm" style={{ background: 'rgba(255, 31, 74, 0.15)', color: 'var(--crimson)', border: '1px solid rgba(255, 31, 74, 0.3)', fontSize: '0.75rem', gap: 4 }}>
                      Stream {article.matchedAnime.title} <ArrowRight size={12} />
                    </Link>
                  ) : (
                    <Link to="/news" className="news-card__read-link">
                      Read Report <ArrowRight size={14} aria-hidden="true" />
                    </Link>
                  )}
                  <a
                    href={article.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="news-card__source-link"
                    style={{ fontSize: '0.74rem', color: 'rgba(255,255,255,0.4)', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                    aria-label={`Source: ${article.source}`}
                  >
                    Source <ExternalLink size={11} />
                  </a>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="news-spotlight__grid">
          {spotlightArticles.map((article) => (
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
      )}
    </section>
  );
}
