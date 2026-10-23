import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle2, Loader2, Server, Sparkles } from 'lucide-react';
import type { PlayServer } from './PlayerInput';

export interface ServerSwitcherProps {
  servers: PlayServer[];
  activeServerId: string;
  onSelectServer: (server: PlayServer) => void;
  className?: string;
  scopedProviderUnavailable?: boolean;
  scopedProvider?: string | null;
  onSwitchProvider?: (provider: string) => void;
}

type AudioCategory = 'sub' | 'dub' | 'hindi';

function getAudioCategory(server: PlayServer): AudioCategory {
  const aud = (server.audio || '').toLowerCase();
  const name = (server.name || '').toLowerCase();
  const prov = (server.provider || '').toLowerCase();
  const id = (server.id || '').toLowerCase();
  const type = (server.type || '').toLowerCase();

  if (aud === 'sub' && (name.includes('sub only') || aud === 'sub' && !name.includes('dub') && !id.includes('-dub'))) return 'sub';
  if (aud === 'hindi' || name.includes('hindi') || prov.includes('hindi') || id.includes('hindi')) return 'hindi';
  if (aud === 'dub' || name.includes('dub') || prov.includes('dub') || id.includes('dub') || type === 'dub') {
    if (aud === 'sub') return 'sub';
    return 'dub';
  }
  return 'sub';
}

function getProviderKey(server: PlayServer): string {
  const p = (server.provider || (server.id.includes(':') ? server.id.split(':')[0] : 'anikoto')).toLowerCase();
  if (p.includes('hianime')) return 'hianime';
  if (p.includes('anikoto')) return 'anikoto';
  if (p.includes('aniwatch')) return 'aniwatch';
  return p;
}

function getProviderDisplayName(key: string): string {
  if (key === 'anikoto') return 'AniKoto';
  if (key === 'hianime') return 'HiAnime';
  if (key === 'aniwatch') return 'AniWatch';
  return key.charAt(0).toUpperCase() + key.slice(1);
}

function cleanServerDisplayName(server: PlayServer): string {
  const raw = server.name || server.id;
  // If format is "Provider · ServerName", extract "ServerName"
  if (raw.includes('·')) {
    return raw.split('·')[1].trim();
  }
  if (raw.includes(':')) {
    return raw.split(':')[1].trim();
  }
  return raw;
}

