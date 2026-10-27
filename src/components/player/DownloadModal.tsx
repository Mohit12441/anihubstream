import { useEffect, useState, useMemo, useRef } from 'react';
import { Check, Copy, Download, ExternalLink, Film, Loader2, Sparkles, X, Terminal, AlertCircle } from 'lucide-react';
import type { Anime, Episode } from '../../data/model';
import type { BridgeSource } from '../../lib/streamBridge';
import { downloadHlsStream, type DownloadProgress } from '../../lib/hlsDownloader';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  anime: Anime;
  episode: Episode;
  currentStream: BridgeSource | null;
  activeProvider?: string;
  notify: (msg: string) => void;
}

interface DownloadItem {
  name: string;
  label: string;
  quality: string;
  url: string;
  proxiedUrl?: string;
  pipeUrl?: string;
  provider: string;
  audio: string;
  type: 'direct' | 'portal' | 'stream' | 'stream-download';
  format?: string;
  referer?: string;
}

const PROVIDER_METAS: Record<string, { name: string; color: string; badge: string; description: string }> = {
  anikoto: {
    name: 'AniKoto',
    color: '#e11d48',
    badge: 'Multi-Mirror Direct',
    description: 'Direct multi-mirror downloads (Pahe, NekoStream) in 1080p, 720p, and 360p.',
  },
  hianime: {
    name: 'HiAnime',
    color: '#a855f7',
    badge: 'Direct Multi-Quality',
    description: 'High-speed MP4 downloads with individual quality selection and web portal.',
  },
  watchanimeworld: {
    name: 'WatchAnimeWorld',
    color: '#38bdf8',
    badge: 'Multi-Audio MP4',
    description: 'Direct progressive MP4 file with Hindi, English, and Japanese audio.',
  },
  aniwatch: {
    name: 'AniWatch',
    color: '#10b981',
    badge: 'HLS Stream Downloader',
    description: 'Direct in-browser HLS stream-to-MP4 video downloader and IDM/VLC link generator.',
  },
};

