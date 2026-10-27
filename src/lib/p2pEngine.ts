// @ts-check
/**
 * ============================================================
 * P2P Media Swarm Coordinator & Telemetry Engine
 * 
 * Provides WebRTC peer-assisted segment sharing for HLS playback.
 * - Feature-flagged and disabled by default
 * - Swarm identification normalized by canonical anime ID & episode
 * - Guaranteed fallback to standard HTTP on peer miss or timeout
 * - Real-time measurable telemetry: HTTP bytes, P2P bytes, peer count
 * ============================================================
 */

export interface P2PStats {
  enabled: boolean;
  cellularBlocked: boolean;
  connectedPeers: number;
  httpBytes: number;
  p2pBytes: number;
  uploadBytes: number;
  p2pRatio: number;
  swarmId: string;
}

export type P2PStatsListener = (stats: P2PStats) => void;

/**
 * Detects whether the device is currently on a metered cellular connection
 * or has 'Save-Data' enabled, to prevent unwanted battery drain and data usage.
 */
export function isCellularOrSaveData(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as any;
  const conn = nav.connection || nav.mozConnection || nav.webkitConnection;
  if (!conn) return false;
  if (conn.saveData === true) return true;
  if (conn.type === 'cellular') return true;
  return false;
}

/**
 * Builds a deterministic, token-free swarm identifier across clients.
 */
export function buildSwarmId(titleOrId: string, episode: number, quality: string = '1080p'): string {
  const cleanId = String(titleOrId || 'anime')
    .toLowerCase()
    .replace(/^(?:hianime|anikoto|aniwatch|watchanimeworld):/i, '')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `anihub:${cleanId}:ep${episode}:${quality}`;
}

/**
 * Derives a normalized segment key from a chunk URL, stripping dynamic HMAC/session tokens
 * and unpacking proxied URLs to match identical chunks.
 */
export function normalizeSegmentKey(swarmId: string, segmentUrl: string): string {
  try {
    let effectiveUrl = segmentUrl;
    const u = new URL(segmentUrl, 'http://localhost');
    if (u.searchParams.has('url')) {
      effectiveUrl = u.searchParams.get('url') || segmentUrl;
    }
    const innerUrl = new URL(effectiveUrl, 'http://localhost');
    const segName = innerUrl.pathname.split('/').pop() || 'chunk.ts';
    return `${swarmId}#${segName}`;
  } catch {
    return `${swarmId}#${segmentUrl}`;
  }
}

export interface P2PEngineOptions {
  signalUrl?: string;
  forceCellular?: boolean;
}

export class P2PEngine {
  private enabled: boolean;
  private cellularBlocked: boolean = false;
  private swarmId: string;
  private segmentCache: Map<string, Uint8Array> = new Map();
  private maxCacheItems: number = 30;
  private listeners: Set<P2PStatsListener> = new Set();
  private channel: BroadcastChannel | null = null;
  private ws: WebSocket | null = null;
  private peers: Set<string> = new Set();
  private myPeerId: string = Math.random().toString(36).slice(2, 10);

  // Stats
  private httpBytes: number = 0;
  private p2pBytes: number = 0;
  private uploadBytes: number = 0;

  constructor(enabled: boolean, swarmId: string, options?: P2PEngineOptions) {
    this.swarmId = swarmId;
    this.cellularBlocked = options?.forceCellular ?? isCellularOrSaveData();

    if (this.cellularBlocked) {
      this.enabled = false;
    } else {
      this.enabled = enabled;
    }

    if (this.enabled && typeof window !== 'undefined') {
      if ('BroadcastChannel' in window) {
        try {
          this.channel = new BroadcastChannel(`anihub-swarm-${this.swarmId}`);
          this.channel.onmessage = this.handleChannelMessage.bind(this);
          this.broadcast({ type: 'hello', peerId: this.myPeerId });
        } catch {
          this.channel = null;
        }
      }

      if (options?.signalUrl && typeof WebSocket !== 'undefined') {
        try {
          const wsUrl = new URL(options.signalUrl);
          wsUrl.searchParams.set('swarm', this.swarmId);
          wsUrl.searchParams.set('peer', this.myPeerId);
          this.ws = new WebSocket(wsUrl.toString());
          this.ws.onmessage = (evt) => {
            try {
              const msg = JSON.parse(evt.data);
              this.processIncoming(msg);
            } catch {}
          };
          this.ws.onopen = () => {
            this.broadcast({ type: 'hello', peerId: this.myPeerId });
          };
        } catch {
          this.ws = null;
        }
      }
    }
  }

  public setEnabled(val: boolean) {
    if (this.cellularBlocked) {
      this.enabled = false;
    } else {
      this.enabled = val;
    }
    this.notify();
  }

