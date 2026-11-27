import { Link, useLocation } from 'react-router-dom';
import { Home, Film, Calendar, Search, Bookmark } from 'lucide-react';
import { useLibrary } from '../state/library';
import { soundFx } from '../lib/soundFx';
import '../styles/mobile-tabbar.css';

export function MobileTabBar() {
  const { pathname } = useLocation();
  const { items } = useLibrary();
  const count = items.length;

  const isHome = pathname === '/';
  const isAnime = pathname.startsWith('/anime') || pathname.startsWith('/genres');
  const isSchedule = pathname.startsWith('/schedule');
  const isLibrary = pathname.startsWith('/my-list') || pathname.startsWith('/watchlist');

  const handleSearchClick = (e: React.MouseEvent) => {
    e.preventDefault();
    soundFx.playClick();
    window.dispatchEvent(new CustomEvent('anihub:open-command-palette'));
  };

  const handleTabClick = () => {
    soundFx.playClick();
  };

  return (
    <nav className="mobile-tabbar" aria-label="Mobile Navigation">
      <div className="mobile-tabbar__capsule">
        <Link
          to="/"
          className={`mobile-tabbar__item ${isHome ? 'mobile-tabbar__item--active' : ''}`}
          onClick={handleTabClick}
          aria-label="Home"
          aria-current={isHome ? 'page' : undefined}
        >
          {isHome && <span className="mobile-tabbar__indicator" />}
          <Home size={20} className="mobile-tabbar__icon" aria-hidden="true" />
          <span className="mobile-tabbar__label">Home</span>
        </Link>

        <Link
          to="/anime"
          className={`mobile-tabbar__item ${isAnime ? 'mobile-tabbar__item--active' : ''}`}
          onClick={handleTabClick}
          aria-label="Anime Catalogue"
          aria-current={isAnime ? 'page' : undefined}
        >
          {isAnime && <span className="mobile-tabbar__indicator" />}
          <Film size={20} className="mobile-tabbar__icon" aria-hidden="true" />
          <span className="mobile-tabbar__label">Anime</span>
        </Link>

        <Link
          to="/schedule"
          className={`mobile-tabbar__item ${isSchedule ? 'mobile-tabbar__item--active' : ''}`}
          onClick={handleTabClick}
          aria-label="Airing Schedule"
          aria-current={isSchedule ? 'page' : undefined}
        >
          {isSchedule && <span className="mobile-tabbar__indicator" />}
          <Calendar size={20} className="mobile-tabbar__icon" aria-hidden="true" />
          <span className="mobile-tabbar__label">Schedule</span>
        </Link>

        <button
          type="button"
          className="mobile-tabbar__item mobile-tabbar__item--search"
          onClick={handleSearchClick}
          aria-label="Search anime"
        >
          <Search size={20} className="mobile-tabbar__icon" aria-hidden="true" />
          <span className="mobile-tabbar__label">Search</span>
        </button>

        <Link
          to="/my-list"
          className={`mobile-tabbar__item ${isLibrary ? 'mobile-tabbar__item--active' : ''}`}
          onClick={handleTabClick}
          aria-label="My Library"
          aria-current={isLibrary ? 'page' : undefined}
        >
          {isLibrary && <span className="mobile-tabbar__indicator" />}
          <div className="mobile-tabbar__icon-wrap">
            <Bookmark size={20} className="mobile-tabbar__icon" aria-hidden="true" />
            {count > 0 && <span className="mobile-tabbar__badge">{count > 99 ? '99+' : count}</span>}
          </div>
          <span className="mobile-tabbar__label">My List</span>
        </Link>
      </div>
    </nav>
  );
}