export function ServerSwitcher({
  servers,
  activeServerId,
  onSelectServer,
  className = '',
  scopedProviderUnavailable = false,
  scopedProvider = null,
  onSwitchProvider,
}: ServerSwitcherProps) {
  if (!servers || servers.length === 0) return null;

  const [searchParams] = useSearchParams();
  const urlProvider = (searchParams.get('provider') || '').toLowerCase();

  const currentProvider = (urlProvider && ['anikoto', 'aniwatch', 'hianime'].includes(urlProvider))
    ? urlProvider
    : (scopedProvider && ['anikoto', 'aniwatch', 'hianime'].includes(scopedProvider))
    ? scopedProvider
    : (servers[0] ? getProviderKey(servers[0]) : 'anikoto');

  // Display all servers belonging to the active provider
  const displayedServers = useMemo(() => {
    const matching = servers.filter((s) => getProviderKey(s) === currentProvider);
    return matching.length > 0 ? matching : servers;
  }, [servers, currentProvider]);

  const availableProviders = [
    { key: 'anikoto', name: 'AniKoto', icon: '⚡' },
    { key: 'hianime', name: 'HiAnime', icon: '🌸' },
    { key: 'aniwatch', name: 'AniWatch', icon: '🛡️' },
  ];

  if (displayedServers.length === 1) {
    const s = displayedServers[0];
    const category = getAudioCategory(s);
    const serverName = cleanServerDisplayName(s);
    const providerDisplay = getProviderDisplayName(getProviderKey(s));

    return (
      <div
        className={`server-switcher ${className}`}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          padding: '12px 16px',
          background: 'rgba(255, 255, 255, 0.03)',
          borderRadius: '10px',
          border: '1px solid rgba(255, 255, 255, 0.08)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Server size={16} style={{ color: 'var(--brand, #6366f1)' }} />
            <span style={{ fontSize: '0.88rem', fontWeight: 600, color: '#f8fafc' }}>
              Streaming Server:
            </span>
            <span
              style={{
                fontSize: '0.82rem',
                fontWeight: 600,
                color: '#a5b4fc',
                background: 'rgba(99, 102, 241, 0.15)',
                padding: '3px 10px',
                borderRadius: '6px',
                border: '1px solid rgba(99, 102, 241, 0.3)',
              }}
            >
              {providerDisplay} · {serverName}
            </span>
            <span
              style={{
                fontSize: '0.72rem',
                textTransform: 'uppercase',
                padding: '2px 7px',
                borderRadius: '4px',
                background: category === 'dub' ? 'rgba(234, 179, 8, 0.2)' : 'rgba(99, 102, 241, 0.2)',
                color: category === 'dub' ? '#facc15' : '#a5b4fc',
                fontWeight: 700,
              }}
            >
              {category.toUpperCase()}
            </span>
            <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
              {s.quality || '1080p'}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: '#22c55e',
                boxShadow: '0 0 8px #22c55e',
                display: 'inline-block',
              }}
            />
            <span style={{ fontSize: '0.8rem', color: '#22c55e', fontWeight: 600 }}>
              Online · Direct Stream
            </span>
          </div>
        </div>

        {/* Provider Switcher Bar */}
        {onSwitchProvider && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              paddingTop: '8px',
              borderTop: '1px solid rgba(255, 255, 255, 0.05)',
              flexWrap: 'wrap',
            }}
          >
            <span style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>
              Stream Provider:
            </span>
            {availableProviders.map((prov) => {
              const isCurrent = currentProvider === prov.key;
              return (
                <button
                  key={prov.key}
                  type="button"
                  onClick={() => onSwitchProvider(prov.key)}
                  style={{
                    padding: '4px 10px',
                    borderRadius: '6px',
                    fontSize: '0.78rem',
                    fontWeight: isCurrent ? 600 : 500,
                    border: isCurrent
                      ? '1px solid var(--brand, #6366f1)'
                      : '1px solid rgba(255, 255, 255, 0.08)',
                    background: isCurrent
                      ? 'rgba(99, 102, 241, 0.2)'
                      : 'rgba(255, 255, 255, 0.03)',
                    color: isCurrent ? '#fff' : '#94a3b8',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <span>{prov.icon}</span>
                  <span>{prov.name}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={`server-switcher ${className}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
        padding: '16px',
        background: 'rgba(255, 255, 255, 0.03)',
        borderRadius: '12px',
        border: '1px solid rgba(255, 255, 255, 0.08)',
      }}
    >
      {scopedProviderUnavailable && (
        <div
          style={{
            padding: '10px 14px',
            borderRadius: '8px',
            background: 'rgba(234, 179, 8, 0.1)',
            border: '1px solid rgba(234, 179, 8, 0.25)',
            color: '#fef08a',
            fontSize: '0.85rem',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <span>⚠️</span>
          <span>
            Not available on {scopedProvider ? getProviderDisplayName(scopedProvider) : 'requested provider'} — showing available alternate servers.
          </span>
        </div>
      )}

      {/* Top Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px',
          paddingBottom: '12px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
        }}
      >
        {/* Title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Server size={18} style={{ color: 'var(--brand, #6366f1)' }} />
          <span style={{ fontSize: '0.95rem', fontWeight: 600, color: '#f8fafc' }}>
            Streaming Servers
          </span>
          <span
            style={{
              fontSize: '0.75rem',
              color: '#94a3b8',
              background: 'rgba(255,255,255,0.06)',
              padding: '2px 8px',
              borderRadius: '999px',
            }}
          >
            {displayedServers.length} available
          </span>
        </div>
      </div>

      {/* Grid of Servers for Active Provider */}
      {displayedServers.length === 0 ? (
        <div
          style={{
            padding: '24px 16px',
            textAlign: 'center',
            color: '#94a3b8',
            fontSize: '0.85rem',
            background: 'rgba(0, 0, 0, 0.2)',
            borderRadius: '8px',
            border: '1px dashed rgba(255, 255, 255, 0.1)',
          }}
        >
          No streaming servers currently available for this title.
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: '10px',
          }}
        >{displayedServers.map((server) => {
          const isActive = server.id === activeServerId;
          const isReady = server.status === 'ready';
          const isLoading = server.status === 'loading';
          const category = getAudioCategory(server);
          const serverName = cleanServerDisplayName(server);
          const providerDisplay = getProviderDisplayName(getProviderKey(server));

          return (
            <button
              key={server.id}
              type="button"
              onClick={() => onSelectServer(server)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 14px',
                borderRadius: '8px',
                border: isActive
                  ? '1.5px solid var(--brand, #6366f1)'
                  : '1px solid rgba(255, 255, 255, 0.08)',
                background: isActive
                  ? 'rgba(99, 102, 241, 0.15)'
                  : 'rgba(255, 255, 255, 0.02)',
                color: isActive ? '#fff' : '#cbd5e1',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                textAlign: 'left',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '0.85rem', fontWeight: isActive ? 600 : 500 }}>
                    {serverName}
                  </span>
                  {isActive && <Sparkles size={13} style={{ color: 'var(--brand, #6366f1)' }} />}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                  <span
                    style={{
                      fontSize: '0.68rem',
                      color: '#94a3b8',
                      fontWeight: 600,
                    }}
                  >
                    {providerDisplay}
                  </span>
                  <span
                    style={{
                      fontSize: '0.68rem',
                      textTransform: 'uppercase',
                      padding: '1px 5px',
                      borderRadius: '4px',
                      background: category === 'dub' ? 'rgba(234, 179, 8, 0.2)' : 'rgba(99, 102, 241, 0.2)',
                      color: category === 'dub' ? '#facc15' : '#a5b4fc',
                      fontWeight: 700,
                    }}
                  >
                    {category.toUpperCase()}
                  </span>
                  <span style={{ fontSize: '0.68rem', opacity: 0.8, color: '#94a3b8' }}>
                    {server.quality || '1080p'}
                  </span>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                {isLoading && (
                  <Loader2 size={15} className="animate-spin" style={{ color: '#eab308' }} />
                )}
                {isReady && (
                  <CheckCircle2 size={16} style={{ color: isActive ? '#22c55e' : '#94a3b8' }} />
                )}
              </div>
            </button>
          );
        })}
      </div>
      )}
    </div>
  );
}