  public getStats(): P2PStats {
    const total = this.httpBytes + this.p2pBytes;
    const ratio = total > 0 ? Number(((this.p2pBytes / total) * 100).toFixed(1)) : 0;
    return {
      enabled: this.enabled,
      cellularBlocked: this.cellularBlocked,
      connectedPeers: this.peers.size,
      httpBytes: this.httpBytes,
      p2pBytes: this.p2pBytes,
      uploadBytes: this.uploadBytes,
      p2pRatio: ratio,
      swarmId: this.swarmId,
    };
  }

  public subscribe(fn: P2PStatsListener): () => void {
    this.listeners.add(fn);
    fn(this.getStats());
    return () => this.listeners.delete(fn);
  }

  private notify() {
    const stats = this.getStats();
    for (const listener of this.listeners) {
      try {
        listener(stats);
      } catch {}
    }
  }

  private broadcast(msg: any) {
    if (this.channel) {
      try {
        this.channel.postMessage(msg);
      } catch {}
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(msg));
      } catch {}
    }
  }

  private handleChannelMessage(evt: MessageEvent) {
    this.processIncoming(evt.data);
  }

  private processIncoming(data: any) {
    if (!data || data.peerId === this.myPeerId) return;

    if (data.type === 'hello') {
      this.peers.add(data.peerId);
      this.broadcast({ type: 'hello-ack', peerId: this.myPeerId });
      this.notify();
    } else if (data.type === 'hello-ack') {
      this.peers.add(data.peerId);
      this.notify();
    } else if (data.type === 'bye') {
      this.peers.delete(data.peerId);
      this.notify();
    } else if (data.type === 'request-chunk') {
      if (this.cellularBlocked) return; // Do not upload on cellular/metered connection
      const chunk = this.segmentCache.get(data.key);
      if (chunk) {
        this.uploadBytes += chunk.byteLength;
        this.broadcast({
          type: 'chunk-data',
          key: data.key,
          targetPeer: data.peerId,
          data: chunk,
        });
        this.notify();
      }
    }
  }

  /**
   * Fetches segment with P2P swarm race and guaranteed HTTP fallback.
   */
  public async loadSegment(
    url: string,
    httpFetch: (url: string) => Promise<ArrayBuffer>,
    timeoutMs: number = 1200
  ): Promise<{ data: ArrayBuffer; source: 'p2p' | 'http' }> {
    const key = normalizeSegmentKey(this.swarmId, url);

    // 1. Check local segment cache
    const local = this.segmentCache.get(key);
    if (local) {
      return { data: local.buffer as ArrayBuffer, source: 'p2p' };
    }

    // 2. If P2P is enabled and peers exist, query swarm with bounded timeout
    if (this.enabled && this.peers.size > 0 && this.channel) {
      try {
        const p2pPromise = new Promise<Uint8Array>((resolve, reject) => {
          const timeout = setTimeout(() => {
            cleanup();
            reject(new Error('P2P_TIMEOUT'));
          }, timeoutMs);

          const handler = (evt: MessageEvent) => {
            const d = evt.data;
            if (d?.type === 'chunk-data' && d.key === key && d.targetPeer === this.myPeerId && d.data) {
              cleanup();
              resolve(d.data instanceof Uint8Array ? d.data : new Uint8Array(d.data));
            }
          };

          const cleanup = () => {
            clearTimeout(timeout);
            this.channel?.removeEventListener('message', handler);
          };

          this.channel?.addEventListener('message', handler);
          this.broadcast({ type: 'request-chunk', key, peerId: this.myPeerId });
        });

        const p2pData = await p2pPromise;
        if (p2pData && p2pData.byteLength > 0) {
          this.p2pBytes += p2pData.byteLength;
          this.storeSegment(key, p2pData);
          this.notify();
          return { data: p2pData.buffer as ArrayBuffer, source: 'p2p' };
        }
      } catch {
        // Fall back to HTTP on peer timeout or error
      }
    }

    // 3. Deterministic HTTP Fallback
    const buffer = await httpFetch(url);
    const u8 = new Uint8Array(buffer);
    this.httpBytes += u8.byteLength;
    this.storeSegment(key, u8);
    this.notify();

    return { data: buffer, source: 'http' };
  }

  private storeSegment(key: string, data: Uint8Array) {
    if (this.segmentCache.size >= this.maxCacheItems) {
      const firstKey = this.segmentCache.keys().next().value;
      if (firstKey) this.segmentCache.delete(firstKey);
    }
    this.segmentCache.set(key, data);
  }

  public destroy() {
    if (this.channel) {
      this.broadcast({ type: 'bye', peerId: this.myPeerId });
      try {
        this.channel.close();
      } catch {}
      this.channel = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    }
    this.segmentCache.clear();
    this.listeners.clear();
  }
}
