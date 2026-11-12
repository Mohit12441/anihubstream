import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Calendar,
  Compass,
  Film,
  Home,
  Layers,
  Moon,
  Search,
  Sparkles,
  Sun,
  Volume2,
  VolumeX,
  X,
  Zap,
} from 'lucide-react';
import { searchInstant } from '../data/api';
import { cleanAnimeTitle } from '../data/model';
import { soundFx } from '../lib/soundFx';
import { useTheme } from '../lib/useTheme';
import { toggleReducedMotion, usePrefersReducedMotion } from '../lib/motion';

interface SearchHit {
  id: string;
  title: string;
  art?: string;
  year?: number;
  rating?: number;
  kind?: string;
}

interface ActionItem {
  id: string;
  label: string;
  category: 'nav' | 'action';
  icon: React.ReactNode;
  shortcut?: string;
  onSelect: () => void;
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const navigate = useNavigate();
  const { theme, toggle: toggleTheme } = useTheme();
  const reduced = usePrefersReducedMotion();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  // Global shortcut (Ctrl+K, Cmd+K, or Slash outside inputs)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }

      if (e.key === '/' && !open) {
        const activeEl = document.activeElement;
        const isInput =
          activeEl instanceof HTMLInputElement ||
          activeEl instanceof HTMLTextAreaElement ||
          activeEl?.getAttribute('contenteditable') === 'true';

        if (!isInput) {
          e.preventDefault();
          setOpen(true);
        }
      }

