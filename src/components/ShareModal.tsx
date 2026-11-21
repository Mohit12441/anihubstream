import { useState } from 'react';
import { X, Copy, Check, Code, Share2, Globe, Send } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  animeId: string;
  episodeNumber: number;
}

export function ShareModal({
  isOpen,
  onClose,
  title,
  animeId,
  episodeNumber,
}: Props) {
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedEmbed, setCopiedEmbed] = useState(false);

  if (!isOpen) return null;

  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://anihubstream.com';
  const episodeUrl = `${origin}/watch/${animeId}/${episodeNumber}`;
  const embedCode = `<iframe src="${origin}/embed/${animeId}/${episodeNumber}" width="100%" height="480" frameborder="0" allowfullscreen allow="autoplay; fullscreen; encrypted-media"></iframe>`;

  const handleCopyLink = () => {
    navigator.clipboard.writeText(episodeUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleCopyEmbed = () => {
    navigator.clipboard.writeText(embedCode);
    setCopiedEmbed(true);
    setTimeout(() => setCopiedEmbed(false), 2000);
  };

  const shareText = encodeURIComponent(`Watch ${title} Episode ${episodeNumber} online on AniHubStream!`);
  const encodedUrl = encodeURIComponent(episodeUrl);

  const socialLinks = [
    {
      name: 'X (Twitter)',
      url: `https://twitter.com/intent/tweet?text=${shareText}&url=${encodedUrl}`,
      color: '#1da1f2',
    },
    {
      name: 'Reddit',
      url: `https://reddit.com/submit?url=${encodedUrl}&title=${shareText}`,
      color: '#ff4500',
    },
    {
      name: 'Telegram',
      url: `https://t.me/share/url?url=${encodedUrl}&text=${shareText}`,
      color: '#229ed9',
    },
    {
      name: 'WhatsApp',
      url: `https://api.whatsapp.com/send?text=${shareText}%20${encodedUrl}`,
      color: '#25d366',
    },
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Share and Embed Episode"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(8px)',
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 480,
          backgroundColor: '#0f131c',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          borderRadius: 16,
          boxShadow: '0 20px 40px rgba(0, 0, 0, 0.6)',
          overflow: 'hidden',
          animation: 'fadeIn 0.2s ease',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 20px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#fff', fontWeight: 700, fontSize: 16 }}>
            <Share2 size={18} color="#818cf8" />
            <span>Share &amp; Embed</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'rgba(255, 255, 255, 0.6)',
              cursor: 'pointer',
              padding: 4,
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Direct Link Section */}
          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: 'rgba(255, 255, 255, 0.7)', marginBottom: 6 }}>
              <Globe size={13} />
              <span>Direct Link</span>
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                readOnly
                value={episodeUrl}
                style={{
                  flex: 1,
                  padding: '9px 12px',
                  backgroundColor: 'rgba(0, 0, 0, 0.4)',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  borderRadius: 8,
                  color: '#fff',
                  fontSize: 12,
                  outline: 'none',
                }}
              />
              <button
                type="button"
                onClick={handleCopyLink}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '9px 14px',
                  backgroundColor: copiedLink ? '#22c55e' : '#6366f1',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'background-color 0.2s',
                  flexShrink: 0,
                }}
              >
                {copiedLink ? <Check size={14} /> : <Copy size={14} />}
                <span>{copiedLink ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
          </div>

          {/* Embed Code Section */}
          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: 'rgba(255, 255, 255, 0.7)', marginBottom: 6 }}>
              <Code size={13} color="#38bdf8" />
              <span>Embed Code (for Websites &amp; Forums)</span>
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <textarea
                readOnly
                rows={3}
                value={embedCode}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  backgroundColor: 'rgba(0, 0, 0, 0.4)',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  borderRadius: 8,
                  color: '#93c5fd',
                  fontSize: 11,
                  fontFamily: 'monospace',
                  resize: 'none',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
              <button
                type="button"
                onClick={handleCopyEmbed}
                style={{
                  alignSelf: 'flex-start',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '7px 14px',
                  backgroundColor: copiedEmbed ? '#22c55e' : 'rgba(255, 255, 255, 0.08)',
                  color: '#fff',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
              >
                {copiedEmbed ? <Check size={14} /> : <Code size={14} />}
                <span>{copiedEmbed ? 'Embed Code Copied!' : 'Copy Embed Code'}</span>
              </button>
            </div>
          </div>

          {/* Share to Socials */}
          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: 'rgba(255, 255, 255, 0.7)', marginBottom: 8 }}>
              <Send size={13} />
              <span>Share to Communities</span>
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
              {socialLinks.map((s) => (
                <a
                  key={s.name}
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    padding: '8px 10px',
                    backgroundColor: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: 8,
                    color: '#fff',
                    fontSize: 12,
                    fontWeight: 600,
                    textDecoration: 'none',
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = s.color;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.05)';
                  }}
                >
                  <span>{s.name}</span>
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
