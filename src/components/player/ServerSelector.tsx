import { useEffect, useRef, useState } from 'react';
import { CloudOff, RefreshCw, Server } from 'lucide-react';
import { SERVER_STATUS_LABEL, type StreamServer } from '../../data/servers';
import { PopShell } from './PopRows';
import { useMenuNav } from './useMenuNav';

interface Props {
  servers: StreamServer[];
  currentId: string;
  onSelect: (id: string) => void;
  /** re-probe the real bridge for this entry */
  onRetry?: (id: string) => void;
  onClose: () => void;
}

export function ServerSelector({ servers, currentId, onSelect, onRetry, onClose }: Props) {
  const [retrying, setRetrying] = useState<string | null>(null);
  const pending = useRef<number | null>(null);
  const { ref } = useMenuNav<HTMLDivElement>(true);

  useEffect(() => () => { if (pending.current) window.clearTimeout(pending.current); }, []);

  const retry = (s: StreamServer) => {
    setRetrying(s.id);
    onRetry?.(s.id);
    if (pending.current) window.clearTimeout(pending.current);
    pending.current = window.setTimeout(() => setRetrying(null), 900);
  };

  return (
    <PopShell
      label="Stream server"
      innerRef={ref}
      footer="Choose your streaming server. 'Auto (Fastest)' automatically connects to the server with the lowest latency."
    >
      <ul className="pop__list no-bar">
        {servers.map((s) => {
          const active = s.id === currentId;
          const dead = s.status === 'unavailable';
          return (
            <li key={s.id} className="pop__li">
              <button
                type="button"
                role="menuitemradio"
                aria-checked={active}
                disabled={dead}
                className={`pop__row pop__server${active ? ' is-on' : ''}`}
                onClick={() => {
                  onSelect(s.id);
                  onClose();
                }}
              >
                <span className="pop__ico">
                  {dead ? <CloudOff size={16} aria-hidden="true" /> : <Server size={16} aria-hidden="true" />}
                </span>
                <span className="pop__label">
                  {s.name}
                  <small>
                    {s.region} ·{' '}
                    {s.capabilities.qualities.length
                      ? `up to ${s.capabilities.qualities[s.capabilities.qualities.length - 1]}`
                      : 'no quality ladder'}
                  </small>
                  <small className="pop__src">{s.note}</small>
                </span>
                <span className={`pop__status pop__status--${s.status}`}>{SERVER_STATUS_LABEL[s.status]}</span>
              </button>
              {dead && (
                <button type="button" className="pop__retry" onClick={() => retry(s)}>
                  <RefreshCw size={13} aria-hidden="true" className={retrying === s.id ? 'spin' : undefined} />
                  {retrying === s.id ? 'Re-checking…' : 'Retry availability'}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </PopShell>
  );
}
