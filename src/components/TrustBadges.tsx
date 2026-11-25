import { Zap, Film, Calendar, ShieldCheck } from 'lucide-react';
import '../styles/trust-badges.css';

const TRUST_ITEMS = [
  {
    icon: Zap,
    title: 'Ad-Light Streaming',
    desc: 'Fast, smooth playback with zero disruptive video takeovers',
    color: '#ff9420',
  },
  {
    icon: Film,
    title: '1080p Ultra HD',
    desc: 'Multi-server CDN playback with subbed and dubbed audio',
    color: '#24d3ee',
  },
  {
    icon: Calendar,
    title: 'Daily Episode Releases',
    desc: 'Episodes synchronized with Japan broadcast schedules',
    color: '#3b82ff',
  },
  {
    icon: ShieldCheck,
    title: 'No Signup Required',
    desc: 'Instant streaming; progress and watchlist saved locally',
    color: '#2ee6a8',
  },
];

export function TrustBadges() {
  return (
    <section className="trust-row shell" aria-label="Why AniHubStream">
      <div className="trust-grid">
        {TRUST_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.title} className="trust-card" style={{ '--accent-color': item.color } as React.CSSProperties}>
              <div className="trust-card__icon-wrap">
                <Icon size={20} className="trust-card__icon" aria-hidden="true" />
              </div>
              <div className="trust-card__content">
                <h3 className="trust-card__title">{item.title}</h3>
                <p className="trust-card__desc">{item.desc}</p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
