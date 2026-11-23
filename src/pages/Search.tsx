import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Film,
  LayoutGrid,
  List,
  Play,
  Search as SearchIcon,
  Sparkles,
  Star,
  X,
} from 'lucide-react';
import { useSEO } from '../lib/useSEO';
import { useToast } from '../lib/Toast';
import { ProviderRow, type ProviderSearchResult } from '../components/search/ProviderRow';
import { searchFederated } from '../data/api';
import { getCleanWatchUrl } from '../data/servers';
import '../styles/pages.css';

export interface SearchProviderBadge {
  id: string;
  name: string;
  slug: string;
  badge: string;
  color: string;
  icon?: string;
}

export interface SearchAnimeItem {
  id: string;
  slug: string;
  title: string;
  native?: string;
  art: string;
  keyArt?: string;
  coverUrl?: string;
  rating: number;
  year?: number | null;
  kind?: string;
  format?: string;
  status?: string;
  episodeTotal?: number;
  genres: string[];
  providers?: SearchProviderBadge[];
}

interface FederatedSearchResponse {
  query: string;
  total: number;
  count: number;
  results?: SearchAnimeItem[];
  providers?: Record<string, ProviderSearchResult[]>;
  source?: string;
}

const POPULAR_SEARCHES = [
  'Frieren',
  'Solo Leveling',
  'One Piece',
  'Demon Slayer',
  'Jujutsu Kaisen',
  'Chainsaw Man',
  'Attack on Titan',
  'Naruto',
  'Bleach',
];

const PROVIDER_METAS: Record<string, { name: string; badge: string; color: string }> = {
  anikoto: { name: 'AniKoto', badge: 'HLS 1080p', color: '#6366f1' },
  hianime: { name: 'HiAnime', badge: 'Multi-Quality', color: '#ec4899' },
  aniwatch: { name: 'AniWatch', badge: 'Megaplay', color: '#3b82f6' },
  anipm: { name: 'AniPM', badge: 'Settlar HLS', color: '#8b5cf6' },
  hdrezka: { name: 'HDRezka', badge: 'Ultra MP4', color: '#f59e0b' },
  animesalt: { name: 'AnimeSalt', badge: 'Multi-Audio', color: '#06b6d4' },
};

// In-memory instant cache for sub-millisecond query recovery
const searchCache = new Map<string, FederatedSearchResponse>();

