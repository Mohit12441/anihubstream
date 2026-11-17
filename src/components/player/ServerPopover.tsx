import { useMemo } from 'react';
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

export const PROVIDER_ORDER = ['AniKoto', 'HiAnime', 'AniWatch', 'AniPM', 'HDRezka', 'P2P'];

export function getProvider(server: PlayServer): string {
  const p = (server.provider || (server.id.includes(':') ? server.id.split(':')[0] : 'anikoto')).toLowerCase();
  if (p.includes('anikoto')) return 'AniKoto';
  if (p.includes('hianime')) return 'HiAnime';
  if (p.includes('aniwatch')) return 'AniWatch';
  if (p.includes('anipm')) return 'AniPM';
  if (p.includes('hdrezka')) return 'HDRezka';
  if (p.includes('torrent') || p.includes('p2p')) return 'P2P';
  return p.charAt(0).toUpperCase() + p.slice(1);
}

export function ServerPopover({
  servers,
  activeServerId,
  onSelectServer,
  isOpen,
  onClose,
}: ServerPopoverProps) {
  const { ref } = useMenuNav<HTMLDivElement>(isOpen);

  const groups = useMemo(() => {
    const map = new Map<string, PlayServer[]>();
    for (const s of servers) {
      const p = getProvider(s);
      if (!map.has(p)) map.set(p, []);
      map.get(p)!.push(s);
    }
    return Array.from(map.entries()).sort(([a], [b]) => {
      const ia = PROVIDER_ORDER.indexOf(a);
      const ib = PROVIDER_ORDER.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
  }, [servers]);

  if (!isOpen || servers.length === 0) return null;

  return (
    <div onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <PopShell
        label={groups.length === 1 ? `${groups[0][0]} Mirrors` : 'Streaming Servers'}
        innerRef={ref}
        head={
          <div className="pop__head" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Server size={16} color="#818cf8" aria-hidden="true" />
            <h3 style={{ margin: 0, fontSize: '0.92rem', fontWeight: 700 }}>
              {groups.length === 1 ? `${groups[0][0]} Mirrors` : 'Streaming Servers'}
            </h3>
          </div>
        }
        footer="Switch streaming providers or mirrors."
      >
        {groups.map(([providerName, provServers]) => (
          <PopGroup key={providerName} title={providerName}>
            {provServers.map((s) => {
              const isSelected = s.id === activeServerId;
              const name = s.name || cleanServerName(s);
              const isUnavailable = s.status === 'unavailable';
              const isRezka = providerName === 'HDRezka' || s.id.startsWith('hdrezka:');
              return (
                <PopRow
                  key={s.id}
                  radio
                  active={isSelected}
                  disabled={isUnavailable}
                  label={name}
                  note={isSelected ? 'active' : isRezka ? '1080p Ultra' : isUnavailable ? 'unavailable' : undefined}
                  onClick={!isUnavailable ? () => {
                    onSelectServer(s);
                    onClose();
                  } : () => {}}
                />
              );
            })}
          </PopGroup>
        ))}
      </PopShell>
    </div>
  );
}
