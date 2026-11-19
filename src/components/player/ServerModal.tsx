import React, { useEffect, useMemo, useState } from 'react';
import { X, Server, Check, Mic, Radio, ShieldCheck } from 'lucide-react';
import type { PlayServer } from './PlayerInput';
import { cleanServerName } from './ServerPopover';
import type { ProviderBundle, ProviderRegistry } from '../../pages/Watch';
import '../../styles/serverModal.css';

export interface ServerModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeProviderId: string;
  activeServerId: string;
  currentAudio: 'sub' | 'dub';
  providerRegistry: ProviderRegistry;
  displayProviders: { id: string; name: string; available: boolean; status?: string; latencyMs?: number }[];
  onSelectServer: (server: PlayServer) => void;
  onSelectProvider: (providerId: string) => void;
  onSwitchAudio: (audio: 'sub' | 'dub') => void;
}

export const ServerModal: React.FC<ServerModalProps> = ({
  isOpen,
  onClose,
  activeProviderId,
  activeServerId,
  currentAudio,
  providerRegistry,
  displayProviders,
  onSelectServer,
  onSelectProvider,
  onSwitchAudio,
}) => {
  const [selectedProvKey, setSelectedProvKey] = useState<string>(() => {
    const raw = activeProviderId.toLowerCase();
    return raw.includes('torrent') || raw.includes('p2p') ? 'p2p' : raw;
  });

  // Keep selected tab in sync with incoming active provider
  useEffect(() => {
    const raw = activeProviderId.toLowerCase();
    const key = raw.includes('torrent') || raw.includes('p2p') ? 'p2p' : raw;
    setSelectedProvKey(key);
  }, [activeProviderId]);

  // Handle ESC key to close modal
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const activeBundle = useMemo<ProviderBundle | null>(() => {
    return providerRegistry[selectedProvKey] || providerRegistry['anikoto'] || null;
  }, [providerRegistry, selectedProvKey]);

  if (!isOpen) return null;

  const subServers = activeBundle?.servers.sub || [];
  const dubServers = activeBundle?.servers.dub || [];
  const hasDub = dubServers.length > 0;

  const handleProviderTabClick = (provId: string) => {
    const key = provId.toLowerCase().includes('torrent') || provId.toLowerCase().includes('p2p') ? 'p2p' : provId.toLowerCase();
    setSelectedProvKey(key);
    onSelectProvider(provId);
  };

  const handleServerClick = (server: PlayServer) => {
    onSelectServer(server);
    onClose();
  };

  return (
    <div
      className="srv-modal__backdrop"
      onClick={onClose}
      role="presentation"
      aria-hidden="true"
    >
      <div
        className="srv-modal__dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="srv-modal-title"
      >
        {/* Modal Header */}
        <div className="srv-modal__header">
          <div className="srv-modal__header-left">
            <div className="srv-modal__header-icon">
              <Server size={18} aria-hidden="true" />
            </div>
            <div>
              <h2 id="srv-modal-title" className="srv-modal__title">
                Streaming Servers
              </h2>
              <p className="srv-modal__subtitle">
                Switch provider or choose a faster mirror
              </p>
            </div>
          </div>
          <button
            type="button"
            className="srv-modal__close-btn"
            onClick={onClose}
            aria-label="Close server selector"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        {/* Audio Segmented Switch inside modal */}
        <div className="srv-modal__audio-row">
          <span className="srv-modal__section-label">Audio Track:</span>
          <div className="srv-modal__audio-segmented" role="group" aria-label="Audio track selection">
            <button
              type="button"
              className={`srv-modal__audio-tab${currentAudio !== 'dub' ? ' is-active' : ''}`}
              onClick={() => onSwitchAudio('sub')}
              aria-pressed={currentAudio !== 'dub'}
            >
              <Radio size={13} aria-hidden="true" />
              <span>Japanese (Sub)</span>
            </button>
            {hasDub && (
              <button
                type="button"
                className={`srv-modal__audio-tab${currentAudio === 'dub' ? ' is-active' : ''}`}
                onClick={() => onSwitchAudio('dub')}
                aria-pressed={currentAudio === 'dub'}
              >
                <Mic size={13} aria-hidden="true" />
                <span>English (Dub)</span>
              </button>
            )}
          </div>
        </div>

        {/* Provider Tabs (Horizontal Scrollable) */}
        <div className="srv-modal__providers-container">
          <span className="srv-modal__section-label">Streaming Provider:</span>
          <div className="srv-modal__providers-pills" role="tablist" aria-label="Providers">
            {displayProviders.map((p) => {
              const pKey = p.id.toLowerCase().includes('torrent') || p.id.toLowerCase().includes('p2p') ? 'p2p' : p.id.toLowerCase();
              const isSelected = selectedProvKey === pKey;
              const isRezka = pKey === 'hdrezka';
              return (
                <button
                  key={p.id}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  className={`srv-modal__prov-pill${isSelected ? ' is-active' : ''}`}
                  onClick={() => handleProviderTabClick(p.id)}
                >
                  <span className={`srv-modal__prov-dot${isRezka ? ' is-rezka' : ''}`} />
                  <span className="srv-modal__prov-name">{p.name}</span>
                  {isRezka && <span className="srv-modal__badge-tag">MP4</span>}
                  {isSelected && (
                    <span className="srv-modal__active-tag">
                      <Check size={11} aria-hidden="true" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Servers / Mirrors List for Selected Provider */}
        <div className="srv-modal__servers-body">
          {/* Sub Mirrors Section */}
          {subServers.length > 0 && (
            <div className="srv-modal__server-group">
              <div className="srv-modal__group-head">
                <span className="srv-modal__group-title">
                  {activeBundle?.name || 'Provider'} Subtitle Mirrors (Japanese)
                </span>
                <span className="srv-modal__group-count">{subServers.length} servers</span>
              </div>
              <div className="srv-modal__grid">
                {subServers.map((s) => {
                  const isSelected = s.id === activeServerId;
                  const isUnavailable = s.status === 'unavailable';
                  const name = cleanServerName(s);
                  const isRezka = s.id.toLowerCase().includes('hdrezka') || (s.provider || '').toLowerCase() === 'hdrezka';
                  return (
                    <button
                      key={s.id}
                      type="button"
                      disabled={isUnavailable}
                      className={`srv-modal__card${isSelected ? ' is-active' : ''}${isUnavailable ? ' is-disabled' : ''}`}
                      onClick={() => handleServerClick(s)}
                      title={isUnavailable ? (s.unavailableReason || 'Unavailable') : `Stream from ${s.name}`}
                    >
                      <div className="srv-modal__card-top">
                        <span className="srv-modal__card-name">{name}</span>
                        <div className="srv-modal__card-badges">
                          <span className="srv-modal__quality-badge">{s.quality || '1080p'}</span>
                          {isSelected && <span className="srv-modal__active-badge">Active</span>}
                        </div>
                      </div>
                      <div className="srv-modal__card-bottom">
                        <span className="srv-modal__card-status">
                          <span className={`srv-modal__card-dot${isSelected ? ' is-green' : isUnavailable ? ' is-amber' : ''}`} />
                          {isUnavailable ? (s.unavailableReason || 'Unavailable') : isSelected ? 'Now Playing' : 'Ready'}
                        </span>
                        {isRezka && <span className="srv-modal__source-tag">Direct MP4</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Dub Mirrors Section */}
          {hasDub && (
            <div className="srv-modal__server-group" style={{ marginTop: '16px' }}>
              <div className="srv-modal__group-head">
                <span className="srv-modal__group-title">
                  {activeBundle?.name || 'Provider'} Dubbed Mirrors (English)
                </span>
                <span className="srv-modal__group-count">{dubServers.length} servers</span>
              </div>
              <div className="srv-modal__grid">
                {dubServers.map((s) => {
                  const isSelected = s.id === activeServerId;
                  const isUnavailable = s.status === 'unavailable';
                  const name = cleanServerName(s);
                  const isRezka = s.id.toLowerCase().includes('hdrezka') || (s.provider || '').toLowerCase() === 'hdrezka';
                  return (
                    <button
                      key={s.id}
                      type="button"
                      disabled={isUnavailable}
                      className={`srv-modal__card${isSelected ? ' is-active' : ''}${isUnavailable ? ' is-disabled' : ''}`}
                      onClick={() => handleServerClick(s)}
                      title={isUnavailable ? (s.unavailableReason || 'Unavailable') : `Stream from ${s.name}`}
                    >
                      <div className="srv-modal__card-top">
                        <span className="srv-modal__card-name">{name}</span>
                        <div className="srv-modal__card-badges">
                          <span className="srv-modal__quality-badge">{s.quality || '1080p'}</span>
                          {isSelected && <span className="srv-modal__active-badge">Active</span>}
                        </div>
                      </div>
                      <div className="srv-modal__card-bottom">
                        <span className="srv-modal__card-status">
                          <span className={`srv-modal__card-dot${isSelected ? ' is-green' : isUnavailable ? ' is-amber' : ''}`} />
                          {isUnavailable ? (s.unavailableReason || 'Unavailable') : isSelected ? 'Now Playing' : 'Ready'}
                        </span>
                        {isRezka && <span className="srv-modal__source-tag">Direct MP4</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {subServers.length === 0 && dubServers.length === 0 && (
            <div className="srv-modal__empty">
              <Server size={32} style={{ opacity: 0.4, marginBottom: '8px' }} />
              <p>No servers available for this provider.</p>
            </div>
          )}
        </div>

        {/* Modal Footer Note */}
        <div className="srv-modal__footer">
          <ShieldCheck size={14} className="srv-modal__footer-icon" aria-hidden="true" />
          <span>Streams auto-reconnect if interrupted. Choose another mirror if buffering occurs.</span>
        </div>
      </div>
    </div>
  );
};
