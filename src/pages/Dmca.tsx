import { useSEO } from '../lib/useSEO';
import { AlertCircle, FileText } from 'lucide-react';
import '../styles/pages.css';

export function Dmca() {
  useSEO({
    title: 'DMCA & Copyright Policy | AniHubStream',
    description: 'Digital Millennium Copyright Act (DMCA) policy, copyright compliance, and takedown notice procedures for AniHubStream.',
  });

  return (
    <div className="shell page-block">
      <header className="page-header">
        <h1 className="page-title">DMCA &amp; Copyright Policy</h1>
        <p className="page-sub">Notice and takedown procedure for copyright holders.</p>
      </header>

      <div className="prose">
        <section>
          <h2><FileText size={20} className="inline-icon" /> Digital Millennium Copyright Act (DMCA)</h2>
          <p>
            AniHubStream respects the intellectual property rights of content creators and copyright owners.
            AniHubStream does not host, upload, store, or manage any copyrighted media or video files on its own servers.
            All video playback links and streams are indexed from third-party media providers and streaming services.
          </p>
        </section>

        <section>
          <h2><AlertCircle size={20} className="inline-icon" /> Submitting a Copyright Infringement Notice</h2>
          <p>
            If you are a copyright owner or an authorized agent and believe that content accessible through AniHubStream
            infringes your copyrights, please submit a written notification including the following:
          </p>
          <ul>
            <li>A physical or electronic signature of the authorized copyright owner.</li>
            <li>Identification of the copyrighted work claimed to have been infringed.</li>
            <li>Specific URLs on AniHubStream containing the link to the infringing material.</li>
            <li>Your contact information (name, address, telephone number, and email address).</li>
            <li>A statement that you have a good-faith belief that the use of the material is not authorized.</li>
            <li>A statement, under penalty of perjury, that the information in the notification is accurate.</li>
          </ul>
          <p>Send all copyright inquiries to: <strong>dmca@anihubstream.com</strong>.</p>
        </section>
      </div>
    </div>
  );
}
