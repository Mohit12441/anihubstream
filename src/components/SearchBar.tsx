import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Search, Star } from 'lucide-react';
import { useToast } from '../lib/Toast';

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
  placeholder?: string;
  /** real catalogue terms for the empty-submit hint so it can't dead-end */
  suggestions?: string[];
}

interface InstantHit {
  id: string;
  title: string;
  native?: string;
  year?: number;
  rating?: number;
  kind?: string;
  status?: string;
  art?: string;
}

export function SearchBar({
  value,
  onChange,
  onSubmit,
  placeholder = 'Search anime, movies, or genres...',
  suggestions = [],
}: Props) {
  const { notify } = useToast();
  const navigate = useNavigate();

  const [hits, setHits] = useState<InstantHit[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const containerRef = useRef<HTMLFormElement>(null);

  // Debounced instant search query
  useEffect(() => {
    const term = value.trim();
    if (term.length < 2) {
      setHits([]);
      setShowDropdown(false);
      return;
    }

    let active = true;
    const timer = setTimeout(() => {
      fetch(`/api/search/instant?q=${encodeURIComponent(term)}&limit=5`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (!active) return;
          if (Array.isArray(data?.hits) && data.hits.length > 0) {
            setHits(data.hits);
            setShowDropdown(true);
          } else {
            setHits([]);
            setShowDropdown(false);
          }
        })
        .catch(() => {
          if (active) setHits([]);
        });
    }, 180);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [value]);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <form
      ref={containerRef}
      className="search search--hero"
      style={{ position: 'relative' }}
      onSubmit={(e) => {
        e.preventDefault();
        setShowDropdown(false);
        const term = value.trim();
        if (term) onSubmit(term);
        else if (suggestions.length) notify(`Try ${suggestions.map((s) => `“${s}”`).join(' or ')}.`);
        else notify('Type a title, genre, or format to search.');
      }}
      role="search"
    >
      <Search size={19} aria-hidden="true" />
      <label className="sr-only" htmlFor="hero-search">
        Search the catalogue
      </label>
      <input
        id="hero-search"
        type="search"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => {
          if (hits.length > 0) setShowDropdown(true);
        }}
        autoComplete="off"
      />
      <button type="submit" className="search__submit" aria-label="Search">
        <ArrowRight size={20} />
      </button>

      {/* Instant Search Dropdown (Meilisearch + D1) */}
      {showDropdown && hits.length > 0 && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            left: 0,
            right: 0,
            background: 'rgba(15, 23, 42, 0.96)',
            backdropFilter: 'blur(16px)',
            borderRadius: '12px',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.6), 0 8px 10px -6px rgba(0, 0, 0, 0.5)',
            overflow: 'hidden',
            zIndex: 100,
          }}
        >
          <div style={{ padding: '8px 12px', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#94a3b8', borderBottom: '1px solid rgba(255, 255, 255, 0.06)' }}>
            Instant Suggestions
          </div>
          {hits.map((hit) => (
            <div
              key={hit.id}
              onClick={() => {
                setShowDropdown(false);
                navigate(`/watch/${hit.id}/1`);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '10px 14px',
                cursor: 'pointer',
                transition: 'background 0.15s ease',
                borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(99, 102, 241, 0.15)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
              }}
            >
              {hit.art && (
                <img
                  src={hit.art}
                  alt={hit.title}
                  style={{
                    width: '36px',
                    height: '48px',
                    objectFit: 'cover',
                    borderRadius: '4px',
                    flexShrink: 0,
                  }}
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                />
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: '0.88rem', fontWeight: 600, color: '#f8fafc', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {hit.title}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.75rem', color: '#94a3b8' }}>
                  {hit.year && <span>{hit.year}</span>}
                  {hit.kind && <span>{hit.kind}</span>}
                  {hit.rating && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: '3px', color: '#fbbf24' }}>
                      <Star size={11} fill="#fbbf24" /> {hit.rating.toFixed(1)}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
          <div
            onClick={() => {
              setShowDropdown(false);
              onSubmit(value.trim());
            }}
            style={{
              padding: '10px 14px',
              fontSize: '0.8rem',
              color: 'var(--brand, #6366f1)',
              cursor: 'pointer',
              textAlign: 'center',
              fontWeight: 600,
              background: 'rgba(99, 102, 241, 0.08)',
            }}
          >
            See all federated results for &ldquo;{value.trim()}&rdquo; &rarr;
          </div>
        </div>
      )}
    </form>
  );
}