export function DownloadModal({
  isOpen,
  onClose,
  anime,
  episode,
  currentStream,
  activeProvider,
  notify,
}: Props) {
  // Infer active provider from props or active stream
  const initialProvider = useMemo(() => {
    const raw = activeProvider || currentStream?.provider || '';
    const clean = raw.toLowerCase().trim();
    if (clean.includes('hianime')) return 'hianime';
    if (clean.includes('aniwatch')) return 'aniwatch';
    if (clean.includes('watchanimeworld')) return 'watchanimeworld';
    return 'anikoto';
  }, [activeProvider, currentStream]);

  const [selectedProvider, setSelectedProvider] = useState<string>(initialProvider);
  const [selectedAudio, setSelectedAudio] = useState<'sub' | 'dub'>('sub');
  const [loading, setLoading] = useState(false);
  const [providerError, setProviderError] = useState<string | null>(null);
  const [downloads, setDownloads] = useState<DownloadItem[]>([]);
  const [downloadPage, setDownloadPage] = useState<string | null>(null);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [command, setCommand] = useState<string | null>(null);
  const [availableProviders, setAvailableProviders] = useState<string[]>(['anikoto', 'hianime', 'aniwatch']);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedCommand, setCopiedCommand] = useState(false);

  const currentMeta = PROVIDER_METAS[selectedProvider] || {
    name: selectedProvider.toUpperCase(),
    color: '#ff3366',
    badge: 'Provider Download',
    description: 'Download options for this episode.',
  };

  // In-browser stream assembly state
  const [downloadingItem, setDownloadingItem] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Clean up any running download on unmount or close
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, []);

  // Sync selected provider when initial provider changes
  useEffect(() => {
    if (initialProvider) {
      setSelectedProvider(initialProvider);
    }
  }, [initialProvider]);

  // Fetch provider-scoped download links
  useEffect(() => {
    if (!isOpen || !anime?.id || !episode?.n) return;
    let live = true;
    setLoading(true);
    setProviderError(null);

    const query = new URLSearchParams({
      id: anime.id,
      provider: selectedProvider,
      ep: String(episode.n),
      audio: selectedAudio,
    });

    fetch(`/api/download?${query.toString()}`)
      .then((res) => res.json())
      .then((data: any) => {
        if (!live) return;
        if (data?.ok && data?.data) {
          const items = data.data.downloads || [];
          setDownloads(items);
          setDownloadPage(data.data.downloadPage || null);
          setStreamUrl(data.data.streamUrl || null);
          setCommand(data.data.command || null);
          if (Array.isArray(data.data.availableProviders) && data.data.availableProviders.length > 0) {
            setAvailableProviders(data.data.availableProviders);
          }
          if (items.length === 0 || data.data.available === false) {
            setProviderError(
              data.data.error ||
                `Episode ${episode.n} of "${anime.title}" is not available for download on ${currentMeta.name}.`
            );
          } else {
            setProviderError(null);
          }
        } else {
          setDownloads([]);
          setDownloadPage(null);
          setStreamUrl(null);
          setCommand(null);
          setProviderError(
            data?.error || `Unable to load download sources for ${currentMeta.name}. Please select an alternate provider.`
          );
        }
      })
      .catch(() => {
        if (live) {
          setDownloads([]);
          setDownloadPage(null);
          setStreamUrl(null);
          setCommand(null);
          setProviderError(
            `Unable to connect to download service for ${currentMeta.name}. Please try another provider.`
          );
        }
      })
      .finally(() => {
        if (live) setLoading(false);
      });

    return () => {
      live = false;
    };
  }, [isOpen, anime?.id, episode?.n, selectedProvider, selectedAudio, currentMeta.name]);

  if (!isOpen || !anime || !episode) return null;

  const handleDownloadDirect = (url: string, filename?: string) => {
    const a = document.createElement('a');
    a.href = url;
    if (filename) a.download = filename;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    notify('Starting download…');
  };

  const handleDownloadPipe = (item: DownloadItem) => {
    if (item.pipeUrl) {
      notify(`Starting high-speed stream download for ${item.quality}…`);
      const a = document.createElement('a');
      a.href = item.pipeUrl;
      const safeTitle = (anime.title || 'anime').replace(/[^a-zA-Z0-9_-]/g, '_');
      a.download = `${safeTitle}_EP${episode.n}_${item.quality}.ts`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return;
    }
    void handleDownloadStream(item);
  };

  const handleDownloadStream = async (item: DownloadItem) => {
    try {
      setDownloadingItem(item.name);
      setDownloadProgress({
        loadedSegments: 0,
        totalSegments: 1,
        percent: 0,
        bytesDownloaded: 0,
        formattedBytes: '0 MB',
      });
      notify(`Preparing stream download for ${item.quality}…`);

      const controller = new AbortController();
      abortControllerRef.current = controller;

      const safeTitle = (anime.title || 'anime').replace(/[^a-zA-Z0-9_-]/g, '_');
      const filename = `${safeTitle}_EP${episode.n}_${item.quality}.mp4`;

      const defaultReferer = selectedProvider === 'hianime' ? 'https://zokoanime.video/' : 'https://megaplay.buzz/';
      await downloadHlsStream({
        streamUrl: item.url,
        referer: item.referer || defaultReferer,
        filename,
        quality: item.quality,
        signal: controller.signal,
        onProgress: (p) => setDownloadProgress(p),
      });

      notify(`Download complete! Video file saved to your device.`);
    } catch (e: any) {
      if (e?.name !== 'AbortError' && !e?.message?.includes('cancelled')) {
        notify(`Download failed: ${e.message}`);
      } else {
        notify('Download cancelled.');
      }
    } finally {
      setDownloadingItem(null);
      setDownloadProgress(null);
      abortControllerRef.current = null;
    }
  };

  const handleCancelDownload = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setDownloadingItem(null);
    setDownloadProgress(null);
  };

  const handleCopy = (text: string) => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopiedLink(true);
      notify('Stream link copied to clipboard for IDM / 1DM / VLC.');
      setTimeout(() => setCopiedLink(false), 2000);
    });
  };

  const handleCopyCommand = (text: string) => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopiedCommand(true);
      notify('yt-dlp command copied to clipboard.');
      setTimeout(() => setCopiedCommand(false), 2000);
    });
  };

  return (
    <div
      className="dl-modal__backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dl-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          handleCancelDownload();
          onClose();
        }
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
          <button
            type="button"
            className="btn btn--icon dl-modal__close"
            onClick={() => {
              handleCancelDownload();
              onClose();
            }}
            aria-label="Close modal"
          >
            <X size={20} />
          </button>
        </header>

        <div className="dl-modal__body">
          {/* Provider Selection Tabs */}
          <div className="dl-modal__tabs-section">
            <label className="dl-modal__tabs-label">Provider Catalog Source:</label>
            <div className="dl-modal__tabs" role="tablist" aria-label="Select Anime Provider">
              {availableProviders.map((provKey) => {
                const meta = PROVIDER_METAS[provKey] || { name: provKey.toUpperCase(), color: '#888' };
                const isSelected = selectedProvider === provKey;
                return (
                  <button
                    key={provKey}
                    type="button"
                    role="tab"
                    aria-selected={isSelected}
                    className={`dl-modal__tab ${isSelected ? 'dl-modal__tab--active' : ''}`}
                    style={{ '--prov-color': meta.color } as React.CSSProperties}
                    onClick={() => {
                      if (!downloadingItem) setSelectedProvider(provKey);
                    }}
                    disabled={Boolean(downloadingItem)}
                  >
                    <span>{meta.name}</span>
                    {isSelected && <span className="dl-modal__tab-dot" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Active Provider Card */}
          <div
            className="dl-modal__active-card"
            style={{
              borderColor: `${currentMeta.color}40`,
              background: `linear-gradient(135deg, ${currentMeta.color}15, rgba(255, 255, 255, 0.02))`,
            }}
          >
            <div className="dl-modal__active-head">
              <span
                className="dl-modal__pill"
                style={{
                  backgroundColor: `${currentMeta.color}25`,
                  color: currentMeta.color,
                  borderColor: `${currentMeta.color}50`,
                }}
              >
                <Sparkles size={13} aria-hidden="true" /> {currentMeta.badge}
              </span>
              <span className="dl-modal__provider-name">{currentMeta.name}</span>
              <div className="dl-modal__audio-switch">
                <button
                  type="button"
                  className={`dl-modal__audio-btn ${selectedAudio === 'sub' ? 'is-active' : ''}`}
                  onClick={() => !downloadingItem && setSelectedAudio('sub')}
                  disabled={Boolean(downloadingItem)}
                >
                  SUB
                </button>
                <button
                  type="button"
                  className={`dl-modal__audio-btn ${selectedAudio === 'dub' ? 'is-active' : ''}`}
                  onClick={() => !downloadingItem && setSelectedAudio('dub')}
                  disabled={Boolean(downloadingItem)}
                >
                  DUB
                </button>
              </div>
            </div>
            <p className="dl-modal__active-desc">{currentMeta.description}</p>
          </div>

          {/* Download Items Section */}
          <div className="dl-modal__section-heading">
            <span>{currentMeta.name} Download Options</span>
            <small>Direct MP4 files & in-browser stream downloads</small>
          </div>

          {loading ? (
            <div className="dl-modal__loading">
              <Loader2 size={24} className="spin" aria-hidden="true" />
              <p>Fetching download sources from {currentMeta.name}…</p>
            </div>
          ) : downloads.length > 0 ? (
            <div className="dl-modal__list">
              {downloads.map((item, idx) => {
                const isDownloadingThis = downloadingItem === item.name;
                const isStreamDownload = item.type === 'stream-download';

                return (
                  <div key={`${item.url}-${item.quality}-${idx}`} className="dl-modal__item">
                    <div className="dl-modal__item-info">
                      <div className="dl-modal__item-top">
                        <Film size={15} className="dl-modal__item-ico" aria-hidden="true" />
                        <strong className="dl-modal__item-name">{item.name}</strong>
                        <span
                          className="dl-modal__badge"
                          style={{
                            backgroundColor: `${currentMeta.color}22`,
                            color: currentMeta.color,
                            borderColor: `${currentMeta.color}44`,
                          }}
                        >
                          {item.quality.toUpperCase()}
                        </span>
                        {isStreamDownload ? (
                          <span className="dl-modal__badge dl-modal__badge--stream">
                            STREAM &rarr; VIDEO
                          </span>
                        ) : item.type === 'portal' ? (
                          <span className="dl-modal__badge" style={{ backgroundColor: 'rgba(255, 255, 255, 0.08)', color: '#aaa', borderColor: 'rgba(255, 255, 255, 0.15)' }}>
                            EXTERNAL MIRROR
                          </span>
                        ) : null}
                      </div>
                      <div className="dl-modal__item-meta">
                        <span className="dl-modal__meta-chip">Format: {item.format || (isStreamDownload ? 'TS / MP4' : 'MP4')}</span>
                        <span className="dl-modal__meta-chip">Audio: {item.audio.toUpperCase()}</span>
                      </div>

                      {/* Active In-Browser Download Progress Bar */}
                      {isDownloadingThis && downloadProgress && (
                        <div className="dl-modal__progress-box">
                          <div className="dl-modal__progress-bar-wrap">
                            <div
                              className="dl-modal__progress-bar-fill"
                              style={{ width: `${downloadProgress.percent}%` }}
                            />
                          </div>
                          <div className="dl-modal__progress-info">
                            <span>
                              {downloadProgress.percent}% · {downloadProgress.loadedSegments}/{downloadProgress.totalSegments} chunks ({downloadProgress.formattedBytes})
                            </span>
                            <button
                              type="button"
                              className="dl-modal__cancel-btn"
                              onClick={handleCancelDownload}
                            >
                              <X size={12} /> Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="dl-modal__item-action">
                      {item.type === 'portal' ? (
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          onClick={() => window.open(item.url, '_blank', 'noopener,noreferrer')}
                        >
                          <ExternalLink size={13} aria-hidden="true" />
                          <span>Open Mirror</span>
                        </button>
                      ) : isStreamDownload ? (
                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                          <button
                            type="button"
                            className="btn btn--primary btn--sm"
                            disabled={Boolean(downloadingItem)}
                            onClick={() => handleDownloadPipe(item)}
                            title="Instant high-speed direct download via browser download bar"
                          >
                            <Download size={13} aria-hidden="true" />
                            <span>Fast Download</span>
                          </button>
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            disabled={Boolean(downloadingItem)}
                            onClick={() => handleDownloadStream(item)}
                            title="Stitch segments in-browser with progress bar"
                          >
                            {isDownloadingThis ? (
                              <>
                                <Loader2 size={13} className="spin" aria-hidden="true" />
                                <span>Stitching…</span>
                              </>
                            ) : (
                              <>
                                <Sparkles size={13} aria-hidden="true" />
                                <span>Turbo Stitch</span>
                              </>
                            )}
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="btn btn--primary btn--sm"
                          disabled={Boolean(downloadingItem)}
                          onClick={() => handleDownloadDirect(item.url, `${anime.title}_EP${episode.n}_${item.quality}.mp4`)}
                        >
                          <Download size={13} aria-hidden="true" />
                          <span>Download</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="dl-modal__empty dl-modal__error-card" role="alert">
              <div className="dl-modal__error-badge">
                <AlertCircle size={28} className="dl-modal__empty-ico" aria-hidden="true" />
              </div>
              <div className="dl-modal__error-content">
                <h3 className="dl-modal__error-title">
                  Episode {episode.n} Not Available on {currentMeta.name}
                </h3>
                <p className="dl-modal__error-desc">
                  {providerError ||
                    `"${anime.title}" has no verified download streams on ${currentMeta.name} for this episode.`}
                </p>
              </div>

              {availableProviders.filter((p) => p !== selectedProvider).length > 0 && (
                <div className="dl-modal__fallback-prompt">
                  <span className="dl-modal__fallback-label">Available on other mirrors:</span>
                  <div className="dl-modal__fallback-btns">
                    {availableProviders
                      .filter((p) => p !== selectedProvider)
                      .map((alt) => {
                        const altMeta = PROVIDER_METAS[alt] || { name: alt.toUpperCase(), color: '#888' };
                        return (
                          <button
                            key={alt}
                            type="button"
                            className="btn btn--primary btn--sm dl-modal__fallback-btn"
                            onClick={() => {
                              setSelectedProvider(alt);
                              notify(`Switching download mirror to ${altMeta.name}…`);
                            }}
                          >
                            <Sparkles size={13} aria-hidden="true" />
                            <span>Switch to {altMeta.name}</span>
                          </button>
                        );
                      })}
                  </div>
                </div>
              )}

              {downloadPage && (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm dl-modal__portal-btn"
                  onClick={() => window.open(downloadPage, '_blank', 'noopener,noreferrer')}
                >
                  <ExternalLink size={14} aria-hidden="true" />
                  Open {currentMeta.name} Web Page
                </button>
              )}
            </div>
          )}

          {/* Universal Downloader Actions (IDM, 1DM, VLC, yt-dlp) - only displayed when valid download streams exist */}
          {downloads.length > 0 && (streamUrl || command) && (
            <div className="dl-modal__footer-actions">
              {streamUrl && (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => handleCopy(streamUrl)}
                  title="Copy stream playlist link for Internet Download Manager, 1DM, or VLC"
                >
                  {copiedLink ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                  Copy Stream Link (for IDM / 1DM / VLC)
                </button>
              )}
              {command && (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => handleCopyCommand(command)}
                  title="Copy ready-to-run yt-dlp command"
                >
                  {copiedCommand ? <Check size={14} aria-hidden="true" /> : <Terminal size={14} aria-hidden="true" />}
                  Copy yt-dlp Command
                </button>
              )}
              {downloadPage && (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => window.open(downloadPage, '_blank', 'noopener,noreferrer')}
                >
                  <ExternalLink size={14} aria-hidden="true" />
                  Web Portal
                </button>
              )}
            </div>
          )}

          <div className="dl-modal__tip">
            <strong>Stream Download Tip:</strong> Click <strong>Download</strong> to capture and save the high-definition video directly onto your device (.ts / .mp4). Plays natively in VLC, Windows Media Player, QuickTime, and mobile video players. You can also copy the stream link into <strong>IDM (PC)</strong>, <strong>1DM (Android)</strong>, or <strong>VLC</strong>.
          </div>
        </div>
      </div>
    </div>
  );
}
