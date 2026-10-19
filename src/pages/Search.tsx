import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Film, Loader2, Search as SearchIcon } from 'lucide-react';
import { useSEO } from '../lib/useSEO';
import { useToast } from '../lib/Toast';
import { ProviderRow, type ProviderSearchResult } from '../components/search/ProviderRow';
import '../styles/pages.css';

interface FederatedSearchResponse {
  query: string;
  count: number;
  providers: Record<string, ProviderSearchResult[]>;
}

const PROVIDER_NAMES: Record<string, { name: string; badge: string; color: string }> = {
  anikoto: { name: 'AniKoto', badge: 'HLS 1080p', color: '#6366f1' },
  hianime: { name: 'HiAnime', badge: 'JSON Stream', color: '#ec4899' },
  aniwatch: { name: 'AniWatch', badge: 'Megaplay', color: '#3b82f6' },
  animedubhindi: { name: 'AnimeDubHindi', badge: 'Hindi Dub', color: '#f59e0b' },
  watchanimeworld: { name: 'WatchAnimeWorld', badge: 'Direct MP4', color: '#10b981' },
};

export function Search() {
  const [params, setParams] = useSearchParams();
  const query = params.get('q') || '';
  const { notify } = useToast();

  const [term, setTerm] = useState(query);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<FederatedSearchResponse | null>(null);

  useSEO({
    title: query ? `Search results for "${query}" | AniHubStream` : 'Federated Search | AniHubStream',
    description: 'Search across multiple anime streaming providers simultaneously with real-time fan-out.',
  });

  useEffect(() => {
    setTerm(query);
  }, [query]);

  useEffect(() => {
    if (!query.trim()) {
      setData(null);
      return;
    }

    let active = true;
    setLoading(true);

    fetch(`/api/search?q=${encodeURIComponent(query.trim())}`)
      .then((res) => {
        if (!res.ok) throw new Error('Search failed');
        return res.json();
      })
      .then((json: FederatedSearchResponse) => {
        if (active) {
          setData(json);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) {
          notify('Search service unreachable or timed out.');
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [query, notify]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!term.trim()) return;
    setParams({ q: term.trim() });
  };

  return (
    <div className="page search-page shell" style={{ padding: '40px 0 80px' }}>
      <div style={{ maxWidth: '720px', margin: '0 auto 40px', textAlign: 'center' }}>
        <h1 style={{ fontSize: '2rem', fontWeight: 700, marginBottom: '12px', color: '#fff' }}>
          Federated Anime Search
        </h1>
        <p style={{ color: '#94a3b8', fontSize: '0.95rem', marginBottom: '24px' }}>
          Real-time parallel search across AniKoto, HiAnime, AniWatch, and Hindi Dub mirrors.
        </p>

        <form onSubmit={handleSubmit} style={{ position: 'relative', width: '100%' }}>
          <SearchIcon
            size={18}
            style={{
              position: 'absolute',
              left: '16px',
              top: '50%',
              transform: 'translateY(-50%)',
              color: '#94a3b8',
            }}
          />
          <input
            type="search"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Search anime title, slug, or franchise..."
            style={{
              width: '100%',
              padding: '14px 20px 14px 48px',
              borderRadius: '12px',
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              color: '#fff',
              fontSize: '1rem',
              outline: 'none',
              boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
            }}
          />
        </form>
      </div>

      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '60px 0', gap: '16px' }}>
          <Loader2 size={40} className="animate-spin" style={{ color: 'var(--brand, #6366f1)' }} />
          <span style={{ color: '#94a3b8', fontSize: '0.9rem' }}>Fanning out to streaming providers...</span>
        </div>
      )}

      {!loading && data && data.count === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 20px' }}>
          <Film size={48} style={{ opacity: 0.3, marginBottom: '16px', color: '#94a3b8' }} />
          <h2 style={{ fontSize: '1.2rem', color: '#e2e8f0', marginBottom: '8px' }}>No matches found</h2>
          <p style={{ color: '#94a3b8', fontSize: '0.9rem' }}>
            Try searching for common titles (e.g., "Naruto", "Attack on Titan", "Demon Slayer").
          </p>
        </div>
      )}

      {!loading && data && data.count > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
          {Object.entries(data.providers).map(([providerKey, items]) => {
            if (!items || items.length === 0) return null;
            const meta = PROVIDER_NAMES[providerKey] || {
              name: providerKey.toUpperCase(),
              badge: 'Provider',
              color: '#6366f1',
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
  );
}
