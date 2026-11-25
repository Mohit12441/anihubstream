import { Link } from 'react-router-dom';
import { Instagram, Send, Twitter } from 'lucide-react';
import { Logo } from './Logo';
import { useCatalogue } from '../state/catalogue';

export function Footer() {
  const { GENRES } = useCatalogue();

  return (
    <footer className="site-footer">
      <div className="shell">
        <div className="site-footer__grid">
          <div className="site-footer__brand">
            <Logo />
            <p className="site-footer__lede">
              AniHubStream is your cinematic destination to watch anime online free in high definition.
              Discover trending series, explore comprehensive weekly schedules, and stream subbed and dubbed anime
              with fast playback and synchronized subtitles.
            </p>
            <span className="site-footer__note">
              <Send size={14} aria-hidden="true" /> AniHubStream does not store media files on its servers.
              All streams and artwork belong to their respective copyright holders.
            </span>
          </div>

          <nav aria-label="Browse">
            <h3>Browse</h3>
            <ul>
              <li>
                <Link to="/anime">All Anime</Link>
              </li>
              <li>
                <Link to="/genres">Genres</Link>
              </li>
              <li>
                <Link to="/schedule">Airing Schedule</Link>
              </li>
              <li>
                <Link to="/discover">Discover</Link>
              </li>
              <li>
                <Link to="/anime?sort=rating">Top Rated</Link>
              </li>
            </ul>
          </nav>

          <nav aria-label="Popular genres">
            <h3>Genres</h3>
            <ul>
              {GENRES.slice(0, 6).map((g) => (
                <li key={g.id}>
                  <Link to={`/genres?genre=${g.id}`}>{g.label}</Link>
                </li>
              ))}
            </ul>
          </nav>

          <nav aria-label="Legal and About">
            <h3>Legal &amp; About</h3>
            <ul>
              <li>
                <Link to="/about">About Us</Link>
              </li>
              <li>
                <Link to="/contact">Support &amp; Contact</Link>
              </li>
              <li>
                <Link to="/dmca">DMCA Notice</Link>
              </li>
              <li>
                <Link to="/privacy">Privacy Policy</Link>
              </li>
              <li>
                <Link to="/terms">Terms of Service</Link>
              </li>
              <li>
                <a href="https://github.com/Mohit12441/anihubstream/releases" target="_blank" rel="noopener noreferrer">
                  Release Notes
                </a>
              </li>
              <li>
                <Link to="/about">Press Kit</Link>
              </li>
            </ul>
          </nav>
        </div>

        <div className="site-footer__bottom">
          <p>© {new Date().getFullYear()} AniHubStream. All rights reserved. Free anime streaming for fans worldwide.</p>
          <div className="site-footer__social">
            <a
              href="https://discord.gg/yqkRvXPCVP"
              target="_blank"
              rel="noopener noreferrer"
              className="icon-btn"
              aria-label="Join our Discord Community"
              title="Join our Discord Community"
              style={{ color: '#5865F2' }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994.021-.041.001-.09-.041-.106a13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.929 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.894.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
              </svg>
            </a>
            <a
              href="https://x.com"
              target="_blank"
              rel="noopener noreferrer"
              className="icon-btn"
              aria-label="X / Twitter"
            >
              <Twitter size={17} />
            </a>
            <a
              href="https://instagram.com"
              target="_blank"
              rel="noopener noreferrer"
              className="icon-btn"
              aria-label="Instagram"
            >
              <Instagram size={17} />
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
