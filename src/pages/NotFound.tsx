import { Link } from 'react-router-dom';
import { Home as HomeIcon, Compass } from 'lucide-react';
import { Embers } from '../components/Embers';

export function NotFound() {
  return (
    <div className="page notfound shell">
      <Embers count={18} tone="crimson" />
      <p className="notfound__code">404</p>
      <h1>This page drifted off the map</h1>
      <p>
        The route you followed isn&rsquo;t part of AniHubStream. Everything below is reachable from the catalogue of
        titles this site holds.
      </p>
      <div className="notfound__cta">
        <Link className="btn btn--primary" to="/">
          <HomeIcon size={16} aria-hidden="true" /> Back home
        </Link>
        <Link className="btn btn--ghost" to="/discover">
          <Compass size={16} aria-hidden="true" /> Discover
        </Link>
      </div>
    </div>
  );
}