      if (e.key === 'Escape' && open) {
        e.preventDefault();
        setOpen(false);
      }
    };

    const onCustomOpen = () => setOpen(true);

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('anihub:open-command-palette', onCustomOpen);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('anihub:open-command-palette', onCustomOpen);
    };
  }, [open]);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      soundFx.playChime();
      setQuery('');
      setHits([]);
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 40);
    }
  }, [open]);

  // Instant anime search
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setHits([]);
      setLoading(false);
      return;
    }

    const abort = new AbortController();
    setLoading(true);

    const timer = setTimeout(() => {
      searchInstant(q, 6, { signal: abort.signal })
        .then((res) => {
          setHits((res.hits as SearchHit[]) || []);
          setLoading(false);
          setSelectedIndex(0);
        })
        .catch(() => {
          setHits([]);
          setLoading(false);
        });
    }, 180);

    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [query]);

  const defaultActions: ActionItem[] = [
    {
      id: 'nav-home',
      label: 'Home',
      category: 'nav',
      icon: <Home size={16} />,
      shortcut: 'G H',
      onSelect: () => navigate('/'),
    },
    {
      id: 'nav-anime',
      label: 'Anime Catalogue',
      category: 'nav',
      icon: <Film size={16} />,
      shortcut: 'G A',
      onSelect: () => navigate('/anime'),
    },
    {
      id: 'nav-schedule',
      label: 'Episode Release Schedule',
      category: 'nav',
      icon: <Calendar size={16} />,
      shortcut: 'G S',
      onSelect: () => navigate('/schedule'),
    },
    {
      id: 'nav-genres',
      label: 'Browse Genres',
      category: 'nav',
      icon: <Layers size={16} />,
      shortcut: 'G G',
      onSelect: () => navigate('/genres'),
    },
    {
      id: 'nav-discover',
      label: 'Discover Random Stream',
      category: 'nav',
      icon: <Compass size={16} />,
      shortcut: 'G D',
      onSelect: () => navigate('/discover'),
    },
    {
      id: 'act-sound',
      label: soundFx.isMuted() ? 'Unmute Sound FX' : 'Mute Sound FX',
      category: 'action',
      icon: soundFx.isMuted() ? <VolumeX size={16} /> : <Volume2 size={16} />,
      onSelect: () => soundFx.toggleMute(),
    },
    {
      id: 'act-motion',
      label: reduced ? 'Enable Full Motion Effects' : 'Enable Reduced Motion',
      category: 'action',
      icon: <Zap size={16} />,
      onSelect: () => toggleReducedMotion(),
    },
    {
      id: 'act-theme',
      label: `Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Mode`,
      category: 'action',
      icon: theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />,
      onSelect: () => toggleTheme(),
    },
    {
      id: 'act-sakura',
      label: 'Trigger Cyber-Sakura Rain (Konami)',
      category: 'action',
      icon: <Sparkles size={16} />,
      onSelect: () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA' }));
      },
    },
  ];

  const totalItems = hits.length > 0 ? hits.length : defaultActions.length;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => {
        const next = (prev + 1) % totalItems;
        soundFx.playHover();
        return next;
      });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => {
        const next = (prev - 1 + totalItems) % totalItems;
        soundFx.playHover();
        return next;
      });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      soundFx.playClick();
      if (hits.length > 0) {
        const hit = hits[selectedIndex];
        if (hit) {
          navigate(`/anime/${hit.id}`);
          setOpen(false);
        }
      } else {
        const action = defaultActions[selectedIndex];
        if (action) {
          action.onSelect();
          setOpen(false);
        }
      }
    }
  };

  if (!open) return null;

  return (
    <div
      className="cmd-palette"
      role="dialog"
      aria-modal="true"
      aria-label="AniHub Command Palette"
      onClick={() => setOpen(false)}
    >
      <div className="cmd-palette__backdrop" />
      <div className="cmd-palette__dialog" onClick={(e) => e.stopPropagation()}>
        <header className="cmd-palette__header">
          <Search size={18} className="cmd-palette__search-icon" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            className="cmd-palette__input"
            placeholder="Type a title, genre, or command (e.g. Solo Leveling, /schedule)..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            aria-autocomplete="list"
          />
          {query && (
            <button
              type="button"
              className="cmd-palette__clear"
              onClick={() => {
                setQuery('');
                inputRef.current?.focus();
              }}
              aria-label="Clear input"
            >
              <X size={15} />
            </button>
          )}
          <kbd className="cmd-palette__esc-badge" onClick={() => setOpen(false)}>
            ESC
          </kbd>
        </header>

        <div className="cmd-palette__body">
          {loading && (
            <div className="cmd-palette__status" role="status">
              <span className="shuriken-spinner shuriken-spinner--sm" /> Searching titles...
            </div>
          )}

          <ul ref={listRef} className="cmd-palette__list" role="listbox">
            {hits.length > 0
              ? hits.map((hit, idx) => {
                  const isSelected = idx === selectedIndex;
                  return (
                    <li
                      key={hit.id}
                      role="option"
                      aria-selected={isSelected}
                      className={`cmd-palette__item ${isSelected ? 'is-selected' : ''}`}
                      onMouseEnter={() => setSelectedIndex(idx)}
                      onClick={() => {
                        soundFx.playClick();
                        navigate(`/anime/${hit.id}`);
                        setOpen(false);
                      }}
                    >
                      {hit.art ? (
                        <img src={hit.art} alt="" className="cmd-palette__thumb" />
                      ) : (
                        <div className="cmd-palette__thumb-placeholder">
                          <Film size={14} />
                        </div>
                      )}
                      <div className="cmd-palette__info">
                        <span className="cmd-palette__title">{cleanAnimeTitle(hit.title)}</span>
                        <div className="cmd-palette__sub-meta">
                          {hit.kind && <span className="cmd-palette__badge">{hit.kind}</span>}
                          {hit.year && <span className="cmd-palette__year">{hit.year}</span>}
                          {hit.rating && hit.rating > 0 && (
                            <span className="cmd-palette__rating">★ {hit.rating.toFixed(1)}</span>
                          )}
                        </div>
                      </div>
                      <span className="cmd-palette__action-hint">Jump to Show →</span>
                    </li>
                  );
                })
              : defaultActions.map((action, idx) => {
                  const isSelected = idx === selectedIndex;
                  return (
                    <li
                      key={action.id}
                      role="option"
                      aria-selected={isSelected}
                      className={`cmd-palette__item ${isSelected ? 'is-selected' : ''}`}
                      onMouseEnter={() => setSelectedIndex(idx)}
                      onClick={() => {
                        soundFx.playClick();
                        action.onSelect();
                        setOpen(false);
                      }}
                    >
                      <div className="cmd-palette__action-icon" aria-hidden="true">
                        {action.icon}
                      </div>
                      <div className="cmd-palette__info">
                        <span className="cmd-palette__title">{action.label}</span>
                      </div>
                      {action.shortcut && (
                        <kbd className="cmd-palette__key-hint">{action.shortcut}</kbd>
                      )}
                    </li>
                  );
                })}
          </ul>
        </div>

        <footer className="cmd-palette__footer">
          <div className="cmd-palette__hints">
            <span>
              <kbd>↑</kbd> <kbd>↓</kbd> Navigate
            </span>
            <span>
              <kbd>↵</kbd> Select
            </span>
            <span>
              <kbd>ESC</kbd> Close
            </span>
          </div>
          <span className="cmd-palette__brand">AniHubStream Command HUD</span>
        </footer>
      </div>
    </div>
  );
}