export function Search() {
  const [params, setParams] = useSearchParams();
  const query = params.get('q') || '';
  const { notify } = useToast();

  const [term, setTerm] = useState(query);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<FederatedSearchResponse | null>(() => searchCache.get(query.trim()) || null);

  // Filters State (Clean & focused on anime metadata, zero server options)
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'trending' | 'rating' | 'year'>('trending');
  const [viewMode, setViewMode] = useState<'grid' | 'shelves'>('grid');

  useSEO({
    title: query ? `Search results for "${query}" | AniHubStream` : 'Search Anime — Free Anime Streaming | AniHubStream',
    description: 'Search thousands of subbed and dubbed anime series and movies with instant HD streaming on AniHubStream.',
    noindex: true,
  });

  // Keep input in sync with URL
  useEffect(() => {
    setTerm(query);
  }, [query]);

  // Debounce search input (180ms) for snappy auto-updating URL
  useEffect(() => {
    const trimmed = term.trim();
    if (trimmed === query) return;

    const timer = setTimeout(() => {
      if (trimmed) {
        setParams({ q: trimmed }, { replace: true });
      } else {
        setParams({}, { replace: true });
      }
    }, 180);

    return () => clearTimeout(timer);
  }, [term, query, setParams]);

  // Fetch search data with memory cache & AbortController
  useEffect(() => {
    const activeQuery = query.trim();
    if (!activeQuery) {
      setData(null);
      setLoading(false);
      return;
    }

    // Hit in-memory cache instantly
    if (searchCache.has(activeQuery)) {
      setData(searchCache.get(activeQuery)!);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);

    searchFederated(activeQuery, { signal: controller.signal })
      .then((json: FederatedSearchResponse) => {
        searchCache.set(activeQuery, json);
        setData(json);
        setLoading(false);
      })
      .catch((err) => {
        if (err.name !== 'AbortError') {
          notify('Search service unreachable or timed out.');
          setLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [query, notify]);

  const handleClear = () => {
    setTerm('');
    setParams({}, { replace: true });
  };

  const handleChipClick = (t: string) => {
    setTerm(t);
    setParams({ q: t });
  };

  // Filtered & Sorted Deduplicated Anime Results
  const filteredItems = useMemo<SearchAnimeItem[]>(() => {
    if (!data?.results) return [];

    let items = [...data.results];

    // Filter by Status
    if (selectedStatus !== 'all') {
      items = items.filter(
        (item) => item.status?.toLowerCase() === selectedStatus.toLowerCase()
      );
    }

    // Sort items
    if (sortBy === 'rating') {
      items.sort((a, b) => (b.rating || 0) - (a.rating || 0));
    } else if (sortBy === 'year') {
      items.sort((a, b) => (b.year || 0) - (a.year || 0));
    }

    return items;
  }, [data?.results, selectedStatus, sortBy]);

  // Classic Grouped Providers for Shelves View
  const renderedShelves = useMemo(() => {
    if (!data?.providers) return [];
    return Object.entries(data.providers).filter(([_, items]) => items && items.length > 0);
  }, [data]);

  return (
    <div className="page search-page shell" style={{ padding: '40px 0 80px' }}>
      {/* Search Header Banner */}
      <div style={{ maxWidth: '780px', margin: '0 auto 32px', textAlign: 'center' }}>
        <h1 style={{ fontSize: '2.2rem', fontWeight: 800, marginBottom: '10px', color: '#fff', letterSpacing: '-0.02em' }}>
          Search Anime
        </h1>
        <p style={{ color: '#94a3b8', fontSize: '0.95rem', marginBottom: '24px' }}>
          Search thousands of anime series and movies with real-time metadata and instant HD streaming.
        </p>

        {/* Live Search Input with Instant Clear */}
        <div style={{ position: 'relative', width: '100%', marginBottom: '16px' }}>
          <SearchIcon
            size={19}
            style={{
              position: 'absolute',
              left: '16px',
              top: '50%',
              transform: 'translateY(-50%)',
              color: loading ? 'var(--brand, #6366f1)' : '#94a3b8',
              transition: 'color 0.2s ease',
            }}
          />
          <input
            type="search"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') handleClear();
            }}
            placeholder="Search anime by title, character, or alternate romanization..."
            style={{
              width: '100%',
              padding: '16px 46px 16px 48px',
              borderRadius: '14px',
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1.5px solid rgba(255, 255, 255, 0.12)',
              color: '#fff',
              fontSize: '1.05rem',
              outline: 'none',
              boxShadow: '0 6px 24px rgba(0,0,0,0.35)',
              transition: 'all 0.2s ease',
            }}
            autoFocus
          />
          {term ? (
            <button
              type="button"
              onClick={handleClear}
              aria-label="Clear search"
              style={{
                position: 'absolute',
                right: '16px',
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'rgba(255, 255, 255, 0.1)',
                border: 'none',
                borderRadius: '50%',
                width: '24px',
                height: '24px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#cbd5e1',
                cursor: 'pointer',
              }}
            >
              <X size={14} />
            </button>
          ) : null}
        </div>

        {/* Trending Suggestion Chips */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.8rem', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Sparkles size={13} style={{ color: 'var(--brand, #6366f1)' }} /> Trending:
          </span>
          {POPULAR_SEARCHES.map((title) => (
            <button
              key={title}
              type="button"
              onClick={() => handleChipClick(title)}
              style={{
                background: term.toLowerCase() === title.toLowerCase() ? 'rgba(99, 102, 241, 0.25)' : 'rgba(255, 255, 255, 0.04)',
                border: term.toLowerCase() === title.toLowerCase() ? '1px solid var(--brand, #6366f1)' : '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '9999px',
                padding: '4px 12px',
                fontSize: '0.78rem',
                color: term.toLowerCase() === title.toLowerCase() ? '#fff' : '#cbd5e1',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              {title}
            </button>
          ))}
        </div>
      </div>

      {/* Loading Skeleton Indicator */}
      {loading && !data && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: '20px',
            marginTop: '24px',
          }}
        >
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              style={{
                background: 'rgba(255, 255, 255, 0.03)',
                borderRadius: '12px',
                height: '340px',
                animation: 'pulse 1.5s infinite ease-in-out',
                border: '1px solid rgba(255, 255, 255, 0.05)',
              }}
            />
          ))}
        </div>
      )}

      {/* Empty State */}
      {!loading && data && data.results && data.results.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 20px', background: 'rgba(255,255,255,0.02)', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.06)' }}>
          <Film size={48} style={{ opacity: 0.3, marginBottom: '16px', color: '#94a3b8' }} />
          <h2 style={{ fontSize: '1.25rem', color: '#e2e8f0', marginBottom: '8px', fontWeight: 600 }}>No anime titles found for "{query}"</h2>
          <p style={{ color: '#94a3b8', fontSize: '0.9rem', maxWidth: '460px', margin: '0 auto' }}>
            Check spelling or try popular titles like <em>"Frieren"</em>, <em>"Solo Leveling"</em>, or <em>"One Piece"</em>.
          </p>
        </div>
      )}

      {/* Results Section */}
      {data && data.results && data.results.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {/* Clean Controls Bar (Results Count & Sort/Status Filters, Zero Server Pills) */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '16px',
              paddingBottom: '16px',
              borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            }}
          >
            {/* Results Count Summary */}
            <div style={{ fontSize: '0.92rem', color: '#94a3b8', fontWeight: 500 }}>
              Showing <span style={{ color: '#f8fafc', fontWeight: 700 }}>{filteredItems.length}</span> {filteredItems.length === 1 ? 'anime' : 'anime titles'} for <span style={{ color: 'var(--brand, #6366f1)' }}>"{query}"</span>
            </div>

            {/* Filter, Sort & View Mode Controls */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              {/* Status Filter */}
              <select
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value)}
                style={{
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '8px',
                  color: '#cbd5e1',
                  padding: '7px 12px',
                  fontSize: '0.82rem',
                  outline: 'none',
                  cursor: 'pointer',
                }}
              >
                <option value="all" style={{ background: '#0f172a' }}>All Status</option>
                <option value="ongoing" style={{ background: '#0f172a' }}>Ongoing</option>
                <option value="finished" style={{ background: '#0f172a' }}>Finished</option>
              </select>

              {/* Sort Order */}
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                style={{
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '8px',
                  color: '#cbd5e1',
                  padding: '7px 12px',
                  fontSize: '0.82rem',
                  outline: 'none',
                  cursor: 'pointer',
                }}
              >
                <option value="trending" style={{ background: '#0f172a' }}>Sort: Trending</option>
                <option value="rating" style={{ background: '#0f172a' }}>Sort: Top Rated</option>
                <option value="year" style={{ background: '#0f172a' }}>Sort: Newest Year</option>
              </select>

              {/* View Mode Toggle */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  background: 'rgba(255, 255, 255, 0.05)',
                  borderRadius: '8px',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  padding: '2px',
                }}
              >
                <button
                  type="button"
                  onClick={() => setViewMode('grid')}
                  title="Grid View"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '6px 10px',
                    borderRadius: '6px',
                    border: 'none',
                    background: viewMode === 'grid' ? 'var(--brand, #6366f1)' : 'transparent',
                    color: viewMode === 'grid' ? '#fff' : '#94a3b8',
                    cursor: 'pointer',
                    fontSize: '0.78rem',
                    fontWeight: 600,
                  }}
                >
                  <LayoutGrid size={15} /> Grid
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('shelves')}
                  title="Shelves View"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '6px 10px',
                    borderRadius: '6px',
                    border: 'none',
                    background: viewMode === 'shelves' ? 'var(--brand, #6366f1)' : 'transparent',
                    color: viewMode === 'shelves' ? '#fff' : '#94a3b8',
                    cursor: 'pointer',
                    fontSize: '0.78rem',
                    fontWeight: 600,
                  }}
                >
                  <List size={15} /> Shelves
                </button>
              </div>
            </div>
          </div>

          {/* VIEW MODE 1: Clean, Fast & High-Performance Anime Grid */}
          {viewMode === 'grid' && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                gap: '20px',
              }}
            >
              {filteredItems.map((item) => {
                const watchUrl = getCleanWatchUrl(item.slug || item.id, 1);

                return (
                  <div
                    key={item.id}
                    style={{
                      background: 'rgba(255, 255, 255, 0.03)',
                      borderRadius: '12px',
                      overflow: 'hidden',
                      border: '1px solid rgba(255, 255, 255, 0.07)',
                      display: 'flex',
                      flexDirection: 'column',
                      transition: 'transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease',
                    }}
                    className="search-grid-card"
                  >
                    {/* Card Poster with 1-Click Watch Link */}
                    <Link
                      to={watchUrl}
                      state={{ title: item.title, poster: item.art || item.coverUrl }}
                      style={{
                        position: 'relative',
                        width: '100%',
                        aspectRatio: '3 / 4.2',
                        background: '#1e293b',
                        display: 'block',
                        overflow: 'hidden',
                        textDecoration: 'none',
                      }}
                    >
                      <img
                        src={item.art || item.coverUrl || ''}
                        alt={item.title}
                        loading="lazy"
                        decoding="async"
                        referrerPolicy="no-referrer"
                        onError={(e) => {
                          const target = e.currentTarget;
                          if (!target.dataset.proxied && item.art) {
                            target.dataset.proxied = 'true';
                            target.src = `/api/img?url=${encodeURIComponent(item.art)}`;
                          }
                        }}
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover',
                          transition: 'transform 0.3s ease',
                        }}
                      />

                      {/* Top Badges (Rating & Format) */}
                      <div
                        style={{
                          position: 'absolute',
                          top: '10px',
                          left: '10px',
                          right: '10px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          pointerEvents: 'none',
                        }}
                      >
                        {item.rating > 0 ? (
                          <span
                            style={{
                              background: 'rgba(0, 0, 0, 0.75)',
                              backdropFilter: 'blur(4px)',
                              color: '#fbbf24',
                              fontSize: '0.72rem',
                              fontWeight: 700,
                              padding: '2px 7px',
                              borderRadius: '6px',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '3px',
                              border: '1px solid rgba(251, 191, 36, 0.3)',
                            }}
                          >
                            <Star size={11} fill="#fbbf24" /> {item.rating.toFixed(1)}
                          </span>
                        ) : <div />}

                        {item.format && (
                          <span
                            style={{
                              background: 'rgba(15, 23, 42, 0.85)',
                              backdropFilter: 'blur(4px)',
                              color: '#cbd5e1',
                              fontSize: '0.7rem',
                              fontWeight: 600,
                              padding: '2px 6px',
                              borderRadius: '4px',
                              border: '1px solid rgba(255, 255, 255, 0.1)',
                            }}
                          >
                            {item.format}
                          </span>
                        )}
                      </div>

                      {/* Hover Overlay Play Icon */}
                      <div
                        style={{
                          position: 'absolute',
                          inset: 0,
                          background: 'rgba(0,0,0,0.4)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          opacity: 0,
                          transition: 'opacity 0.2s ease',
                        }}
                        className="search-card__hover"
                      >
                        <Play size={40} style={{ color: '#fff' }} />
                      </div>
                    </Link>

                    {/* Card Content & Metadata */}
                    <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', flex: 1, gap: '6px' }}>
                      <Link
                        to={watchUrl}
                        style={{
                          textDecoration: 'none',
                          color: 'inherit',
                        }}
                      >
                        <h3
                          style={{
                            fontSize: '0.92rem',
                            fontWeight: 700,
                            color: '#f8fafc',
                            margin: 0,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            transition: 'color 0.15s ease',
                          }}
                          title={item.title}
                        >
                          {item.title}
                        </h3>
                      </Link>

                      {/* Year, Episodes & Status */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.75rem', color: '#94a3b8' }}>
                        {item.year && <span>{item.year}</span>}
                        {item.year && item.episodeTotal ? <span>•</span> : null}
                        {item.episodeTotal ? <span>{item.episodeTotal} EP</span> : null}
                        {item.status && (
                          <span
                            style={{
                              marginLeft: 'auto',
                              fontSize: '0.68rem',
                              fontWeight: 600,
                              color: item.status.toLowerCase() === 'ongoing' ? '#4ade80' : '#94a3b8',
                            }}
                          >
                            {item.status}
                          </span>
                        )}
                      </div>

                      {/* Genres Pills */}
                      {item.genres && item.genres.length > 0 && (
                        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: 'auto', paddingTop: '6px' }}>
                          {item.genres.slice(0, 3).map((g) => (
                            <span
                              key={g}
                              style={{
                                fontSize: '0.68rem',
                                color: '#94a3b8',
                                background: 'rgba(255, 255, 255, 0.04)',
                                padding: '1px 6px',
                                borderRadius: '4px',
                                textTransform: 'capitalize',
                              }}
                            >
                              {g}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* VIEW MODE 2: Shelves Mode */}
          {viewMode === 'shelves' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
              {renderedShelves.map(([providerKey, items]) => (
                <ProviderRow
                  key={providerKey}
                  providerKey={providerKey}
                  meta={PROVIDER_METAS[providerKey] || { name: providerKey.toUpperCase(), badge: 'Stream', color: '#6366f1' }}
                  items={items}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
