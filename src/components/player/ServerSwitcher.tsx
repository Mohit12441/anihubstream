import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Server } from 'lucide-react';
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

  const activeServer = displayedServers.find((s) => s.id === activeServerId) || displayedServers[0] || servers[0];
  const category = getAudioCategory(activeServer);
  const serverName = cleanServerDisplayName(activeServer);
  const providerDisplay = getProviderDisplayName(getProviderKey(activeServer));

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
      {scopedProviderUnavailable && (
        <div
          style={{
            padding: '8px 12px',
            borderRadius: '6px',
            background: 'rgba(234, 179, 8, 0.1)',
            border: '1px solid rgba(234, 179, 8, 0.25)',
            color: '#fef08a',
            fontSize: '0.82rem',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <span>⚠️</span>
          <span>
            Not available on {scopedProvider ? getProviderDisplayName(scopedProvider) : 'requested provider'} — playing from available alternate server.
          </span>
        </div>
      )}

      {/* Top Header: Server Status */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
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
            {activeServer.quality || '1080p'}
          </span>

          {/* Multiple servers chip switcher for same provider if available */}
          {displayedServers.length > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: '6px' }}>
              {displayedServers.map((s) => {
                const isSelected = s.id === activeServer.id;
                const name = cleanServerDisplayName(s);
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => onSelectServer(s)}
                    style={{
                      padding: '2px 8px',
                      borderRadius: '4px',
                      fontSize: '0.75rem',
                      fontWeight: isSelected ? 600 : 400,
                      border: isSelected ? '1px solid var(--brand, #6366f1)' : '1px solid rgba(255,255,255,0.1)',
                      background: isSelected ? 'rgba(99,102,241,0.25)' : 'rgba(255,255,255,0.05)',
                      color: isSelected ? '#fff' : '#94a3b8',
                      cursor: 'pointer',
                    }}
                  >
                    {name}
                  </button>
                );
              })}
            </div>
          )}
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

      {/* Provider Switcher Bar - ALWAYS VISIBLE */}
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
