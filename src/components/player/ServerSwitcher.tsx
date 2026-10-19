import { useMemo, useState, useEffect } from 'react';
import { CheckCircle2, Headphones, Loader2, Server, Sparkles } from 'lucide-react';
import type { PlayServer } from './PlayerInput';

export interface ServerSwitcherProps {
  servers: PlayServer[];
  activeServerId: string;
  onSelectServer: (server: PlayServer) => void;
  className?: string;
}

type AudioCategory = 'sub' | 'dub' | 'hindi';

function getAudioCategory(server: PlayServer): AudioCategory {
  const name = (server.name || '').toLowerCase();
  const prov = (server.provider || '').toLowerCase();
  const aud = (server.audio || '').toLowerCase();
  const id = (server.id || '').toLowerCase();
  const type = (server.type || '').toLowerCase();

  if (aud === 'hindi' || name.includes('hindi') || prov.includes('hindi') || id.includes('hindi')) return 'hindi';
  if (aud === 'dub' || name.includes('dub') || prov.includes('dub') || id.includes('dub') || type === 'dub') return 'dub';
  return 'sub';
}

export function ServerSwitcher({
  servers,
  activeServerId,
  onSelectServer,
  className = '',
}: ServerSwitcherProps) {
  if (!servers || servers.length === 0) return null;

  // Determine active category based on activeServerId or default to 'sub'
  const activeServer = servers.find((s) => s.id === activeServerId);
  const initialCategory = activeServer ? getAudioCategory(activeServer) : 'sub';
  const [selectedCategory, setSelectedCategory] = useState<AudioCategory>(initialCategory);

  // Sync selected category if activeServerId changes
  useEffect(() => {
    if (activeServer) {
      setSelectedCategory(getAudioCategory(activeServer));
    }
  }, [activeServerId, activeServer]);

  // Available audio categories present in the server list
  const availableCategories = useMemo(() => {
    const set = new Set<AudioCategory>();
    for (const s of servers) {
      set.add(getAudioCategory(s));
    }
    // Maintain standard priority order: sub, dub, hindi
    const order: AudioCategory[] = ['sub', 'dub', 'hindi'];
    const filtered = order.filter((c) => set.has(c));
    return filtered.length > 0 ? filtered : (['sub'] as AudioCategory[]);
  }, [servers]);

  // Ensure selectedCategory is valid
  useEffect(() => {
    if (availableCategories.length > 0 && !availableCategories.includes(selectedCategory)) {
      setSelectedCategory(availableCategories[0]);
    }
  }, [availableCategories, selectedCategory]);

  // Filtered servers matching selected category (or all if selected category has none)
  const displayedServers = useMemo(() => {
    const matching = servers.filter((s) => getAudioCategory(s) === selectedCategory);
    return matching.length > 0 ? matching : servers;
  }, [servers, selectedCategory]);

  const handleTabClick = (cat: AudioCategory) => {
    setSelectedCategory(cat);
    const matching = servers.filter((s) => getAudioCategory(s) === cat);
    if (matching.length > 0) {
      const currentMatching = matching.find((s) => s.id === activeServerId);
      if (!currentMatching) {
        // Try to keep the same provider if possible, else pick first matching
        const activeProv = activeServer?.provider?.toLowerCase();
        const sameProviderServer = matching.find((s) => s.provider?.toLowerCase() === activeProv);
        onSelectServer(sameProviderServer || matching[0]);
      }
    }
  };

  return (
    <div
      className={`server-switcher ${className}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        padding: '16px',
        background: 'rgba(255, 255, 255, 0.03)',
        borderRadius: '12px',
        border: '1px solid rgba(255, 255, 255, 0.08)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Server size={18} style={{ color: 'var(--brand, #6366f1)' }} />
          <span style={{ fontSize: '0.95rem', fontWeight: 600, color: '#f8fafc' }}>
            Streaming Servers ({servers.length})
          </span>
        </div>

        {/* Audio Type Tabs (SUB / DUB / HINDI) */}
        {availableCategories.length > 1 && (
          <div style={{ display: 'flex', gap: '6px', background: 'rgba(0,0,0,0.3)', padding: '3px', borderRadius: '8px' }}>
            {availableCategories.map((cat) => {
              const isSelected = cat === selectedCategory;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => handleTabClick(cat)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                    padding: '4px 12px',
                    borderRadius: '6px',
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    cursor: 'pointer',
                    border: 'none',
                    background: isSelected ? 'var(--brand, #6366f1)' : 'transparent',
                    color: isSelected ? '#fff' : '#94a3b8',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <Headphones size={12} />
                  {cat}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))',
          gap: '10px',
        }}
      >
        {displayedServers.map((server) => {
          const isActive = server.id === activeServerId;
          const isReady = server.status === 'ready';
          const isLoading = server.status === 'loading';
          const category = getAudioCategory(server);

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
                    {server.name}
                  </span>
                  {isActive && <Sparkles size={13} style={{ color: 'var(--brand, #6366f1)' }} />}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                  <span
                    style={{
                      fontSize: '0.7rem',
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
                  {server.type && server.type.toLowerCase() !== 'dub' && server.type.toLowerCase() !== 'sub' && (
                    <span
                      style={{
                        fontSize: '0.7rem',
                        textTransform: 'uppercase',
                        padding: '1px 5px',
                        borderRadius: '4px',
                        background: 'rgba(255, 255, 255, 0.08)',
                        color: '#94a3b8',
                        fontWeight: 600,
                      }}
                    >
                      {server.type.toUpperCase()}
                    </span>
                  )}
                  <span style={{ fontSize: '0.7rem', opacity: 0.8, color: '#94a3b8' }}>
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
    </div>
  );
}
