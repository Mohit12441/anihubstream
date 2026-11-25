import { useParams, Link } from 'react-router-dom';
import { Calendar, Clock, User, ArrowLeft, Share2, Tag } from 'lucide-react';
import { getNewsArticleBySlug, NEWS_ARTICLES } from '../data/newsData';
import { useSEO } from '../lib/useSEO';
import { useToast } from '../lib/Toast';
import '../styles/news.css';

export function NewsArticle() {
  const { slug } = useParams<{ slug: string }>();
  const { notify } = useToast();
  const article = slug ? getNewsArticleBySlug(slug) : undefined;

  useSEO({
    title: article ? `${article.title} | AniHubStream` : 'Article Not Found | AniHubStream',
    description: article ? article.excerpt : 'The requested article could not be found.',
    jsonLd: article
      ? {
          '@context': 'https://schema.org',
          '@type': 'NewsArticle',
          headline: article.title,
          description: article.excerpt,
          image: [`https://anihubstream.com${article.coverImage}`],
          datePublished: `${article.date}T10:00:00+00:00`,
          dateModified: `${article.date}T10:00:00+00:00`,
          author: [
            {
              '@type': 'Person',
              name: article.author,
              jobTitle: article.authorRole,
            },
          ],
          publisher: {
            '@type': 'Organization',
            name: 'AniHubStream',
            logo: {
              '@type': 'ImageObject',
              url: 'https://anihubstream.com/art/poster-shadow-hunter.jpg',
            },
          },
          mainEntityOfPage: {
            '@type': 'WebPage',
            '@id': `https://anihubstream.com/news/${article.slug}`,
          },
        }
      : undefined,
  });

  if (!article) {
    return (
      <div className="page shell" style={{ padding: '60px 0', textAlign: 'center' }}>
        <h2>Article Not Found</h2>
        <p style={{ color: 'rgba(255,255,255,0.6)', marginTop: 12 }}>
          The editorial piece you are looking for does not exist or may have moved.
        </p>
        <Link to="/news" className="btn btn--sm btn--primary" style={{ marginTop: 24, display: 'inline-flex', gap: 8 }}>
          <ArrowLeft size={16} /> Back to News Hub
        </Link>
      </div>
    );
  }

  const handleShare = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(window.location.href);
      notify('Article link copied to clipboard!');
    }
  };

  const related = NEWS_ARTICLES.filter((a) => a.slug !== article.slug).slice(0, 2);

  // Render markdown-like sections cleanly
  const paragraphs = article.content.split('\n\n');

  return (
    <article className="page news-article-view shell">
      <div className="article-hero">
        <nav className="article-breadcrumb" aria-label="Breadcrumb">
          <Link to="/">Home</Link>
          <span>/</span>
          <Link to="/news">News &amp; Editorial</Link>
          <span>/</span>
          <span style={{ color: 'rgba(255,255,255,0.9)' }}>{article.category}</span>
        </nav>

        <h1 className="article-header__title">{article.title}</h1>

        <div className="article-header__meta">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <User size={15} style={{ color: 'var(--crimson)' }} />
            <b>{article.author}</b> ({article.authorRole})
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Calendar size={15} />
            {article.date}
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Clock size={15} />
            {article.readTime}
          </span>
          <button
            type="button"
            onClick={handleShare}
            className="btn btn--xs btn--ghost"
            style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6 }}
            aria-label="Share article"
          >
            <Share2 size={14} /> Share
          </button>
        </div>

        <div className="article-cover-wrap">
          <img src={article.coverImage} alt={article.title} className="article-cover" />
        </div>
      </div>

      <div className="article-content" style={{ margin: '0 auto' }}>
        {paragraphs.map((p, i) => {
          const trimmed = p.trim();
          if (trimmed.startsWith('### ')) {
            return <h3 key={i}>{trimmed.replace('### ', '')}</h3>;
          }
          if (trimmed.startsWith('## ')) {
            return <h2 key={i}>{trimmed.replace('## ', '')}</h2>;
          }
          if (trimmed.startsWith('- ')) {
            const items = trimmed.split('\n').map((item) => item.replace(/^- /, ''));
            return (
              <ul key={i}>
                {items.map((li, j) => (
                  <li key={j} dangerouslySetInnerHTML={{ __html: li.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') }} />
                ))}
              </ul>
            );
          }
          return (
            <p
              key={i}
              dangerouslySetInnerHTML={{
                __html: trimmed
                  .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                  .replace(/\*(.*?)\*/g, '<em>$1</em>'),
              }}
            />
          );
        })}

        {/* Tags */}
        <div className="article-tags">
          <Tag size={15} style={{ color: 'var(--cyan)', marginRight: 4, alignSelf: 'center' }} />
          {article.tags.map((t) => (
            <span key={t} className="article-tag">
              #{t}
            </span>
          ))}
        </div>

        {/* Backlink & Internal Link Box */}
        <div
          style={{
            marginTop: 36,
            padding: 20,
            background: 'linear-gradient(135deg, rgba(255, 31, 74, 0.08) 0%, rgba(36, 211, 238, 0.08) 100%)',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            borderRadius: 'var(--r-md)',
          }}
        >
          <h4 style={{ margin: '0 0 8px 0', fontSize: '1.05rem', color: '#fff' }}>
            Ready to Stream?
          </h4>
          <p style={{ margin: '0 0 14px 0', fontSize: '0.88rem', color: 'rgba(255,255,255,0.75)' }}>
            Stream all featured episodes in high-definition 1080p with subbed and dubbed audio, accurate schedules, and skip-intro markers.
          </p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Link to="/anime" className="btn btn--sm btn--primary">
              Browse Catalogue
            </Link>
            <Link to="/schedule" className="btn btn--sm btn--ghost">
              Check Airing Schedule
            </Link>
          </div>
        </div>
      </div>

      {/* Related Articles */}
      {related.length > 0 && (
        <section style={{ marginTop: 60, paddingTop: 30, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <h3 style={{ fontSize: '1.3rem', marginBottom: 20, color: '#fff' }}>More Anime Guides</h3>
          <div className="news-grid">
            {related.map((rel) => (
              <article key={rel.slug} className="news-card">
                <Link to={`/news/${rel.slug}`} className="news-card__thumb-link">
                  <img src={rel.coverImage} alt={rel.title} className="news-card__thumb" loading="lazy" />
                  <span className="news-card__category">{rel.category}</span>
                </Link>
                <div className="news-card__body">
                  <h4 className="news-card__title">
                    <Link to={`/news/${rel.slug}`}>{rel.title}</Link>
                  </h4>
                  <p className="news-card__excerpt">{rel.excerpt}</p>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
    </article>
  );
}
