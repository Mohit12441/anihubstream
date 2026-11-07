import { Server } from 'lucide-react';
import type { PlayServer } from './PlayerInput';
import { PopGroup, PopRow, PopShell } from './PopRows';
import { useMenuNav } from './useMenuNav';

export interface ServerPopoverProps {
  servers: PlayServer[];
  activeServerId: string;
  onSelectServer: (server: PlayServer) => void;
  isOpen: boolean;
  onClose: () => void;
}

export function cleanServerName(server: PlayServer): string {
  let raw = server.name || server.id;
  if (raw.includes('·')) raw = raw.split('·')[1].trim();
  if (raw.includes(':')) raw = raw.split(':')[1].trim();
  raw = raw.replace(/\s*\((?:sub|dub|hindi)\)/i, '').trim();
  return raw;
}

export const PROVIDER_ORDER = ['AniKoto', 'HiAnime', 'AniWatch', 'AniPM', 'P2P'];

export function getProvider(server: PlayServer): string {
  const p = (server.provider || (server.id.includes(':') ? server.id.split(':')[0] : 'anikoto')).toLowerCase();
  if (p.includes('anikoto')) return 'AniKoto';
  if (p.includes('hianime')) return 'HiAnime';
  if (p.includes('aniwatch')) return 'AniWatch';
  if (p.includes('anipm')) return 'AniPM';
  if (p.includes('torrent') || p.includes('p2p')) return 'P2P';
  return p.charAt(0).toUpperCase() + p.slice(1);
}

const PROVIDER_METAS: Record<string, { tag: string; desc: string }> = {
  AniKoto: { tag: 'HD-1 • Vidstream', desc: '4 Mirrors • Fast Edge' },
  HiAnime: { tag: 'Multi-Quality', desc: 'Direct HLS' },
  AniWatch: { tag: 'Rapid Edge', desc: 'Global CDN' },
  AniPM: { tag: 'Settlar HD', desc: 'Partner Feed' },
  P2P: { tag: 'WebTorrent', desc: 'P2P Swarm' },
};

export function ServerPopover({
  servers,
  activeServerId,
  onSelectServer,
  isOpen,
  onClose,
}: ServerPopoverProps) {
  const { ref } = useMenuNav<HTMLDivElement>(isOpen);

  if (!isOpen || servers.length === 0) return null;

  const activeServer = servers.find((s) => s.id === activeServerId) || servers[0];
  const activeProvider = activeServer ? getProvider(activeServer) : 'AniKoto';
  const isDub = (activeServer?.audio || '').toLowerCase() === 'dub' || (activeServer?.id || '').includes('-dub');

  const handleSelectProvider = (provName: string) => {
    const norm = provName.toLowerCase();
    // Select the best matching server for this provider honoring current audio (sub/dub)
    const match = servers.find((s) => {
      const p = getProvider(s).toLowerCase();
      const serverDub = s.id.includes('-dub') || (s.audio || '').toLowerCase() === 'dub';
      return p.includes(norm) && (isDub ? serverDub : !serverDub);
    }) || servers.find((s) => getProvider(s).toLowerCase().includes(norm));

    if (match) {
      onSelectServer(match);
    }
    onClose();
  };

  return (
    <div onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <PopShell
        label="Stream Providers"
        innerRef={ref}
        head={
          <div className="pop__head" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Server size={16} color="#818cf8" aria-hidden="true" />
            <h3 style={{ margin: 0, fontSize: '0.92rem', fontWeight: 700 }}>Stream Provider</h3>
          </div>
        }
        footer="Subservers (mirrors) can be selected directly below the player."
      >
        <PopGroup title="Provider">
          {PROVIDER_ORDER.map((provName) => {
            const isSelected = activeProvider.toLowerCase() === provName.toLowerCase();
            const meta = PROVIDER_METAS[provName];
            return (
              <PopRow
                key={provName}
                radio
                active={isSelected}
                label={
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontWeight: 700, fontSize: '0.92rem' }}>{provName}</span>
                    {meta?.tag && (
                      <span
                        style={{
                          fontSize: '0.68rem',
                          fontWeight: 700,
                          padding: '1px 6px',
                          borderRadius: '4px',
                          background: isSelected ? 'rgba(255, 42, 95, 0.22)' : 'rgba(255, 255, 255, 0.08)',
                          color: isSelected ? '#ff5c8a' : '#94a3b8',
                        }}
                      >
                        {meta.tag}
                      </span>
                    )}
                  </span>
                }
                note={isSelected ? 'active' : undefined}
                onClick={() => handleSelectProvider(provName)}
              />
            );
          })}
        </PopGroup>
      </PopShell>
    </div>
  );
}
