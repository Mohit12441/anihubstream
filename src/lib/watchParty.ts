/**
 * Watch Party & Real-Time Synchronized Playback Engine
 * Provides synchronized room playback, host authority, drift compensation,
 * user presence, live chat, and animated reactions.
 */

export interface PartyMember {
  id: string;
  name: string;
  isHost: boolean;
  color: string;
  joinedAt: number;
}

export interface PartyMessage {
  id: string;
  senderId: string;
  senderName: string;
  color: string;
  text: string;
  timestamp: number;
}

export interface PartyReaction {
  id: string;
  emoji: string;
  senderName: string;
  timestamp: number;
}

export interface PartyPlaybackState {
  playing: boolean;
  time: number;
  rate: number;
  timestamp: number; // millisecond timestamp
  senderId: string;
  senderName?: string;
  action?: 'play' | 'pause' | 'seek' | 'heartbeat';
}

const STORAGE_USERNAME_KEY = 'anihub_party_username';

export function getStoredUsername(): string {
  if (typeof window === 'undefined') return 'Viewer';
  try {
    const saved = localStorage.getItem(STORAGE_USERNAME_KEY);
    if (saved && saved.trim()) {
      return saved.trim().slice(0, 24);
    }
  } catch {}
  return `Otaku_${Math.floor(100 + Math.random() * 900)}`;
}

export function setStoredUsername(name: string): void {
  if (typeof window === 'undefined') return;
  try {
    const clean = name.trim().slice(0, 24);
    if (clean) {
      localStorage.setItem(STORAGE_USERNAME_KEY, clean);
    }
  } catch {}
}

export interface PartyRoom {
  roomId: string;
  animeId: string;
  episodeNumber: number;
  hostId: string;
  members: PartyMember[];
  playbackState: PartyPlaybackState;
  createdAt: number;
}

const AVATAR_COLORS = [
  '#38bdf8', '#818cf8', '#c084fc', '#f472b6',
  '#fb7185', '#fb923c', '#facc15', '#4ade80', '#2dd4bf',
];

export const PARTY_EMOJIS = ['🔥', '❤️', '😱', '✨', '🎉', '🤣', '👏', '😭'];

/**
 * Generates a clean, readable 6-character room code (e.g. "AH-8X2Q")
 */
export function generateRoomCode(): string {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `AH-${code}`;
}

/**
 * Normalizes user input room codes (e.g. "ah-8x2q" -> "AH-8X2Q")
 */
export function normalizeRoomCode(raw: string): string {
  if (!raw) return '';
  const clean = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (clean.startsWith('AH') && clean.length > 2) {
    return `AH-${clean.slice(2, 6)}`;
  }
  return clean.length >= 4 ? `AH-${clean.slice(0, 4)}` : clean;
}

/**
 * Calculates drift between local video time and remote playback state.
 * Returns difference in seconds (positive = local is ahead, negative = local is behind).
 */
export function calculateDrift(
  localTime: number,
  remoteState: PartyPlaybackState,
  now: number = Date.now()
): number {
  if (!remoteState.playing) {
    return localTime - remoteState.time;
  }
  const elapsedSeconds = Math.max(0, (now - remoteState.timestamp) / 1000) * (remoteState.rate || 1);
  const expectedRemoteTime = remoteState.time + elapsedSeconds;
  return localTime - expectedRemoteTime;
}

/**
 * Determines whether the playhead drift exceeds the sync tolerance threshold
 */
export function shouldSync(drift: number, thresholdSeconds: number = 1.5): boolean {
  return Math.abs(drift) > thresholdSeconds;
}

/**
 * Picks a deterministic avatar accent color for a user ID
 */
export function getMemberColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash << 5) - hash + userId.charCodeAt(i);
    hash |= 0;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export type PartyEventCallback = (event: {
  type: 'state' | 'members' | 'message' | 'reaction' | 'room' | 'status';
  payload: any;
}) => void;

/**
 * Client-Side Watch Party Controller
 * Manages WebSocket/BroadcastChannel messaging, drift correction, and event emission.
 */
export class WatchPartyClient {
  public roomId: string;
  public animeId: string;
  public episodeNumber: number;
  public user: PartyMember;
  public isHost: boolean;
  public room: PartyRoom;
  public status: 'connecting' | 'connected' | 'fallback' = 'connecting';

