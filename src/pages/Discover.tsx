import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Menu, Moon, Search, Sun, X } from 'lucide-react';
import { AnimeCard } from '../components/AnimeCard';
import { AnimeCarousel } from '../components/AnimeCarousel';
import { Logo } from '../components/Logo';
import { Embers } from '../components/Embers';
import { artUrl } from '../data/model';
import { useCatalogue } from '../state/catalogue';
import { useTheme } from '../lib/useTheme';
import { useToast } from '../lib/Toast';
import '../styles/discover.css';

export function Discover() {
  const { theme, toggle } = useTheme();
  const { notify } = useToast();
  const { status, error, reload, popular } = useCatalogue();
  const [q, setQ] = useState('');
  const [nav, setNav] = useState(false);
  const navigate = useNavigate();
  const items = popular();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const term = q.trim();
    if (!term) {
      notify('Type a title or genre — the search runs against the titles this catalogue serves.');
      return;
    }
    navigate(`/anime?q=${encodeURIComponent(term)}`);
  };

  return (
    <div className="page discover">
      <div className="discover__bg">
        <img src={artUrl('/art/discover-sunset.jpg')} alt="" aria-hidden="true" decoding="async" />
      </div>
      <div className="discover__veil" />
      <Embers count={10} tone="amber" className="discover__embers" />

      <header className="discover__bar">
        <Logo />
        <div className="discover__tools">
          <form className="discover__search" onSubmit={submit} role="search">
            <Search size={15} aria-hidden="true" />
            <label className="sr-only" htmlFor="disc-search">
              Search anime
            </label>
            <input
              id="disc-search"
              type="search"
              placeholder="Search anime..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <button type="submit" aria-label="Search">
              <Search size={15} aria-hidden="true" />
            </button>
          </form>
          <button
            type="button"
            className="icon-btn"
            onClick={toggle}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          >
            {theme === 'dark' ? <Moon size={17} /> : <Sun size={17} />}
          </button>
          <button
            type="button"
            className="icon-btn discover__burger"
            onClick={() => setNav((v) => !v)}
            aria-expanded={nav}
            aria-label={nav ? 'Close menu' : 'Open menu'}
          >
            {nav ? <X size={19} /> : <Menu size={19} />}
          </button>
        </div>
      </header>

      {nav && (
        <div className="discover__sheet">
          <nav aria-label="Discover">
            <Link to="/">Home</Link>
            <Link to="/anime">Anime</Link>
            <Link to="/genres">Genres</Link>
            <Link to="/schedule">Ongoing</Link>
            <Link to="/watch/demon-slayer">Watch page</Link>
          </nav>
        </div>
      )}

      <section className="discover__hero shell">
        <div className="discover__copy">
          <p className="discover__kicker">AniHubStream · Discover</p>
          <h1>
            <span className="discover__h-a">Good</span>
            <span className="discover__h-a">Anime</span>
            <span className="discover__h-b">Better</span>
            <span className="discover__h-b">Days</span>
          </h1>
          <p className="discover__tag">Stream. Explore. Enjoy.</p>
          <a className="discover__go" href="#popular" aria-label="Jump to popular anime this week">
            <ArrowRight size={22} />
          </a>
        </div>
        <div className="vj discover__vj" aria-hidden="true">
          <span className="vj__jp">冒険は続く</span>
          <span className="vj__en">The adventure continues</span>
        </div>
      </section>

      <section className="discover__row shell" id="popular" aria-labelledby="popular-h">
        <div className="sec-head">
          <h2 id="popular-h">
            Popular This Week
            <Link to="/anime?sort=rating" className="sec-head__link" aria-label="See all rankings">
              <ArrowRight size={18} aria-hidden="true" />
            </Link>
          </h2>
        </div>
        <AnimeCarousel label="Popular this week">
          {status === 'error' ? (
            <p className="empty-row" role="alert">
              {error ?? 'The catalogue service did not answer.'}{' '}
              <button type="button" className="btn btn--sm btn--ghost" onClick={reload}>
                Try again
              </button>
            </p>
          ) : items.length ? (
            items.map((a) => (
              <AnimeCard key={a.id} anime={a} variant="poster" episode={`${a.kind} · ${a.year}`} />
            ))
          ) : (
            <p className="empty-row" role="status">
              Loading popular titles…
            </p>
          )}
        </AnimeCarousel>
      </section>

      <section className="discover__moods shell" aria-label="More ways to browse">
        <Link className="discover__mood" to="/genres" style={{ '--pc': '#a24bff' } as React.CSSProperties}>
          <small>Browse</small>
          <b>Explore Genres</b>
          <span>Twelve shelves, purple neon</span>
        </Link>
        <Link className="discover__mood" to="/schedule" style={{ '--pc': '#3b82ff' } as React.CSSProperties}>
          <small>Airing</small>
          <b>Ongoing This Season</b>
          <span>Weekly schedule, blue moon</span>
        </Link>
        <Link className="discover__mood" to="/watch/demon-slayer" style={{ '--pc': '#ff1f4a' } as React.CSSProperties}>
          <small>Player</small>
          <b>Immersive Watch</b>
          <span>Episodes, quality, auto-next</span>
        </Link>
      </section>
    </div>
  );
}
