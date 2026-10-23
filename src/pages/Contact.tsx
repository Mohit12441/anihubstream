import { useSEO } from '../lib/useSEO';
import { Mail, Bug, ShieldCheck } from 'lucide-react';
import '../styles/pages.css';

export function Contact() {
  useSEO({
    title: 'Contact Us — AniHubStream',
    description: 'Get in touch with the AniHubStream team for support, metadata corrections, or copyright inquiries.',
  });

  return (
    <div className="shell page-block">
      <header className="page-header">
        <h1 className="page-title">Contact AniHubStream</h1>
        <p className="page-sub">We welcome questions, suggestions, bug reports, and dmca notices.</p>
      </header>

      <div className="prose">
        <section>
          <h2><Mail size={20} className="inline-icon" /> General Inquiries &amp; Support</h2>
          <p>
            For general questions, platform feedback, or suggestions, you can reach out to our team at:
          </p>
          <p>
            <strong>Email:</strong> <a href="mailto:contact@anihubstream.com">contact@anihubstream.com</a>
          </p>
        </section>

        <section>
          <h2><ShieldCheck size={20} className="inline-icon" /> Copyright &amp; Legal</h2>
          <p>
            If you represent a copyright owner and wish to submit a DMCA takedown notice or copyright inquiry,
            please refer to our <a href="/dmca">DMCA Notice page</a> or email:
          </p>
          <p>
            <strong>Email:</strong> <a href="mailto:dmca@anihubstream.com">dmca@anihubstream.com</a>
          </p>
        </section>

        <section>
          <h2><Bug size={20} className="inline-icon" /> Bug Reports &amp; Metadata Fixes</h2>
          <p>
            Notice an incorrect title, missing episode thumbnail, or broken stream link? Include the anime ID and episode number
            in your report so our automated validation systems can verify and fix it quickly.
          </p>
        </section>
      </div>
    </div>
  );
}