  private ws: WebSocket | null = null;
  private channel: BroadcastChannel | null = null;
  private listeners: Set<PartyEventCallback> = new Set();
  private isApplyingRemoteState: boolean = false;
  private fallbackPollTimer: any = null;
  private lastPollTimestamp: number = 0;

  constructor(
    roomId: string,
    animeId: string,
    episodeNumber: number,
    username: string = 'Viewer',
    isHost: boolean = false
  ) {
    this.roomId = normalizeRoomCode(roomId);
    this.animeId = animeId;
    this.episodeNumber = episodeNumber;
    this.isHost = isHost;

    const savedName = getStoredUsername();
    const effectiveName = (username && username !== 'Viewer') ? username : savedName;
    const userId = `usr_${Math.random().toString(36).slice(2, 9)}`;
    this.user = {
      id: userId,
      name: effectiveName.slice(0, 24),
      isHost,
      color: getMemberColor(userId),
      joinedAt: Date.now(),
    };

    this.room = {
      roomId: this.roomId,
      animeId,
      episodeNumber,
      hostId: isHost ? userId : '',
      members: [this.user],
      playbackState: {
        playing: false,
        time: 0,
        rate: 1,
        timestamp: Date.now(),
        senderId: userId,
        senderName: this.user.name,
      },
      createdAt: Date.now(),
    };

    this.initConnections();
  }

