// @ts-check
import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Calendar, Clock, User, ArrowLeft, Share2, Tag, Play, Star, Sparkles, Film } from 'lucide-react';
import { getNewsArticleBySlug, getAllNewsArticles, convertLiveNewsToArticle, NewsArticleItem } from '../data/newsData';
import { resolveAnime, findAnimeInText } from '../data/animeResolver';
import { AnimeSpotlightCard } from '../components/AnimeSpotlightCard';
import { useSEO } from '../lib/useSEO';
import { useToast } from '../lib/Toast';
import '../styles/news.css';

interface ParsedBlock {
  type: 'h2' | 'h3' | 'numbered-list' | 'bullet-list' | 'paragraph';
  text?: string;
  matchedAnime?: ReturnType<typeof resolveAnime>;
  items?: Array<{
    rank?: number;
    raw: string;
    title?: string;
    body?: string;
    matchedAnime?: ReturnType<typeof resolveAnime>;
  }>;
}

function renderMarkdown(str: string): string {
  if (!str) return '';
  return str
    .replace(/\(Source:.*?\)/gi, '')
    .replace(/\[Written by.*?\]/gi, '')
    .replace(/Note:\s*Tempai:.*?(?=(\n|$))/gi, '')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" style="color:var(--cyan);text-decoration:underline;font-weight:600;">$1</a>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>');
}

export function cleanHeadingText(str: string): string {
  if (!str) return '';
  return str
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Extract link text from [Title](url)
    .replace(/\*\*(.*?)\*\*/g, '$1')           // Strip bold **
    .replace(/\*(.*?)\*/g, '$1')               // Strip italics *
    .replace(/^#+\s*/, '')                     // Strip leading hashtags (e.g. ### or #2)
    .replace(/^#(?=\d)/, '')                   // Strip # right before a number (e.g. #1 -> 1)
    .trim();
}

function parseArticleBlocks(content: string): ParsedBlock[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const blocks: ParsedBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();

    if (!line) {
      i++;
      continue;
    }

    // Heading 3 or numbered anime entry heading (e.g. '### 1. Title', '### #1. Title', '#1. Title', '#2. Title')
    const h3Match = line.match(/^###\s+(.*)/) || line.match(/^#+(\d+[\.:\s-].*)/);
    if (h3Match) {
      const rawText = h3Match[1].trim();
      const text = cleanHeadingText(rawText);
      const matched = resolveAnime(text) || resolveAnime(rawText);
      blocks.push({ type: 'h3', text, matchedAnime: matched });
      i++;
      continue;
    }

    // Heading 2 (e.g. '## Section Title')
    if (line.startsWith('## ')) {
      const rawText = line.replace('## ', '').trim();
      const text = cleanHeadingText(rawText);
      blocks.push({ type: 'h2', text });
      i++;
      continue;
    }

    // Standalone numbered entry with link (e.g. "1. [Mushoku Tensei: Jobless Reincarnation](/anime/...)")
    const standaloneEntryMatch = line.match(/^(\d+)\.\s+\[([^\]]+)\]\(([^)]+)\)$/);
    if (standaloneEntryMatch) {
      const rank = standaloneEntryMatch[1];
      const title = standaloneEntryMatch[2];
      const text = `${rank}. ${title}`;
      const matched = resolveAnime(title) || resolveAnime(text);
      blocks.push({ type: 'h3', text, matchedAnime: matched });
      i++;
      continue;
    }

    // Numbered List (e.g. 1. **Berserk**: ...)
    const numMatch = line.match(/^(\d+)\.\s+(.*)/);
    if (numMatch) {
      const items: ParsedBlock['items'] = [];
      while (i < lines.length) {
        const curr = lines[i].trim();
        const m = curr.match(/^(\d+)\.\s+(.*)/);
        if (!m) break;
        const rank = parseInt(m[1], 10);
        const textContent = m[2];

        // Extract **Title**: Body or [Title](url): Body if present
        const boldMatch = textContent.match(/^\*\*(.*?)\*\*(.*)/);
        let title = '';
        let body = textContent;
        if (boldMatch) {
          title = boldMatch[1];
          body = boldMatch[2].replace(/^[:\s-]+/, '').trim();
        } else {
          const linkMatch = textContent.match(/^\[([^\]]+)\]\(([^)]+)\)(.*)/);
          if (linkMatch) {
            title = linkMatch[1];
            body = linkMatch[3].replace(/^[:\s-]+/, '').trim();
          }
        }

        const cleanTitle = title ? cleanHeadingText(title) : '';
        const matchedAnime = resolveAnime(cleanTitle) || resolveAnime(textContent);

        items.push({
          rank,
          raw: cleanHeadingText(textContent),
          title: cleanTitle || undefined,
          body: body || undefined,
          matchedAnime: matchedAnime || undefined,
        });
        i++;
      }
      blocks.push({ type: 'numbered-list', items });
      continue;
    }

    // Bullet List (e.g. - **Item**: ...)
    if (line.startsWith('- ') || line.startsWith('* ')) {
      const items: ParsedBlock['items'] = [];
      while (i < lines.length) {
        const curr = lines[i].trim();
        if (!curr.startsWith('- ') && !curr.startsWith('* ')) break;
        const textContent = curr.replace(/^[-*]\s+/, '');
        items.push({ raw: textContent });
        i++;
      }
      blocks.push({ type: 'bullet-list', items });
      continue;
    }

    // Regular paragraph (accumulate consecutive non-empty lines that aren't headings or lists)
    const paraLines: string[] = [];
    while (i < lines.length) {
      const curr = lines[i].trim();
      if (!curr || curr.startsWith('#') || curr.match(/^\d+\.\s+/) || curr.startsWith('- ') || curr.startsWith('* ')) {
        break;
      }
      paraLines.push(curr);
      i++;
    }
    if (paraLines.length > 0) {
      blocks.push({ type: 'paragraph', text: paraLines.join(' ') });
    }
  }

  return blocks;
}

