import { useState } from 'react';
import { Check, Copy, Download, ExternalLink, Film, Loader2, Sparkles, X } from 'lucide-react';
import type { Anime, Episode } from '../../data/model';
import { bridgeResolve, bridgeUrl, isResolveFailure, type BridgeSource } from '../../lib/streamBridge';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  anime: Anime;
  episode: Episode;
  currentStream: BridgeSource | null;
  notify: (msg: string) => void;
}

interface ProviderOption {
  id: string;
  name: string;
  badge: string;
  badgeColor?: string;
  format: string;
  quality: string;
  type: 'direct' | 'portal' | 'stream';
  audio: string;
  description: string;
}

const PROVIDER_OPTIONS: ProviderOption[] = [
  {
    id: 'animedubhindi',
    name: 'AnimeDubHindi',
    badge: 'Hindi Dub',
    badgeColor: '#ff9933',
    format: 'MKV (Multi-Audio: Hindi + Jap)',
    quality: '1080p / 720p HD',
    type: 'direct',
    audio: 'hindi',
    description: 'Direct progressive MKV with multi-audio Hindi and Japanese tracks.',
  },
  {
    id: 'watchanimeworld',
    name: 'WatchAnimeWorld',
    badge: 'Multi-Audio',
    badgeColor: '#38bdf8',
    format: 'MP4 (Hindi / Eng / Jap)',
    quality: '1080p / 720p HD',
    type: 'direct',
    audio: 'dub',
    description: 'Direct progressive MP4 file with multi-audio selection.',
  },
  {
    id: 'hianime',
    name: 'HiAnime Portal',
    badge: 'Multi-Quality',
    badgeColor: '#a855f7',
    format: 'MP4 Download Portal',
    quality: '1080p / 720p / 480p / 360p',
    type: 'portal',
    audio: 'sub',
    description: 'HiAnime download portal with individual quality MP4 downloads.',
  },
  {
    id: 'aniwatch',
    name: 'AniWatch Stream',
    badge: 'Sub / Dub',
    badgeColor: '#10b981',
    format: 'HLS Master Stream (.m3u8)',
    quality: '1080p HD',
    type: 'stream',
    audio: 'sub',
    description: 'HLS stream master URL for offline downloaders, VLC, and mpv.',
  },
  {
    id: 'anikoto',
    name: 'AniKoto Stream',
    badge: 'Sub / Dub',
    badgeColor: '#e11d48',
    format: 'HLS Master Stream (.m3u8)',
    quality: '1080p / 720p',
    type: 'stream',
    audio: 'sub',
    description: 'Adaptive HLS master playlist for high definition streaming.',
  },
];

