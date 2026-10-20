import { useMemo, useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle2, Headphones, Loader2, Server, Sparkles } from 'lucide-react';
import type { PlayServer } from './PlayerInput';

export interface ServerSwitcherProps {
  servers: PlayServer[];
  activeServerId: string;
  onSelectServer: (server: PlayServer) => void;
  className?: string;
  scopedProviderUnavailable?: boolean;
  scopedProvider?: string | null;
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
  if (p.includes('animedubhindi')) return 'animedubhindi';
  return p;
}

function getProviderDisplayName(key: string): string {
  if (key === 'anikoto') return 'AniKoto';
  if (key === 'hianime') return 'HiAnime';
  if (key === 'aniwatch') return 'AniWatch';
  if (key === 'animedubhindi') return 'AnimeDubHindi';
  return key.charAt(0).toUpperCase() + key.slice(1);
}

function getProviderIcon(key: string): string {
  if (key === 'anikoto') return '⚡';
  if (key === 'hianime') return '🌸';
  if (key === 'aniwatch') return '🛡️';
  if (key === 'animedubhindi') return '🇮🇳';
  return '📺';
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
}: ServerSwitcherProps) {
  if (!servers || servers.length === 0) return null;

  // Extract all available providers from server pool
  const availableProviders = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of servers) {
      const k = getProviderKey(s);
      if (!map.has(k)) {
        map.set(k, getProviderDisplayName(k));
      }
    }
    const list = Array.from(map.entries()).map(([key, name]) => ({
      key,
      name,
      icon: getProviderIcon(key),
    }));
    const order = ['anikoto', 'hianime', 'aniwatch', 'animedubhindi'];
    list.sort((a, b) => {
      const ia = order.indexOf(a.key);
      const ib = order.indexOf(b.key);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a.name.localeCompare(b.name);
    });
    // Add "All Providers" option at the start so user is not locked into a single provider
    return [{ key: 'all', name: 'All', icon: '🌐' }, ...list];
  }, [servers]);

  const [searchParams] = useSearchParams();
  const urlProvider = (searchParams.get('provider') || '').toLowerCase();
  const activeServer = servers.find((s) => s.id === activeServerId);

  const initialProvider = (urlProvider && urlProvider !== 'all' && urlProvider !== 'providers') ? urlProvider : 'all';
  const [selectedProvider, setSelectedProvider] = useState<string>(initialProvider);

  const initialCategory = activeServer ? getAudioCategory(activeServer) : 'sub';
  const [selectedCategory, setSelectedCategory] = useState<AudioCategory>(initialCategory);

  // Synchronize category when activeServerId changes externally
  useEffect(() => {
    if (activeServer) {
      setSelectedCategory(getAudioCategory(activeServer));
    }
  }, [activeServerId, activeServer]);

  // Synchronize provider from URL param or ensure selectedProvider is valid in available list
  useEffect(() => {
    if (urlProvider && urlProvider !== 'all' && urlProvider !== 'providers' && availableProviders.some((p) => p.key === urlProvider)) {
      setSelectedProvider(urlProvider);
    } else if (availableProviders.length > 0 && !availableProviders.some((p) => p.key === selectedProvider)) {
      setSelectedProvider('all');
    }
  }, [urlProvider, availableProviders, selectedProvider]);

  // Available audio categories across all servers
  const availableCategories = useMemo(() => {
    const set = new Set<AudioCategory>();
    for (const s of servers) {
      set.add(getAudioCategory(s));
    }
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

  // Servers matching both selected audio category and selected provider
  const displayedServers = useMemo(() => {
    // 1. Filter by language category (SUB / DUB / HINDI)
    const categoryMatches = servers.filter((s) => getAudioCategory(s) === selectedCategory);
    if (categoryMatches.length === 0) return [];

    // 2. Filter by provider if a specific provider is chosen
    if (selectedProvider === 'all') return categoryMatches;
    return categoryMatches.filter((s) => getProviderKey(s) === selectedProvider);
  }, [servers, selectedCategory, selectedProvider]);

  // Handler when clicking a provider button
  const handleProviderClick = (provKey: string) => {
    setSelectedProvider(provKey);
    const pool = servers.filter((s) => getAudioCategory(s) === selectedCategory);
    const base = pool.length > 0 ? pool : servers;
    const matching = provKey === 'all' ? base : base.filter((s) => getProviderKey(s) === provKey);
    if (matching.length > 0) {
      const currentInMatching = matching.find((s) => s.id === activeServerId);
      if (!currentInMatching) {
        onSelectServer(matching[0]);
      }
    }
  };

  // Handler when clicking an audio tab: immediately triggers the matching server
  const handleTabClick = (cat: AudioCategory) => {
    setSelectedCategory(cat);
    const matching = servers.filter((s) => {
      const catMatch = getAudioCategory(s) === cat;
      const provMatch = selectedProvider === 'all' || getProviderKey(s) === selectedProvider;
      return catMatch && provMatch;
    });
    if (matching.length > 0) {
      const currentMatching = matching.find((s) => s.id === activeServerId);
      if (!currentMatching) {
        onSelectServer(matching[0]);
      }
    } else {
      // Fallback across all providers if current provider doesn't have this audio category
      const anyMatching = servers.filter((s) => getAudioCategory(s) === cat);
      if (anyMatching.length > 0) {
        setSelectedProvider('all');
        onSelectServer(anyMatching[0]);
      }
    }
  };

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

      {/* Top Header & Filters */}
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

        {/* Filter Controls: Provider Selection + Audio Selection */}
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
          {/* Provider Selection Tabs */}
          {availableProviders.length > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase' }}>
                Provider:
              </span>
              <div
                style={{
                  display: 'flex',
                  gap: '4px',
                  background: 'rgba(0, 0, 0, 0.35)',
                  padding: '3px',
                  borderRadius: '8px',
                  border: '1px solid rgba(255, 255, 255, 0.05)',
                }}
              >
                {availableProviders.map(({ key, name, icon }) => {
                  const isSelected = key === selectedProvider;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => handleProviderClick(key)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '5px 12px',
                        borderRadius: '6px',
                        fontSize: '0.8rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                        border: 'none',
                        background: isSelected ? 'var(--brand, #6366f1)' : 'transparent',
                        color: isSelected ? '#fff' : '#94a3b8',
                        boxShadow: isSelected ? '0 2px 8px rgba(99, 102, 241, 0.4)' : 'none',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <span>{icon}</span>
                      <span>{name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Audio Category Tabs (SUB / DUB / HINDI) */}
          {availableCategories.length > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase' }}>
                Audio:
              </span>
              <div
                style={{
                  display: 'flex',
                  gap: '4px',
                  background: 'rgba(0, 0, 0, 0.35)',
                  padding: '3px',
                  borderRadius: '8px',
                  border: '1px solid rgba(255, 255, 255, 0.05)',
                }}
              >
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
                        padding: '5px 12px',
                        borderRadius: '6px',
                        fontSize: '0.78rem',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        cursor: 'pointer',
                        border: 'none',
                        background: isSelected
                          ? cat === 'dub'
                            ? '#d97706'
                            : 'var(--brand, #6366f1)'
                          : 'transparent',
                        color: isSelected ? '#fff' : '#94a3b8',
                        boxShadow: isSelected
                          ? cat === 'dub'
                            ? '0 2px 8px rgba(217, 119, 6, 0.4)'
                            : '0 2px 8px rgba(99, 102, 241, 0.4)'
                          : 'none',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <Headphones size={12} />
                      {cat}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Grid of Servers for Selected Provider & Audio */}
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
          {servers.length === 0
            ? 'No streaming servers currently available for this title.'
            : `No ${selectedCategory.toUpperCase()} servers available for ${selectedProvider === 'all' ? 'this title' : selectedProvider}.`}
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