export function NewsArticle() {
  const { slug } = useParams<{ slug: string }>();
  const { notify } = useToast();
  const initialArticle = slug ? getNewsArticleBySlug(slug) : undefined;
  const [article, setArticle] = useState<NewsArticleItem | undefined>(initialArticle);
  const [loading, setLoading] = useState(!initialArticle);
  const [scrollProgress, setScrollProgress] = useState(0);

  useEffect(() => {
    if (!slug) return;
    const found = getNewsArticleBySlug(slug);
    if (found) {
      setArticle(found);
      setLoading(false);
      return;
    }

    setLoading(true);
    const normalizedSlug = slug.replace(/--+/g, '-').replace(/-+$/, '');
    Promise.all([
      fetch('/editorial.json').then((r) => (r.ok ? r.json() : [])).catch(() => []),
      fetch('/news-feed.json').then((r) => (r.ok ? r.json() : [])).catch(() => []),
    ]).then(([editorials, liveFeed]) => {
      if (Array.isArray(editorials)) {
        const match = editorials.find((e: any) => e.slug === slug || e.slug === normalizedSlug);
        if (match) {
          setArticle(match);
          setLoading(false);
          return;
        }
      }
      if (Array.isArray(liveFeed)) {
        const match = liveFeed.find((l: any) => l.slug === slug || l.slug === normalizedSlug);
        if (match) {
          setArticle(convertLiveNewsToArticle(match));
          setLoading(false);
          return;
        }
      }
      setLoading(false);
    }).catch(() => {
      setLoading(false);
    });
  }, [slug]);

  useEffect(() => {
    const onScroll = () => {
      const totalHeight = document.documentElement.scrollHeight - window.innerHeight;
      if (totalHeight > 0) {
        const progress = Math.min(100, Math.max(0, (window.scrollY / totalHeight) * 100));
        setScrollProgress(progress);
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Extract FAQs if present for Google FAQPage Rich Results Schema
  const faqEntities: Array<{ '@type': 'Question'; name: string; acceptedAnswer: { '@type': 'Answer'; text: string } }> = [];
  if (article) {
    const faqSection = article.content.match(/### Frequently Asked Questions[\s\S]*?(?=###|$)/i);
    if (faqSection) {
      const qBlocks = faqSection[0].split(/- \*\*(.*?)\*\*/g);
      for (let j = 1; j < qBlocks.length; j += 2) {
        const question = (qBlocks[j] || '').replace(/\?$/, '').trim() + '?';
        const answer = (qBlocks[j + 1] || '').trim();
        if (question.length > 5 && answer.length > 5) {
          faqEntities.push({
            '@type': 'Question',
            name: question,
            acceptedAnswer: {
              '@type': 'Answer',
              text: answer,
            },
          });
        }
      }
    }
  }

  useSEO({
    title: article ? `${article.title} | AniHubStream News` : 'Article Not Found | AniHubStream',
    description: article ? article.excerpt : 'The requested article could not be found.',
    image: article ? (article.coverImage.startsWith('http') ? article.coverImage : `https://anihubstream.com${article.coverImage}`) : undefined,
    imageAlt: article ? `${article.title} — Official Visual` : undefined,
    type: 'article',
    publishedTime: article ? `${article.date}T10:00:00+00:00` : undefined,
    author: article ? article.author : undefined,
    jsonLd: article
      ? {
          '@context': 'https://schema.org',
          '@graph': [
            {
              '@type': 'NewsArticle',
              headline: article.title,
              description: article.excerpt,
              articleSection: article.category,
              keywords: article.tags?.join(', ') || 'anime news, anime stream, anihubstream',
              inLanguage: 'en-US',
              image: [article.coverImage.startsWith('http') ? article.coverImage : `https://anihubstream.com${article.coverImage}`],
              datePublished: `${article.date}T10:00:00+00:00`,
              dateModified: `${article.date}T10:00:00+00:00`,
              author: [
                {
                  '@type': 'Person',
                  name: article.author,
                  jobTitle: article.authorRole,
                  url: 'https://anihubstream.com/about#editorial',
                },
              ],
              publisher: {
                '@type': 'Organization',
                name: 'AniHubStream',
                url: 'https://anihubstream.com',
                logo: {
                  '@type': 'ImageObject',
                  url: 'https://anihubstream.com/og.png',
                  width: 1200,
                  height: 630,
                },
              },
              mainEntityOfPage: {
                '@type': 'WebPage',
                '@id': `https://anihubstream.com/news/${article.slug}`,
              },
              ...(article.relatedAnimeSlugs?.length
                ? {
                    about: article.relatedAnimeSlugs.map((slug) => ({
                      '@type': 'Thing',
                      name: slug,
                      url: `https://anihubstream.com/anime/${slug}`,
                    })),
                    mentions: article.relatedAnimeSlugs.map((slug) => ({
                      '@type': 'Thing',
                      name: slug,
                      url: `https://anihubstream.com/anime/${slug}`,
                    })),
                  }
                : {}),
            },
            {
              '@type': 'BreadcrumbList',
              itemListElement: [
                { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://anihubstream.com/' },
                { '@type': 'ListItem', position: 2, name: 'Anime News', item: 'https://anihubstream.com/news' },
                { '@type': 'ListItem', position: 3, name: article.title, item: `https://anihubstream.com/news/${article.slug}` },
              ],
            },
            ...(faqEntities.length > 0
              ? [
                  {
                    '@type': 'FAQPage',
                    mainEntity: faqEntities,
                  },
                ]
              : []),
          ],
        }
      : undefined,
  });

  if (loading && !article) {
    return (
      <div className="page shell" style={{ padding: '80px 0', textAlign: 'center', color: 'rgba(255,255,255,0.7)' }}>
        <div style={{ display: 'inline-block', width: 32, height: 32, border: '3px solid rgba(255,255,255,0.2)', borderTopColor: 'var(--crimson)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
        <p style={{ marginTop: 16, fontSize: '1.05rem' }}>Loading anime article...</p>
      </div>
    );
  }

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

  const handleShare = async () => {
    const shareData = {
      title: article.title,
      text: article.excerpt,
      url: window.location.href,
    };
    if (navigator.share && navigator.canShare && navigator.canShare(shareData)) {
      try {
        await navigator.share(shareData);
        return;
      } catch (err: any) {
        if (err.name === 'AbortError') return;
      }
    }
    if (navigator.clipboard) {
      navigator.clipboard.writeText(window.location.href);
      notify('Article link copied to clipboard!');
    }
  };

  const handleCopyReddit = () => {
    if (article?.social?.reddit && navigator.clipboard) {
      const text = `${article.social.reddit.title}\n\n${article.social.reddit.markdown}`;
      navigator.clipboard.writeText(text);
      notify('Reddit discussion post copied to clipboard!');
    }
  };

  const handleCopyTwitter = () => {
    if (article?.social?.twitter && navigator.clipboard) {
      const text = `${article.social.twitter.hook}\n\nRead more: https://anihubstream.com/news/${article.slug}\n\n${article.social.twitter.tags.join(' ')}`;
      navigator.clipboard.writeText(text);
      notify('Twitter / X post copied to clipboard!');
    }
  };

  const related = getAllNewsArticles().filter((a) => a.slug !== article.slug).slice(0, 3);

  // Picture Logic: Resolve anime mentioned in article or metadata
  const explicitAnime = (article.relatedAnimeSlugs || [])
    .map((s) => resolveAnime(s))
    .filter((a): a is NonNullable<typeof a> => Boolean(a));

  const textAnime = findAnimeInText(article.content);
  const allMentionedAnime = Array.from(new Map([...explicitAnime, ...textAnime].map((a) => [a.slug, a])).values());

  // Structured Block Parser for Rankings, Lists, Headings, and Spotlights
  const blocks = parseArticleBlocks(article.content);

  return (
    <article className="page news-article-view shell">
      <div
        className="news-reading-progress"
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          height: 3,
          width: `${scrollProgress}%`,
          background: 'linear-gradient(90deg, var(--crimson), var(--cyan))',
          zIndex: 9999,
          transition: 'width 0.1s linear',
          pointerEvents: 'none',
        }}
        aria-hidden="true"
      />
      <div className="article-hero">
        <nav className="article-breadcrumb" aria-label="Breadcrumb">
          <Link to="/">Home</Link>
          <span>/</span>
          <Link to="/news">News</Link>
          <span>/</span>
          <span style={{ color: 'rgba(255,255,255,0.9)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '300px' }}>
            {article.title}
          </span>
        </nav>

        {article.badge && (
          <div style={{ marginTop: 8, marginBottom: 8 }}>
            <span
              style={{
                display: 'inline-block',
                background: 'rgba(36, 211, 238, 0.15)',
                color: 'var(--cyan)',
                border: '1px solid rgba(36, 211, 238, 0.35)',
                padding: '4px 12px',
                borderRadius: 'var(--r-xs)',
                fontSize: '0.75rem',
                fontWeight: 700,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
              }}
            >
              {article.badge}
            </span>
          </div>
        )}

        <h1 className="article-header__title">{article.title}</h1>

        <div className="article-header__meta" style={{ flexWrap: 'wrap', gap: 12 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <User size={15} style={{ color: 'var(--crimson)' }} />
            <b>{article.author}</b> ({article.authorRole})
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Calendar size={15} />
            <time dateTime={`${article.date}T10:00:00Z`}>{article.date}</time>
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Clock size={15} />
            {article.readTime}
          </span>
          
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {article.social?.reddit && (
              <button
                type="button"
                onClick={handleCopyReddit}
                className="btn btn--xs btn--ghost"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  color: 'var(--orange)',
                  borderColor: 'rgba(249, 115, 22, 0.3)',
                }}
                title="Copy ready-to-post Reddit discussion Markdown"
              >
                Copy Reddit Post
              </button>
            )}
            {article.social?.twitter && (
              <button
                type="button"
                onClick={handleCopyTwitter}
                className="btn btn--xs btn--ghost"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  color: 'var(--cyan)',
                  borderColor: 'rgba(36, 211, 238, 0.3)',
                }}
                title="Copy ready-to-post Twitter / X thread hook"
              >
                Copy Twitter Hook
              </button>
            )}
            <button
              type="button"
              onClick={handleShare}
              className="btn btn--xs btn--ghost"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              aria-label="Share article link"
            >
              <Share2 size={14} /> Share
            </button>
          </div>
        </div>

        <div className="article-cover-wrap">
          <img
            src={article.coverImage}
            alt={article.title}
            className="article-cover"
            width={1200}
            height={675}
            loading="eager"
            decoding="async"
            onError={(e) => {
              const target = e.currentTarget;
              if (!target.getAttribute('data-fallback-tried')) {
                target.setAttribute('data-fallback-tried', 'true');
                target.src = '/images/banners/banner-spring-2026.jpg';
              }
            }}
          />
        </div>
      </div>

      <div className="article-content" style={{ margin: '0 auto' }}>
        {/* Render Lead Blocks (H1/H2 intro & opening paragraph) first so lede is above fold */}
        {blocks.slice(0, Math.min(2, blocks.length)).map((block, idx) => {
          if (block.type === 'h3') {
            return (
              <div key={idx} style={{ marginTop: 28, marginBottom: 14 }}>
                <h3>{block.text}</h3>
                {block.matchedAnime && (
                  <AnimeSpotlightCard
                    anime={block.matchedAnime}
                    variant="inline-banner"
                    subtitle={`Featured in this section: Stream ${block.matchedAnime.title} with high-definition multi-source playback, synchronized subtitles, and zero ad takeovers on AniHubStream.`}
                  />
                )}
              </div>
            );
          }
          if (block.type === 'h2') {
            return <h2 key={idx}>{block.text}</h2>;
          }
          if (block.type === 'paragraph') {
            return (
              <p
                key={idx}
                dangerouslySetInnerHTML={{ __html: renderMarkdown(block.text || '') }}
              />
            );
          }
          return null;
        })}

        {/* Featured Series Showcase Bar (Positioned below the Lede so answers are first) */}
        {allMentionedAnime.length > 0 && (
          <section className="mentioned-anime-section">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.98rem', fontWeight: 800, color: '#fff', margin: 0 }}>
                <Film size={18} style={{ color: 'var(--crimson)' }} />
                Featured Anime In This Guide ({allMentionedAnime.length})
              </h2>
              <span style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.5)' }}>
                Click any series to start streaming in 1080p
              </span>
            </div>

            <div className="mentioned-anime-grid">
              {allMentionedAnime.map((anime) => {
                const fallback = anime.fallbackArt || '/art/poster-shadow-hunter.jpg';
                return (
                  <Link
                    key={anime.slug}
                    to={anime.streamUrl}
                    className="mentioned-anime-card"
                    title={`Stream ${anime.title} on AniHub`}
                  >
                    <img
                      src={anime.art}
                      alt={anime.title}
                      className="mentioned-anime-card__poster"
                      loading="lazy"
                      decoding="async"
                      referrerPolicy="no-referrer"
                      onError={(e) => {
                        if (e.currentTarget.src !== fallback) {
                          e.currentTarget.src = fallback;
                        }
                      }}
                    />
                    <div className="mentioned-anime-card__info">
                      <span className="mentioned-anime-card__title">{anime.title}</span>
                      <span className="mentioned-anime-card__sub">
                        <Star size={11} fill="currentColor" style={{ color: 'var(--gold)' }} />
                        {anime.rating} • {anime.format}
                      </span>
                      <span style={{ fontSize: '0.72rem', color: 'var(--crimson-soft)', display: 'inline-flex', alignItems: 'center', gap: 3, fontWeight: 700, marginTop: 2 }}>
                        <Play size={10} fill="currentColor" /> Stream Now
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        )}

        {/* Structured Article Blocks (Remaining Content) */}
        {blocks.slice(Math.min(2, blocks.length)).map((block, idx) => {
          if (block.type === 'h3') {
            return (
              <div key={idx} style={{ marginTop: 28, marginBottom: 14 }}>
                <h3>{block.text}</h3>
                {block.matchedAnime && (
                  <AnimeSpotlightCard
                    anime={block.matchedAnime}
                    variant="inline-banner"
                    subtitle={`Featured in this section: Stream ${block.matchedAnime.title} with high-definition multi-source playback, synchronized subtitles, and zero ad takeovers on AniHubStream.`}
                  />
                )}
              </div>
            );
          }

          if (block.type === 'h2') {
            return <h2 key={idx}>{block.text}</h2>;
          }

          if (block.type === 'numbered-list') {
            return (
              <ol key={idx} className="article-numbered-list">
                {block.items?.map((item, itemIdx) => (
                  <li key={itemIdx} className="article-numbered-item">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                        <strong style={{ fontSize: '1.05rem', color: '#fff' }}>
                          {item.title || item.raw}
                        </strong>
                        {item.matchedAnime && (
                          <Link
                            to={item.matchedAnime.streamUrl}
                            className="btn btn--xs btn--primary"
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px', fontSize: '0.74rem' }}
                            title={`Stream ${item.matchedAnime.title}`}
                          >
                            <Play size={10} fill="currentColor" /> Stream on AniHub
                          </Link>
                        )}
                      </div>
                      {item.body && (
                        <p style={{ margin: 0, color: 'rgba(255, 255, 255, 0.8)', fontSize: '0.94rem', lineHeight: 1.6 }}>
                          {item.body}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            );
          }

          if (block.type === 'bullet-list') {
            return (
              <ul key={idx} className="article-bullet-list">
                {block.items?.map((item, itemIdx) => (
                  <li
                    key={itemIdx}
                    dangerouslySetInnerHTML={{
                      __html: renderMarkdown(item.raw),
                    }}
                  />
                ))}
              </ul>
            );
          }

          return (
            <p
              key={idx}
              dangerouslySetInnerHTML={{
                __html: renderMarkdown(block.text || ''),
              }}
            />
          );
        })}

        {/* Tags */}
        <div className="article-tags">
          <Tag size={15} style={{ color: 'var(--cyan)', marginRight: 4, alignSelf: 'center' }} />
          {article.tags.map((t) => (
            <Link key={t} to={`/anime?search=${encodeURIComponent(t)}`} className="article-tag" title={`Search for ${t} on AniHub`}>
              #{t}
            </Link>
          ))}
        </div>

        {/* Target Semantic & LSI Queries (GEO Citation Discovery) */}
        {article.targetKeywords && article.targetKeywords.length > 0 && (
          <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)', fontWeight: 600, textTransform: 'uppercase' }}>
              Semantic Search Clusters:
            </span>
            {article.targetKeywords.map((kw) => (
              <span
                key={kw}
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  color: 'rgba(255,255,255,0.7)',
                  fontSize: '0.75rem',
                  padding: '2px 8px',
                  borderRadius: 'var(--r-xs)',
                }}
              >
                {kw}
              </span>
            ))}
          </div>
        )}

        {/* Backlink & Internal Streaming Call-to-Action */}
        <div
          style={{
            marginTop: 36,
            padding: 24,
            background: 'linear-gradient(135deg, rgba(255, 31, 74, 0.1) 0%, rgba(36, 211, 238, 0.1) 100%)',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            borderRadius: 'var(--r-lg)',
            boxShadow: '0 12px 28px rgba(0,0,0,0.3)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <Sparkles size={20} style={{ color: 'var(--cyan)' }} />
            <h3 style={{ margin: 0, fontSize: '1.15rem', color: '#fff', fontWeight: 800 }}>
              Ready to Stream on AniHubStream?
            </h3>
          </div>
          <p style={{ margin: '0 0 16px 0', fontSize: '0.92rem', color: 'rgba(255,255,255,0.8)', lineHeight: 1.6 }}>
            Stream all featured episodes in high-definition 1080p with subbed and dubbed audio, accurate schedules, skip-intro markers, and community ratings.
          </p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Link to="/anime" className="btn btn--sm btn--primary" style={{ fontWeight: 700 }}>
              Browse Anime Catalogue
            </Link>
            <Link to="/schedule" className="btn btn--sm btn--ghost">
              Check Airing Schedule
            </Link>
          </div>
        </div>
      </div>

      {/* Related Articles with Anime Chips */}
      {related.length > 0 && (
        <section style={{ marginTop: 60, paddingTop: 30, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <h2 style={{ fontSize: '1.3rem', marginBottom: 20, color: '#fff' }}>More Anime Guides</h2>
          <div className="news-grid">
            {related.map((rel) => {
              const relEntities = (rel.relatedAnimeSlugs || [])
                .map((s) => resolveAnime(s))
                .filter((a): a is NonNullable<typeof a> => Boolean(a));

              return (
                <article key={rel.slug} className="news-card">
                  <Link to={`/news/${rel.slug}`} className="news-card__thumb-link">
                    <img src={rel.coverImage} alt={rel.title} className="news-card__thumb" width={400} height={225} loading="lazy" />
                    <span className="news-card__category">{rel.category}</span>
                  </Link>
                  <div className="news-card__body">
                    <h3 className="news-card__title" style={{ fontSize: '1rem', lineHeight: 1.4 }}>
                      <Link to={`/news/${rel.slug}`}>{rel.title}</Link>
                    </h3>
                    <p className="news-card__excerpt">{rel.excerpt}</p>

                    {relEntities.length > 0 && (
                      <div style={{ margin: '10px 0 14px 0', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {relEntities.slice(0, 2).map((a) => (
                          <AnimeSpotlightCard key={a.slug} anime={a} variant="compact-chip" />
                        ))}
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}
    </article>
  );
}
