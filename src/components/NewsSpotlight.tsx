import { Link } from 'react-router-dom';
import { Newspaper, ArrowRight, Clock, Calendar, Sparkles } from 'lucide-react';
import { NEWS_ARTICLES } from '../data/newsData';
import '../styles/news.css';

export function NewsSpotlight() {
  const spotlightArticles = NEWS_ARTICLES.slice(0, 3);

  return (
    <section className="home__row news-spotlight" aria-labelledby="row-news-spotlight">
      <div className="sec-head">
        <h2 id="row-news-spotlight">
          <Newspaper size={21} aria-hidden="true" />
          Anime News & Editorial Guides
          <Link to="/news" className="sec-head__link" aria-label="Browse all anime guides and news">
            <ArrowRight size={18} aria-hidden="true" />
          </Link>
        </h2>
        <div className="news-spotlight__meta-badge">
          <Sparkles size={14} aria-hidden="true" />
          <span>Curated Guides &amp; Schedules</span>
        </div>
      </div>

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
    </section>
  );
}
