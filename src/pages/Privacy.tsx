import { useSEO } from '../lib/useSEO';
import { Lock, ShieldCheck } from 'lucide-react';
import '../styles/pages.css';

export function Privacy() {
  useSEO({
    title: 'Privacy Policy | AniHubStream',
    description: 'Learn how AniHubStream handles viewer privacy, anonymous sessions, and local device preferences.',
  });

  return (
    <div className="shell page-block">
      <header className="page-header">
        <h1 className="page-title">Privacy Policy</h1>
        <p className="page-sub">How we respect and protect your privacy while you watch.</p>
      </header>

      <div className="prose">
        <section>
          <h2><ShieldCheck size={20} className="inline-icon" /> Anonymous by Default</h2>
          <p>
            AniHubStream is designed to be used without requiring any personal accounts or email registrations.
            Your watchlist and playback timestamps are associated with an anonymous, secure HTTP-only session cookie
            or stored directly inside your browser’s local storage.
          </p>
        </section>

        <section>
          <h2><Lock size={20} className="inline-icon" /> Cookies and Storage</h2>
          <p>
            We use technical cookies and local storage solely for functional playback purposes:
          </p>
          <ul>
            <li>Remembering video volume, audio (sub/dub), and subtitle preferences.</li>
            <li>Tracking resume positions so you can continue where you left off.</li>
            <li>Maintaining your saved titles on "My List".</li>
          </ul>
          <p>
            We do not sell, rent, or share personal viewer identities with any third-party advertisers.
          </p>
        </section>
      </div>
    </div>
  );
}