  private initConnections() {
    // 1. BroadcastChannel for same-origin multi-tab sync
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        this.channel = new BroadcastChannel(`anihub_party_${this.roomId}`);
        this.channel.onmessage = (event) => {
          this.handleIncomingMessage(event.data);
        };
      } catch {}
    }

    // 2. WebSocket connection to stream bridge party hub
    if (typeof WebSocket !== 'undefined') {
      try {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.hostname === 'localhost' ? '127.0.0.1:8795' : window.location.host;
        const wsUrl = `${protocol}//${host}/party-ws?room=${encodeURIComponent(this.roomId)}&user=${encodeURIComponent(this.user.name)}&uid=${this.user.id}&host=${this.isHost ? '1' : '0'}`;

        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
          this.status = 'connected';
          this.emit('status', { status: 'connected' });
          this.stopFallbackPolling();
          this.sendWsMessage({
            type: 'JOIN_ROOM',
            roomId: this.roomId,
            user: this.user,
          });
        };

        this.ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            this.handleIncomingMessage(data);
          } catch {}
        };

        this.ws.onerror = () => {
          this.startFallbackPolling();
        };

        this.ws.onclose = () => {
          this.startFallbackPolling();
        };
      } catch {
        this.startFallbackPolling();
      }
    } else {
      this.startFallbackPolling();
    }
  }

  private startFallbackPolling() {
    if (this.fallbackPollTimer) return;
    this.status = 'fallback';
    this.emit('status', { status: 'fallback' });

    // Initial announce to HTTP sync endpoint
    this.postToHttpSync({
      type: 'JOIN_ROOM',
      roomId: this.roomId,
      user: this.user,
    });

    this.fallbackPollTimer = setInterval(() => {
      this.pollHttpSync();
    }, 1200);
  }

  private stopFallbackPolling() {
    if (this.fallbackPollTimer) {
      clearInterval(this.fallbackPollTimer);
      this.fallbackPollTimer = null;
    }
  }

  private async pollHttpSync() {
    if (typeof window === 'undefined') return;
    try {
      const res = await fetch(`/api/party/sync?room=${encodeURIComponent(this.roomId)}&since=${this.lastPollTimestamp}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data && data.events && Array.isArray(data.events)) {
        for (const evt of data.events) {
          this.handleIncomingMessage(evt);
        }
      }
      this.lastPollTimestamp = Date.now();
    } catch {}
  }

  private async postToHttpSync(msg: any) {
    if (typeof window === 'undefined') return;
    try {
      await fetch('/api/party/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId: this.roomId,
          message: msg,
          senderId: this.user.id,
        }),
      });
    } catch {}
  }

  private sendWsMessage(msg: any) {
    let sentViaWs = false;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(msg));
        sentViaWs = true;
      } catch {}
    }
    if (this.channel) {
      try {
        this.channel.postMessage(msg);
      } catch {}
    }
    if (!sentViaWs && this.status === 'fallback') {
      this.postToHttpSync(msg);
    }
  }

  private handleIncomingMessage(msg: any) {
    if (!msg || !msg.type) return;

    if (msg.type === 'PLAYBACK_STATE') {
      const state = msg.payload as PartyPlaybackState;
      if (state.senderId === this.user.id) return; // Ignore own echoes

      this.room.playbackState = state;
      this.emit('state', state);
    } else if (msg.type === 'MEMBERS_UPDATE') {
      const members = msg.payload as PartyMember[];
      if (Array.isArray(members)) {
        // Ensure current user is in members list with latest state
        const hasMe = members.some(m => m.id === this.user.id);
        const effectiveMembers = hasMe ? members : [...members, this.user];
        this.room.members = effectiveMembers;
        this.emit('members', effectiveMembers);
      }
    } else if (msg.type === 'USER_UPDATE') {
      const payload = msg.payload as { id: string; name: string };
      if (payload && payload.id && payload.name) {
        const found = this.room.members.find(m => m.id === payload.id);
        if (found) {
          found.name = payload.name;
          this.emit('members', [...this.room.members]);
        }
      }
    } else if (msg.type === 'CHAT_MESSAGE') {
      this.emit('message', msg.payload);
    } else if (msg.type === 'REACTION') {
      this.emit('reaction', msg.payload);
    }
  }

  public subscribe(cb: PartyEventCallback): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private emit(type: 'state' | 'members' | 'message' | 'reaction' | 'room' | 'status', payload: any) {
    for (const listener of this.listeners) {
      listener({ type, payload });
    }
  }

  /**
   * Updates user display name, saves locally, and notifies peers
   */
  public updateUsername(newName: string) {
    const clean = newName.trim().slice(0, 24);
    if (!clean) return;

    this.user.name = clean;
    setStoredUsername(clean);

    // Update in room members
    const me = this.room.members.find(m => m.id === this.user.id);
    if (me) {
      me.name = clean;
    }
    this.emit('members', [...this.room.members]);

    this.sendWsMessage({
      type: 'USER_UPDATE',
      roomId: this.roomId,
      payload: { id: this.user.id, name: clean },
    });
  }

  /**
   * Broadcasts local playback action (play, pause, seek) to all connected peers
   */
  public broadcastPlayback(
    playing: boolean,
    time: number,
    action: 'play' | 'pause' | 'seek' | 'heartbeat' = 'play',
    rate: number = 1
  ) {
    if (this.isApplyingRemoteState) return;

    const state: PartyPlaybackState = {
      playing,
      time,
      rate,
      timestamp: Date.now(),
      senderId: this.user.id,
      senderName: this.user.name,
      action,
    };

    this.room.playbackState = state;
    this.sendWsMessage({
      type: 'PLAYBACK_STATE',
      roomId: this.roomId,
      payload: state,
    });
  }

  /**
   * Sends a chat message to the room
   */
  public sendChatMessage(text: string): PartyMessage | null {
    const trimmed = text.trim();
    if (!trimmed) return null;

    const message: PartyMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      senderId: this.user.id,
      senderName: this.user.name,
      color: this.user.color,
      text: trimmed.slice(0, 200),
      timestamp: Date.now(),
    };

    this.sendWsMessage({
      type: 'CHAT_MESSAGE',
      roomId: this.roomId,
      payload: message,
    });

    this.emit('message', message);
    return message;
  }

  /**
   * Sends an animated emoji reaction
   */
  public sendReaction(emoji: string): PartyReaction {
    const reaction: PartyReaction = {
      id: `react_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      emoji,
      senderName: this.user.name,
      timestamp: Date.now(),
    };

    this.sendWsMessage({
      type: 'REACTION',
      roomId: this.roomId,
      payload: reaction,
    });

    this.emit('reaction', reaction);
    return reaction;
  }

  public setApplyingRemoteState(val: boolean) {
    this.isApplyingRemoteState = val;
  }

  public destroy() {
    this.stopFallbackPolling();
    if (this.channel) {
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
    this.listeners.clear();
  }
}
