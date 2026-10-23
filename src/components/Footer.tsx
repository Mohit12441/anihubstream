import { Link } from 'react-router-dom';
import { Github, Instagram, Send, Twitter } from 'lucide-react';
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
            <a
              href="https://github.com/Mohit12441/anihubstream"
              target="_blank"
              rel="noopener noreferrer"
              className="icon-btn"
              aria-label="GitHub"
            >
              <Github size={17} />
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
