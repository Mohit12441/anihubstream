import { useSEO } from '../lib/useSEO';
import { BookOpen, ShieldAlert, Scale, CheckCircle2 } from 'lucide-react';
import '../styles/pages.css';

export function Terms() {
  useSEO({
    title: 'Terms of Service — AniHubStream',
    description: 'Read the terms and conditions for using the AniHubStream platform.',
  });

  return (
    <div className="shell page-block">
      <header className="page-header">
        <h1 className="page-title">Terms of Service</h1>
        <p className="page-sub">Last updated: October 2026</p>
      </header>

      <div className="prose">
        <section>
          <h2><BookOpen size={20} className="inline-icon" /> 1. Acceptance of Terms</h2>
          <p>
            By accessing or using AniHubStream (&ldquo;we&rdquo;, &ldquo;our&rdquo;, or &ldquo;the service&rdquo;),
            you agree to be bound by these Terms of Service. If you do not agree to these terms, please do not use the service.
          </p>
        </section>

        <section>
          <h2><Scale size={20} className="inline-icon" /> 2. Content & Service Nature</h2>
          <p>
            AniHubStream is an indexing and metadata discovery platform. AniHubStream does not host, upload, or store any
            video media files on its servers. All streaming links and streams are indexed from independent third-party sources
            on the open internet.
          </p>
        </section>

        <section>
          <h2><ShieldAlert size={20} className="inline-icon" /> 3. Acceptable Use</h2>
          <p>
            You agree to use AniHubStream for personal, non-commercial entertainment and informational purposes only.
            You agree not to attempt to disrupt the service, reverse engineer edge APIs, or bypass rate limits.
          </p>
        </section>

        <section>
          <h2><CheckCircle2 size={20} className="inline-icon" /> 4. Disclaimer of Warranties</h2>
          <p>
            AniHubStream is provided on an &ldquo;AS IS&rdquo; and &ldquo;AS AVAILABLE&rdquo; basis without warranties of
            any kind. We do not guarantee continuous, uninterrupted access to third-party streaming resources.
          </p>
        </section>
      </div>
    </div>
  );
}
