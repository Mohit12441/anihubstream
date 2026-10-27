import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Film,
  LayoutGrid,
  List,
  Loader2,
  Play,
  Search as SearchIcon,
  Sparkles,
  Star,
  X,
} from 'lucide-react';
import { useSEO } from '../lib/useSEO';
import { useToast } from '../lib/Toast';
import { ProviderRow, type ProviderSearchResult } from '../components/search/ProviderRow';
import { CategoryPills, type CategoryPillItem } from '../components/ui/CategoryPills';
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
  providers: SearchProviderBadge[];
}

interface FederatedSearchResponse {
  query: string;
  total: number;
  count: number;
  results?: SearchAnimeItem[];
  providers: Record<string, ProviderSearchResult[]>;
  source?: string;
}

const PROVIDER_NAMES: Record<string, { name: string; badge: string; color: string; icon: string }> = {
  anikoto: { name: 'AniKoto', badge: 'HLS 1080p', color: '#6366f1', icon: '⚡' },
  hianime: { name: 'HiAnime', badge: 'Multi-Quality', color: '#ec4899', icon: '🌸' },
  aniwatch: { name: 'AniWatch', badge: 'Megaplay', color: '#3b82f6', icon: '🛡️' },
  watchanimeworld: { name: 'WatchAnimeWorld', badge: 'Direct MP4', color: '#10b981', icon: '🌐' },
};

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

