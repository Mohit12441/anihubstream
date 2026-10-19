import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Film, Play, Server } from 'lucide-react';

export interface ProviderSearchResult {
  id: string;
  slug: string;
  title: string;
  coverUrl: string | null;
  provider: string;
}

export interface ProviderMeta {
  name: string;
  badge: string;
  color: string;
}

interface ProviderRowProps {
  providerKey: string;
  meta: ProviderMeta;
  items: ProviderSearchResult[];
}

export function ProviderRow({ providerKey, meta, items }: ProviderRowProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const scroll = (direction: 'left' | 'right') => {
    if (scrollRef.current) {
      const offset = direction === 'left' ? -380 : 380;
      scrollRef.current.scrollBy({ left: offset, behavior: 'smooth' });
    }
  };

  if (!items || items.length === 0) return null;

  return (
    <section className="provider-row-section" style={{ marginBottom: '36px' }}>
      {/* Provider Header with Controls */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '16px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Server size={18} style={{ color: meta.color }} />
          <h2 style={{ fontSize: '1.25rem', fontWeight: 600, color: '#f8fafc', margin: 0 }}>
            {meta.name}
          </h2>
          <span
            style={{
              fontSize: '0.7rem',
              fontWeight: 600,
              padding: '2px 8px',
              borderRadius: '9999px',
              background: `${meta.color}25`,
              color: meta.color,
              border: `1px solid ${meta.color}40`,
            }}
          >
            {meta.badge}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
            {items.length} {items.length === 1 ? 'result' : 'results'}
          </span>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button
              type="button"
              onClick={() => scroll('left')}
              aria-label={`Scroll ${meta.name} left`}
              style={{
                background: 'rgba(255, 255, 255, 0.06)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '50%',
                width: '30px',
                height: '30px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#cbd5e1',
                cursor: 'pointer',
                transition: 'background 0.2s',
              }}
            >
              <ChevronLeft size={16} />
            </button>
            <button
              type="button"
              onClick={() => scroll('right')}
              aria-label={`Scroll ${meta.name} right`}
              style={{
                background: 'rgba(255, 255, 255, 0.06)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '50%',
                width: '30px',
                height: '30px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#cbd5e1',
                cursor: 'pointer',
                transition: 'background 0.2s',
              }}
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* Horizontal Scrolling Row */}
      <div
        ref={scrollRef}
        style={{
          display: 'flex',
          gap: '16px',
          overflowX: 'auto',
          scrollSnapType: 'x mandatory',
          paddingBottom: '12px',
          scrollbarWidth: 'thin',
          scrollbarColor: 'rgba(255, 255, 255, 0.15) transparent',
          WebkitOverflowScrolling: 'touch',
        }}
        className="provider-row-scroll"
      >
        {items.map((item) => (
          <Link
            key={`${providerKey}-${item.id}`}
            to={`/watch/${encodeURIComponent(item.slug || item.id)}/1?provider=${encodeURIComponent(providerKey)}&title=${encodeURIComponent(item.title)}${item.coverUrl ? `&poster=${encodeURIComponent(item.coverUrl)}` : ''}`}
            style={{
              flex: '0 0 170px',
              maxWidth: '170px',
              scrollSnapAlign: 'start',
              display: 'flex',
              flexDirection: 'column',
              background: 'rgba(255, 255, 255, 0.03)',
              borderRadius: '10px',
              overflow: 'hidden',
              border: '1px solid rgba(255, 255, 255, 0.06)',
              textDecoration: 'none',
              color: 'inherit',
              transition: 'transform 0.15s ease, border-color 0.15s ease',
            }}
            className="search-card"
          >
            <div style={{ position: 'relative', width: '100%', aspectRatio: '3 / 4', background: '#1e293b' }}>
              {item.coverUrl ? (
                <img
                  src={item.coverUrl}
                  alt={item.title}
                  loading="lazy"
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              ) : (
                <div
                  style={{
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#64748b',
                  }}
                >
                  <Film size={32} />
                </div>
              )}
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: 'rgba(0,0,0,0.35)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: 0,
                  transition: 'opacity 0.2s ease',
                }}
                className="search-card__hover"
              >
                <Play size={36} style={{ color: '#fff' }} />
              </div>
            </div>

            <div style={{ padding: '10px' }}>
              <div
                style={{
                  fontSize: '0.9rem',
                  fontWeight: 600,
                  color: '#f1f5f9',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  marginBottom: '4px',
                }}
                title={item.title}
              >
                {item.title}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                via {meta.name}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
