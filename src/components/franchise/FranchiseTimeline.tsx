import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Calendar, Film, GitCommit, LayoutGrid, ListOrdered, Star } from 'lucide-react';
import type { AnimeSeasonItem } from '../../data/model';

interface FranchiseTimelineProps {
  seasons: AnimeSeasonItem[];
  currentAnimeId: string;
  className?: string;
}

export function FranchiseTimeline({
  seasons,
  currentAnimeId,
  className = '',
}: FranchiseTimelineProps) {
  const [viewMode, setViewMode] = useState<'timeline' | 'grid'>('timeline');

  if (!seasons || seasons.length <= 1) return null;

  const getRelationBadge = (item: AnimeSeasonItem) => {
    if (item.isCurrent || item.id === currentAnimeId) {
      return { label: 'Now Viewing', bg: 'rgba(99, 102, 241, 0.25)', border: '#6366f1', color: '#c7d2fe' };
    }
    const rel = (item.relationType || '').toLowerCase();
    if (rel === 'movie' || (item.kind || '').toLowerCase() === 'movie') {
      return { label: 'Movie', bg: 'rgba(59, 130, 246, 0.2)', border: '#3b82f6', color: '#93c5fd' };
    }
    if (rel === 'prequel') {
      return { label: 'Prequel', bg: 'rgba(245, 158, 11, 0.2)', border: '#f59e0b', color: '#fde68a' };
    }
    if (rel === 'side_story' || rel === 'spin_off') {
      return { label: 'Side Story', bg: 'rgba(2, 132, 199, 0.2)', border: '#0284c7', color: '#bae6fd' };
    }
    return { label: 'Sequel', bg: 'rgba(16, 185, 129, 0.2)', border: '#10b981', color: '#a7f3d0' };
  };

  return (
    <section className={`franchise-timeline ${className}`} style={{ marginTop: '2.5rem' }}>
      {/* Header with Title and Mode Switcher */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '1.25rem',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <GitCommit size={20} style={{ color: 'var(--brand, #6366f1)' }} />
          <h2 style={{ fontSize: '1.35rem', fontWeight: 700, margin: 0, color: '#f8fafc' }}>
            Franchise Chronology & Release Order
          </h2>
          <span
            style={{
              fontSize: '0.75rem',
              padding: '2px 8px',
              borderRadius: '999px',
              background: 'rgba(255, 255, 255, 0.08)',
              color: '#94a3b8',
              fontWeight: 600,
            }}
          >
            {seasons.length} Titles
          </span>
        </div>

        {/* View Switcher Toggle */}
        <div
          style={{
            display: 'flex',
            background: 'rgba(255, 255, 255, 0.04)',
            padding: '3px',
            borderRadius: '8px',
            border: '1px solid rgba(255, 255, 255, 0.08)',
          }}
        >
          <button
            type="button"
            onClick={() => setViewMode('timeline')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 10px',
              borderRadius: '6px',
              fontSize: '0.78rem',
              fontWeight: viewMode === 'timeline' ? 600 : 500,
              background: viewMode === 'timeline' ? 'rgba(99, 102, 241, 0.3)' : 'transparent',
              color: viewMode === 'timeline' ? '#fff' : '#94a3b8',
              border: viewMode === 'timeline' ? '1px solid var(--brand, #6366f1)' : 'none',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            <ListOrdered size={14} />
            <span>Timeline</span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode('grid')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 10px',
              borderRadius: '6px',
              fontSize: '0.78rem',
              fontWeight: viewMode === 'grid' ? 600 : 500,
              background: viewMode === 'grid' ? 'rgba(99, 102, 241, 0.3)' : 'transparent',
              color: viewMode === 'grid' ? '#fff' : '#94a3b8',
              border: viewMode === 'grid' ? '1px solid var(--brand, #6366f1)' : 'none',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            <LayoutGrid size={14} />
            <span>Grid</span>
          </button>
        </div>
      </div>

      {/* Visual Timeline View */}
      {viewMode === 'timeline' ? (
        <div
          style={{
            position: 'relative',
            paddingLeft: '24px',
            marginLeft: '8px',
            borderLeft: '2px dashed rgba(99, 102, 241, 0.35)',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
          }}
        >
          {seasons.map((item, index) => {
            const isCurrent = item.isCurrent || item.id === currentAnimeId;
            const badge = getRelationBadge(item);
            const posterSrc = item.poster || '/art/hero-demon.jpg';

            return (
              <div
                key={item.id}
                style={{
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'stretch',
                }}
              >
                {/* Timeline Node Bullet */}
                <div
                  style={{
                    position: 'absolute',
                    left: '-31px',
                    top: '16px',
                    width: '14px',
                    height: '14px',
                    borderRadius: '50%',
                    background: isCurrent ? 'var(--brand, #6366f1)' : '#1e293b',
                    border: isCurrent
                      ? '3px solid #fff'
                      : '2px solid rgba(99, 102, 241, 0.6)',
                    boxShadow: isCurrent ? '0 0 12px var(--brand, #6366f1)' : 'none',
                    zIndex: 2,
                  }}
                />

                {/* Card Container */}
                <Link
                  to={isCurrent ? '#' : `/anime/${item.id}`}
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '16px',
                    padding: '12px 16px',
                    borderRadius: '10px',
                    background: isCurrent
                      ? 'linear-gradient(90deg, rgba(99, 102, 241, 0.15) 0%, rgba(255, 255, 255, 0.03) 100%)'
                      : 'rgba(255, 255, 255, 0.03)',
                    border: isCurrent
                      ? '1.5px solid var(--brand, #6366f1)'
                      : '1px solid rgba(255, 255, 255, 0.08)',
                    textDecoration: 'none',
                    transition: 'all 0.2s ease',
                    boxShadow: isCurrent ? '0 4px 20px rgba(99, 102, 241, 0.15)' : 'none',
                  }}
                  onMouseEnter={(e) => {
                    if (!isCurrent) {
                      e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)';
                      e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.2)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isCurrent) {
                      e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
                      e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.08)';
                    }
                  }}
                >
                  {/* Step Order Number */}
                  <div
                    style={{
                      fontSize: '0.85rem',
                      fontWeight: 800,
                      color: isCurrent ? '#a5b4fc' : '#64748b',
                      minWidth: '24px',
                      textAlign: 'center',
                    }}
                  >
                    #{index + 1}
                  </div>

                  {/* Artwork Poster */}
                  <div
                    style={{
                      width: '48px',
                      height: '68px',
                      borderRadius: '6px',
                      overflow: 'hidden',
                      flexShrink: 0,
                      background: '#0f172a',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
                    }}
                  >
                    <img
                      src={posterSrc}
                      alt={item.title}
                      loading="lazy"
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                      }}
                      onError={(e) => {
                        (e.target as HTMLElement).style.display = 'none';
                      }}
                    />
                  </div>

                  {/* Info Column */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '4px' }}>
                      <span
                        style={{
                          fontSize: '0.7rem',
                          fontWeight: 700,
                          padding: '2px 8px',
                          borderRadius: '4px',
                          background: badge.bg,
                          border: `1px solid ${badge.border}`,
                          color: badge.color,
                        }}
                      >
                        {badge.label}
                      </span>

                      {item.kind && (
                        <span
                          style={{
                            fontSize: '0.7rem',
                            fontWeight: 600,
                            padding: '1px 6px',
                            borderRadius: '4px',
                            background: 'rgba(255, 255, 255, 0.06)',
                            color: '#94a3b8',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                          }}
                        >
                          <Film size={11} />
                          {item.kind}
                        </span>
                      )}

                      {item.year ? (
                        <span
                          style={{
                            fontSize: '0.72rem',
                            color: '#94a3b8',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '3px',
                          }}
                        >
                          <Calendar size={11} />
                          {item.year}
                        </span>
                      ) : null}

                      {item.rating ? (
                        <span
                          style={{
                            fontSize: '0.72rem',
                            color: '#fbbf24',
                            fontWeight: 600,
                            display: 'flex',
                            alignItems: 'center',
                            gap: '3px',
                          }}
                        >
                          <Star size={11} fill="#fbbf24" />
                          {item.rating.toFixed(1)}
                        </span>
                      ) : null}
                    </div>

                    <h3
                      style={{
                        fontSize: '0.95rem',
                        fontWeight: isCurrent ? 700 : 600,
                        color: isCurrent ? '#fff' : '#e2e8f0',
                        margin: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {item.title}
                    </h3>
                  </div>
                </Link>
              </div>
            );
          })}
        </div>
      ) : (
        /* Compact Grid View */
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: '12px',
          }}
        >
          {seasons.map((item, index) => {
            const isCurrent = item.isCurrent || item.id === currentAnimeId;
            const badge = getRelationBadge(item);
            const posterSrc = item.poster || '/art/hero-demon.jpg';

            return (
              <Link
                key={item.id}
                to={isCurrent ? '#' : `/anime/${item.id}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '10px',
                  borderRadius: '8px',
                  textDecoration: 'none',
                  background: isCurrent ? 'rgba(99, 102, 241, 0.2)' : 'rgba(255, 255, 255, 0.04)',
                  border: isCurrent
                    ? '1.5px solid var(--brand, #6366f1)'
                    : '1px solid rgba(255, 255, 255, 0.08)',
                  transition: 'all 0.15s ease',
                }}
              >
                <div
                  style={{
                    width: '40px',
                    height: '56px',
                    borderRadius: '4px',
                    overflow: 'hidden',
                    flexShrink: 0,
                    background: '#0f172a',
                  }}
                >
                  <img
                    src={posterSrc}
                    alt={item.title}
                    loading="lazy"
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
                    <span style={{ fontSize: '0.65rem', color: '#64748b', fontWeight: 700 }}>#{index + 1}</span>
                    <span
                      style={{
                        fontSize: '0.65rem',
                        padding: '1px 5px',
                        borderRadius: '3px',
                        background: badge.bg,
                        color: badge.color,
                        fontWeight: 600,
                      }}
                    >
                      {badge.label}
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: '0.85rem',
                      fontWeight: isCurrent ? 700 : 500,
                      color: isCurrent ? '#fff' : '#cbd5e1',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {item.title}
                  </div>
                  {item.year && <span style={{ fontSize: '0.72rem', color: '#64748b' }}>{item.year}</span>}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
