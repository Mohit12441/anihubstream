import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Compass, Menu, Moon, Search, Sun, UserRound, X } from 'lucide-react';
import { Logo } from './Logo';
import { useTheme } from '../lib/useTheme';
import { useToast } from '../lib/Toast';
import { useLibrary } from '../state/library';
import '../styles/header.css';

const NAV = [
  { label: 'Home', to: '/' },
  { label: 'Anime', to: '/anime' },
  { label: 'Genres', to: '/genres' },
  { label: 'Ongoing', to: '/anime?status=Ongoing' },
  { label: 'Top Anime', to: '/anime?sort=rating' },
  { label: 'My List', to: '/my-list' },
  { label: 'Schedule', to: '/schedule' },
];

function isActive(to: string, pathname: string, search: string) {
  const [path, query] = to.split('?');
  if (path === '/') return pathname === '/';
  if (!pathname.startsWith(path)) return false;
  if (!query) return true;
  return search.includes(query);
}

export function Header() {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const { theme, toggle } = useTheme();
  const { notify } = useToast();
  const { items } = useLibrary();
  const count = items.length;
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);
  const searchWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => setOpen(false), [pathname, search]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Close suggestions on outside click
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (searchWrapRef.current && !searchWrapRef.current.contains(e.target as Node)) {
        clearSuggestions();
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  // Debounced fetch for instant suggestions
  useEffect(() => {
    const trimmed = q.trim();
    if (!trimmed) {
      setSuggestions([]);
      return;
    }
    const handler = setTimeout(() => {
      // Abort previous request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const controller = new AbortController();
      abortControllerRef.current = controller;
      setLoading(true);
      fetch(`/api/search/instant?q=${encodeURIComponent(trimmed)}&limit=8`, { signal: controller.signal })
        .then(res => res.json())
        .then(data => {
          setSuggestions(data.hits || []);
          setLoading(false);
        })
        .catch(() => {
          setSuggestions([]);
          setLoading(false);
        });
    }, 150);
    return () => clearTimeout(handler);
  }, [q]);

  const clearSuggestions = () => {
    setSuggestions([]);
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setQ(e.target.value);
  };

  const handleSuggestionClick = (hit: any) => {
    navigate(`/anime/${hit.id}`);
    setQ('');
    setOpen(false);
    clearSuggestions();
  };

  const renderSuggestions = () => {
    if (loading) {
      return <div className="suggestions-loading">Loading…</div>;
    }
    if (!suggestions.length) return null;
    return (
      <ul className="instant-suggestions" role="listbox">
        {suggestions.map((hit: any) => (
          <li key={hit.id} className="suggestion-item" onClick={() => handleSuggestionClick(hit)}>
            <img src={hit.art} alt="" className="suggestion-thumb" />
            <span className="suggestion-title">{hit.title}</span>
            {hit.year && <span className="suggestion-year">{hit.year}</span>}
          </li>
        ))}
      </ul>
    );
  };

  // Adjust submit to also clear suggestions
  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const term = q.trim();
    if (!term) {
      notify('Please enter an anime title, character, or genre to search.');
      return;
    }
    navigate(`/search?q=${encodeURIComponent(term)}`);
    setQ('');
    setOpen(false);
    clearSuggestions();
  };

  return (
    <header className="site-header">
      <div className="site-header__inner shell">
        <Logo />

        <nav className="site-nav" aria-label="Primary">
          <ul>
            {NAV.map((item) => (
              <li key={item.label}>
                <Link
                  to={item.to}
                  className={isActive(item.to, pathname, search) ? 'is-current' : undefined}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="site-header__tools">
          <div className="site-header__search-wrap" ref={searchWrapRef}>
            <form className="site-header__search" onSubmit={submit} role="search">
              <label className="sr-only" htmlFor="hdr-search">
                Search anime
              </label>
              <Search size={16} aria-hidden="true" />
              <input
                id="hdr-search"
                type="search"
                placeholder="Search anime..."
                value={q}
                onChange={handleInputChange}
                autoComplete="off"
              />
              <button type="submit" className="search__go" aria-label="Run search">
                <Search size={15} aria-hidden="true" />
              </button>
            </form>
            {renderSuggestions()}
          </div>


          <Link
            to="/discover"
            className={`icon-btn site-header__discover${isActive('/discover', pathname, search) ? ' is-current' : ''}`}
            aria-label="Open Discover"
            title="Discover"
          >
            <Compass size={18} />
          </Link>

          <button
            type="button"
            className="icon-btn"
            onClick={toggle}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          >
            {theme === 'dark' ? <Moon size={18} /> : <Sun size={18} />}
          </button>

          <Link
            to="/my-list"
            className="icon-btn site-header__profile"
            aria-label={count ? `My list — ${count} saved` : 'My list'}
            title="My list"
          >
            <UserRound size={18} />
            {count > 0 && (
              <span className="site-header__count" aria-hidden="true">
                {count > 99 ? '99+' : count}
              </span>
            )}
          </Link>

          <button
            type="button"
            className="icon-btn site-header__burger"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={open ? 'Close menu' : 'Open menu'}
          >
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>

      <div
        id="mobile-nav"
        ref={panelRef}
        className={`mobile-nav${open ? ' is-open' : ''}`}
        aria-hidden={!open}
      >
        <form className="mobile-nav__search" onSubmit={submit} role="search">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            placeholder="Search anime, movies, or genres..."
            value={q}
            onChange={handleInputChange}
            aria-label="Search anime"
            tabIndex={open ? 0 : -1}
          />
        </form>
        <ul>
          {[...NAV, { label: 'Discover', to: '/discover' }].map((item) => (
            <li key={item.label}>
              <Link
                to={item.to}
                className={isActive(item.to, pathname, search) ? 'is-current' : undefined}
                tabIndex={open ? 0 : -1}
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </header>
  );
}