export function Search() {
  const [params, setParams] = useSearchParams();
  const query = params.get('q') || '';
  const { notify } = useToast();

  const [term, setTerm] = useState(query);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<FederatedSearchResponse | null>(null);

  // Filters & Layout State
  const [selectedProvider, setSelectedProvider] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'trending' | 'rating' | 'year'>('trending');
  const [viewMode, setViewMode] = useState<'grid' | 'shelves'>('grid');

  useSEO({
    title: query ? `Search results for "${query}" | AniHubStream` : 'Search Anime — Free Anime Streaming | AniHubStream',
    description: 'Search thousands of subbed and dubbed anime series and movies with instant HD streaming on AniHubStream.',
  });

  // Keep input in sync with URL
  useEffect(() => {
    setTerm(query);
  }, [query]);

  // Debounce search input (250ms) to auto-update URL query
  useEffect(() => {
    const trimmed = term.trim();
    if (trimmed === query) return;

    const timer = setTimeout(() => {
      if (trimmed) {
        setParams({ q: trimmed }, { replace: true });
      } else {
        setParams({}, { replace: true });
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [term, query, setParams]);

  // Fetch search data with AbortController for instant live cancellation
  useEffect(() => {
    const activeQuery = query.trim();
    if (!activeQuery) {
      setData(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);

    fetch(`/api/search?q=${encodeURIComponent(activeQuery)}`, {
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error('Search failed');
        return res.json();
      })
      .then((json: FederatedSearchResponse) => {
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

  // Filtered & Sorted Deduplicated Anime Results for Grid View
  const filteredGridItems = useMemo<SearchAnimeItem[]>(() => {
    if (!data?.results) return [];

    let items = [...data.results];

    // Filter by Provider
    if (selectedProvider !== 'all') {
      items = items.filter((item) =>
        item.providers?.some((p) => p.id === selectedProvider)
      );
    }

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
  }, [data?.results, selectedProvider, selectedStatus, sortBy]);

  // Provider Filter Pills with Result Counts
  const categoryPills = useMemo<CategoryPillItem[]>(() => {
    const totalTitles = data?.total || data?.count || 0;
    const pills: CategoryPillItem[] = [
      {
        id: 'all',
        label: 'All Providers',
        count: totalTitles,
        color: 'var(--brand, #6366f1)',
      },
    ];

    for (const [key, meta] of Object.entries(PROVIDER_NAMES)) {
      const count = data?.results
        ? data.results.filter((item) => item.providers?.some((p) => p.id === key)).length
        : (data?.providers?.[key]?.length || 0);

      pills.push({
        id: key,
        label: `${meta.icon} ${meta.name}`,
        badge: meta.badge,
        count,
        color: meta.color,
      });
    }

    return pills;
  }, [data]);

  // Classic Grouped Providers for Shelves View
  const renderedShelves = useMemo(() => {
    if (!data?.providers) return [];
    const entries = Object.entries(data.providers).filter(([_, items]) => items && items.length > 0);
    if (selectedProvider === 'all') return entries;
    return entries.filter(([key]) => key === selectedProvider);
  }, [data, selectedProvider]);

  return (
    <div className="page search-page shell" style={{ padding: '40px 0 80px' }}>
      {/* Search Header Banner */}
      <div style={{ maxWidth: '780px', margin: '0 auto 32px', textAlign: 'center' }}>
        <h1 style={{ fontSize: '2.2rem', fontWeight: 800, marginBottom: '10px', color: '#fff', letterSpacing: '-0.02em' }}>
          Search Anime
        </h1>
        <p style={{ color: '#94a3b8', fontSize: '0.95rem', marginBottom: '24px' }}>
          Search thousands of anime series and movies across <strong style={{ color: '#6366f1' }}>AniKoto</strong>, <strong style={{ color: '#ec4899' }}>HiAnime</strong>, and <strong style={{ color: '#3b82f6' }}>AniWatch</strong> with zero buffering.
        </p>

        {/* Live Search Input with Instant Clear and Loading Indicator */}
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
            placeholder="Search titles, characters, alternate romanizations, or franchises..."
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

      {/* Loading Bar Indicator */}
      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 0', gap: '14px' }}>
          <Loader2 size={36} className="animate-spin" style={{ color: 'var(--brand, #6366f1)' }} />
          <span style={{ color: '#94a3b8', fontSize: '0.9rem' }}>Searching across streaming mirrors...</span>
        </div>
      )}

      {/* Empty State */}
      {!loading && data && data.count === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 20px', background: 'rgba(255,255,255,0.02)', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.06)' }}>
          <Film size={48} style={{ opacity: 0.3, marginBottom: '16px', color: '#94a3b8' }} />
          <h2 style={{ fontSize: '1.25rem', color: '#e2e8f0', marginBottom: '8px', fontWeight: 600 }}>No anime titles found for "{query}"</h2>
          <p style={{ color: '#94a3b8', fontSize: '0.9rem', maxWidth: '460px', margin: '0 auto' }}>
            Check spelling or try popular titles like <em>"Frieren"</em>, <em>"Solo Leveling"</em>, or <em>"One Piece"</em>.
          </p>
        </div>
      )}

      {/* Results Section */}
      {!loading && data && data.count > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {/* Controls Bar: Provider Pills + Facets + Layout Toggle */}
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
            {/* Provider Filter Tabs */}
            <div style={{ overflowX: 'auto', maxWidth: '100%' }}>
              <CategoryPills
                categories={categoryPills}
                activeId={selectedProvider}
                onSelect={setSelectedProvider}
              />
            </div>

            {/* Layout Toggle & Status Filter */}
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
                  padding: '6px 12px',
                  fontSize: '0.8rem',
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
                  padding: '6px 12px',
                  fontSize: '0.8rem',
                  outline: 'none',
                  cursor: 'pointer',
                }}
              >
                <option value="trending" style={{ background: '#0f172a' }}>Sort: Trending</option>
                <option value="rating" style={{ background: '#0f172a' }}>Sort: Top Rated</option>
                <option value="year" style={{ background: '#0f172a' }}>Sort: Newest Year</option>
              </select>

              {/* View Mode Switcher */}
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
                  title="Responsive Grid View"
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
                    transition: 'all 0.15s ease',
                  }}
                >
                  <LayoutGrid size={15} /> Grid
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('shelves')}
                  title="Grouped Provider Shelves"
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
                    transition: 'all 0.15s ease',
                  }}
                >
                  <List size={15} /> Shelves
                </button>
              </div>
            </div>
          </div>

          {/* VIEW MODE 1: Unified Deduplicated Grid */}
          {viewMode === 'grid' && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                gap: '20px',
              }}
            >
              {filteredGridItems.map((item) => {
                const primaryProvider = selectedProvider !== 'all'
                  ? selectedProvider
                  : (item.providers?.[0]?.id || 'anikoto');
                const titleQuery = item.title ? `&title=${encodeURIComponent(item.title)}` : '';
                const posterQuery = (item.art || item.coverUrl) ? `&poster=${encodeURIComponent(item.art || item.coverUrl || '')}` : '';
                const primaryWatchUrl = `/watch/${encodeURIComponent(item.slug || item.id)}/1?provider=${encodeURIComponent(primaryProvider)}${titleQuery}${posterQuery}`;

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
                    {/* Card Poster with Click to Watch */}
                    <Link
                      to={primaryWatchUrl}
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
                    <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', flex: 1, gap: '8px' }}>
                      <Link
                        to={primaryWatchUrl}
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

                      {/* Direct Provider Launch Buttons */}
                      <div style={{ marginTop: 'auto', paddingTop: '8px', borderTop: '1px solid rgba(255, 255, 255, 0.05)' }}>
                        <div style={{ fontSize: '0.68rem', color: '#64748b', marginBottom: '6px', fontWeight: 600 }}>
                          STREAM DIRECT:
                        </div>
                        <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
                          {item.providers?.map((prov) => (
                            <Link
                              key={`${item.id}-${prov.id}`}
                              to={`/watch/${encodeURIComponent(item.slug || item.id)}/1?provider=${encodeURIComponent(prov.id)}${titleQuery}${posterQuery}`}
                              title={`Watch on ${prov.name}`}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '3px',
                                padding: '3px 8px',
                                borderRadius: '5px',
                                fontSize: '0.72rem',
                                fontWeight: 600,
                                textDecoration: 'none',
                                background: `${prov.color}20`,
                                color: prov.color,
                                border: `1px solid ${prov.color}40`,
                                transition: 'all 0.15s ease',
                              }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <span>{prov.icon || '▶'}</span>
                              <span>{prov.name}</span>
                            </Link>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* VIEW MODE 2: Grouped Shelves View */}
          {viewMode === 'shelves' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
              {renderedShelves.map(([providerKey, items]) => {
                const meta = PROVIDER_NAMES[providerKey] || {
                  name: providerKey.toUpperCase(),
                  badge: 'Provider',
                  color: '#6366f1',
                  icon: '▶',
                };

                return (
                  <ProviderRow
                    key={providerKey}
                    providerKey={providerKey}
                    meta={meta}
                    items={items}
                  />
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