export function DownloadModal({ isOpen, onClose, anime, episode, currentStream, notify }: Props) {
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  if (!isOpen) return null;

  const handleDownloadDirect = (url: string, filename?: string) => {
    const a = document.createElement('a');
    a.href = url.includes('?') ? `${url}&download=1` : `${url}?download=1`;
    if (filename) a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    notify('Starting download…');
  };

  const handleCopy = (text: string) => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopiedLink(true);
      notify('Stream link copied to clipboard.');
      setTimeout(() => setCopiedLink(false), 2000);
    });
  };

  const handleDownloadProvider = async (opt: ProviderOption) => {
    // If the active stream already matches this provider, use its stream directly
    if (currentStream && currentStream.provider === opt.id) {
      if (opt.type === 'direct') {
        const url = bridgeUrl(currentStream.master);
        const ext = currentStream.container === 'matroska' ? 'mkv' : 'mp4';
        const cleanTitle = (anime.title || 'anime').replace(/[^a-zA-Z0-9_-]/g, '_');
        handleDownloadDirect(url, `${cleanTitle}_EP${episode.n}.${ext}`);
        return;
      }
      if (opt.type === 'portal' && currentStream.downloadPage) {
        window.open(currentStream.downloadPage, '_blank', 'noopener,noreferrer');
        notify('Opening download portal…');
        return;
      }
      if (opt.type === 'stream') {
        handleCopy(bridgeUrl(currentStream.master));
        return;
      }
    }

    // Otherwise, resolve the provider on demand
    try {
      setResolvingId(opt.id);
      notify(`Resolving ${opt.name} download…`);
      const res = await bridgeResolve(anime.title, episode.n, opt.audio, opt.id);
      if (isResolveFailure(res)) {
        notify(`Could not fetch download for ${opt.name}: ${res.error}`);
        return;
      }

      if (opt.type === 'direct') {
        const url = bridgeUrl(res.master);
        const ext = res.container === 'matroska' ? 'mkv' : 'mp4';
        const cleanTitle = (anime.title || 'anime').replace(/[^a-zA-Z0-9_-]/g, '_');
        handleDownloadDirect(url, `${cleanTitle}_EP${episode.n}.${ext}`);
      } else if (opt.type === 'portal') {
        if (res.downloadPage) {
          window.open(res.downloadPage, '_blank', 'noopener,noreferrer');
          notify('Opening download portal…');
        } else {
          handleCopy(bridgeUrl(res.master));
          notify('No web portal link returned. Stream link copied to clipboard.');
        }
      } else {
        handleCopy(bridgeUrl(res.master));
      }
    } catch (e) {
      notify(`Download error: ${(e as Error).message}`);
    } finally {
      setResolvingId(null);
    }
  };

  return (
    <div
      className="dl-modal__backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dl-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="dl-modal__dialog">
        <header className="dl-modal__head">
          <div className="dl-modal__title-box">
            <h2 id="dl-modal-title" className="dl-modal__title">
              <Download size={20} className="dl-modal__title-ico" aria-hidden="true" />
              Download Episode {episode.n}
            </h2>
            <p className="dl-modal__sub">
              {anime.title} {anime.season ? `· ${anime.season}` : ''}
            </p>
          </div>
          <button type="button" className="btn btn--icon dl-modal__close" onClick={onClose} aria-label="Close modal">
            <X size={20} />
          </button>
        </header>

        <div className="dl-modal__body">
          {/* Active stream quick-download if available */}
          {currentStream && (
            <div className="dl-modal__active-card">
              <div className="dl-modal__active-head">
                <span className="dl-modal__pill dl-modal__pill--active">
                  <Sparkles size={13} aria-hidden="true" /> Active Stream
                </span>
                <span className="dl-modal__provider-name">{currentStream.provider?.toUpperCase()}</span>
                <span className="dl-modal__quality-badge">{currentStream.quality}p</span>
              </div>
              <p className="dl-modal__active-desc">
                {currentStream.kind === 'progressive'
                  ? `Direct progressive file download (${currentStream.container === 'matroska' ? 'MKV' : 'MP4'}) with instant browser save.`
                  : 'Currently playing via HLS adaptive stream.'}
              </p>
              <div className="dl-modal__active-actions">
                {currentStream.kind === 'progressive' ? (
                  <button
                    type="button"
                    className="btn btn--primary btn--sm"
                    onClick={() => {
                      const url = bridgeUrl(currentStream.master);
                      const ext = currentStream.container === 'matroska' ? 'mkv' : 'mp4';
                      const cleanTitle = (anime.title || 'anime').replace(/[^a-zA-Z0-9_-]/g, '_');
                      handleDownloadDirect(url, `${cleanTitle}_EP${episode.n}.${ext}`);
                    }}
                  >
                    <Download size={14} aria-hidden="true" />
                    Download Current Stream ({currentStream.container === 'matroska' ? 'MKV' : 'MP4'})
                  </button>
                ) : currentStream.downloadPage ? (
                  <button
                    type="button"
                    className="btn btn--primary btn--sm"
                    onClick={() => {
                      window.open(currentStream.downloadPage!, '_blank', 'noopener,noreferrer');
                      notify('Opening download portal…');
                    }}
                  >
                    <ExternalLink size={14} aria-hidden="true" />
                    Open Download Portal
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => handleCopy(bridgeUrl(currentStream.master))}
                  >
                    {copiedLink ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                    Copy HLS Stream Link
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="dl-modal__section-heading">
            <span>Available Download Sources</span>
            <small>Choose provider and format</small>
          </div>

          <div className="dl-modal__list">
            {PROVIDER_OPTIONS.map((opt) => {
              const isResolving = resolvingId === opt.id;
              return (
                <div key={opt.id} className="dl-modal__item">
                  <div className="dl-modal__item-info">
                    <div className="dl-modal__item-top">
                      <Film size={15} className="dl-modal__item-ico" aria-hidden="true" />
                      <strong className="dl-modal__item-name">{opt.name}</strong>
                      <span
                        className="dl-modal__badge"
                        style={{
                          backgroundColor: `${opt.badgeColor ?? 'var(--pl-accent)'}22`,
                          color: opt.badgeColor ?? 'var(--pl-accent)',
                          borderColor: `${opt.badgeColor ?? 'var(--pl-accent)'}44`,
                        }}
                      >
                        {opt.badge}
                      </span>
                      <span className="dl-modal__format-tag">{opt.quality}</span>
                    </div>
                    <p className="dl-modal__item-desc">{opt.description}</p>
                    <div className="dl-modal__item-meta">
                      <span className="dl-modal__meta-chip">Format: {opt.format}</span>
                    </div>
                  </div>

                  <div className="dl-modal__item-action">
                    <button
                      type="button"
                      className={`btn btn--sm ${opt.type === 'direct' ? 'btn--primary' : 'btn--ghost'}`}
                      disabled={isResolving}
                      onClick={() => void handleDownloadProvider(opt)}
                    >
                      {isResolving ? (
                        <>
                          <Loader2 size={13} className="spin" aria-hidden="true" />
                          <span>Preparing…</span>
                        </>
                      ) : opt.type === 'direct' ? (
                        <>
                          <Download size={13} aria-hidden="true" />
                          <span>Download</span>
                        </>
                      ) : opt.type === 'portal' ? (
                        <>
                          <ExternalLink size={13} aria-hidden="true" />
                          <span>Portal</span>
                        </>
                      ) : (
                        <>
                          <Copy size={13} aria-hidden="true" />
                          <span>Stream</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="dl-modal__tip">
            <strong>Download Tip:</strong> Direct MKV & MP4 downloads can be played offline in any media player (VLC, MPV, Windows Media Player). For HLS stream links, paste into VLC (Media → Open Network Stream) or IDM.
          </div>
        </div>
      </div>
    </div>
  );
}
