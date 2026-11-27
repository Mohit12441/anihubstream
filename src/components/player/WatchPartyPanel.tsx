import React, { useState, useEffect, useRef } from 'react';
import {
  Users,
  Check,
  Send,
  X,
  Radio,
  Crown,
  Sparkles,
  Edit2,
  User,
  Share2,
} from 'lucide-react';
import {
  WatchPartyClient,
  PartyMember,
  PartyMessage,
  PartyReaction,
  PARTY_EMOJIS,
  generateRoomCode,
  normalizeRoomCode,
  getStoredUsername,
  setStoredUsername,
} from '../../lib/watchParty';

interface Props {
  partyClient: WatchPartyClient | null;
  isOpen: boolean;
  onClose: () => void;
  onInitParty: (roomCode: string, isHost: boolean) => void;
  onLeaveParty: () => void;
  drift: number;
}

export function WatchPartyPanel({
  partyClient,
  isOpen,
  onClose,
  onInitParty,
  onLeaveParty,
  drift,
}: Props) {
  const [messages, setMessages] = useState<PartyMessage[]>([]);
  const [members, setMembers] = useState<PartyMember[]>([]);
  const [inputText, setInputText] = useState('');
  const [copied, setCopied] = useState(false);
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [floatingReactions, setFloatingReactions] = useState<PartyReaction[]>([]);
  const [displayName, setDisplayName] = useState(getStoredUsername());
  const [isEditingName, setIsEditingName] = useState(false);
  const [tempName, setTempName] = useState('');
  const [connStatus, setConnStatus] = useState<'connected' | 'connecting' | 'fallback'>('connected');
  const chatScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!partyClient) {
      setMessages([]);
      setMembers([]);
      return;
    }

    setMembers(partyClient.room.members);
    setConnStatus(partyClient.status);

    const unsubscribe = partyClient.subscribe((event) => {
      if (event.type === 'members') {
        setMembers(event.payload);
      } else if (event.type === 'status') {
        setConnStatus(event.payload.status);
      } else if (event.type === 'message') {
        setMessages((prev) => [...prev.slice(-49), event.payload]);
      } else if (event.type === 'reaction') {
        const reaction = event.payload as PartyReaction;
        setFloatingReactions((prev) => [...prev.slice(-15), reaction]);
        setTimeout(() => {
          setFloatingReactions((prev) => prev.filter((r) => r.id !== reaction.id));
        }, 2500);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [partyClient]);

  // Auto-scroll chat to bottom
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!partyClient || !inputText.trim()) return;
    partyClient.sendChatMessage(inputText);
    setInputText('');
  };

  const handleSendReaction = (emoji: string) => {
    if (!partyClient) return;
    partyClient.sendReaction(emoji);
  };

  const handleCopyLink = async () => {
    if (!partyClient) return;
    const url = new URL(window.location.href);
    url.searchParams.set('party', partyClient.roomId);
    const link = url.toString();

    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({
          title: 'Watch Party on AniHubStream',
          text: `Join my watch party! Room: ${partyClient.roomId}`,
          url: link,
        });
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        return;
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
      }
    }

    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  const handleCreateNew = () => {
    const code = generateRoomCode();
    onInitParty(code, true);
  };

  const handleJoinExisting = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = normalizeRoomCode(joinCodeInput);
    if (clean) {
      onInitParty(clean, false);
      setJoinCodeInput('');
    }
  };

  const handleSaveName = (newName: string) => {
    const clean = newName.trim().slice(0, 24);
    if (!clean) return;
    setStoredUsername(clean);
    setDisplayName(clean);
    if (partyClient) {
      partyClient.updateUsername(clean);
    }
    setIsEditingName(false);
  };

  if (!isOpen) return null;

  return (
    <div className="watch-party-panel" role="dialog" aria-label="Watch Party Drawer">
      {/* Floating Animated Reactions */}
      <div className="party-floating-reactions-layer" aria-hidden="true">
        {floatingReactions.map((r) => (
          <div key={r.id} className="party-floating-reaction">
            <span className="party-reaction-bubble">{r.emoji}</span>
            <span className="party-reaction-name">{r.senderName}</span>
          </div>
        ))}
      </div>

      {/* Header */}
      <div className="party-header">
        <div className="party-header-title">
          <Users size={18} className="party-icon" />
          <span>Watch Party</span>
          {partyClient && (
            <span className="party-badge-members">{members.length}</span>
          )}
        </div>
        <button
          type="button"
          className="party-close-btn"
          onClick={onClose}
          aria-label="Close Watch Party"
        >
          <X size={18} />
        </button>
      </div>

      {!partyClient ? (
        /* Not in a Room View (Setup) */
        <div className="party-setup-view">
          <div className="party-hero-card">
            <Sparkles size={28} className="party-sparkle-icon" />
            <h3>Watch Together in Sync</h3>
            <p>
              Stream synchronized playback with friends with real-time playhead drift
              compensation, viewer presence, and live reactions.
            </p>

            {/* User display name setting */}
            <div className="party-profile-box">
              <span className="party-profile-label">Your Name:</span>
              {isEditingName ? (
                <div className="party-profile-edit">
                  <input
                    type="text"
                    value={tempName}
                    onChange={(e) => setTempName(e.target.value)}
                    maxLength={24}
                    placeholder="Enter nickname"
                    className="party-input party-name-input"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveName(tempName);
                      if (e.key === 'Escape') setIsEditingName(false);
                    }}
                  />
                  <button
                    type="button"
                    className="party-action-btn party-save-btn"
                    onClick={() => handleSaveName(tempName)}
                    aria-label="Save name"
                  >
                    <Check size={14} />
                  </button>
                </div>
              ) : (
                <div className="party-profile-view">
                  <span className="party-profile-val">{displayName}</span>
                  <button
                    type="button"
                    className="party-edit-icon-btn"
                    onClick={() => {
                      setTempName(displayName);
                      setIsEditingName(true);
                    }}
                    title="Change your display name"
                    aria-label="Edit display name"
                  >
                    <Edit2 size={13} />
                  </button>
                </div>
              )}
            </div>

            <button
              type="button"
              className="party-btn party-btn-primary"
              onClick={handleCreateNew}
            >
              <Radio size={16} />
              <span>Create Watch Party</span>
            </button>
          </div>

          <div className="party-divider">
            <span>OR JOIN EXISTING</span>
          </div>

          <form onSubmit={handleJoinExisting} className="party-join-form">
            <input
              type="text"
              placeholder="Enter Room Code (e.g. AH-8X2Q)"
              value={joinCodeInput}
              onChange={(e) => setJoinCodeInput(e.target.value)}
              className="party-input"
            />
            <button
              type="submit"
              disabled={!joinCodeInput.trim()}
              className="party-btn party-btn-secondary"
            >
              Join Room
            </button>
          </form>
        </div>
      ) : (
        /* Active Room View */
        <div className="party-room-view">
          {/* Room Info Bar */}
          <div className="party-room-bar">
            <div className="party-code-box">
              <span className="party-code-label">ROOM:</span>
              <span className="party-code-text">{partyClient.roomId}</span>
            </div>
            <div className="party-actions-box">
              <button
                type="button"
                className="party-action-btn"
                onClick={handleCopyLink}
                title="Share or copy invite link"
              >
                {copied ? <Check size={14} className="text-green" /> : <Share2 size={14} />}
                <span>{copied ? 'Copied!' : 'Share Link'}</span>
              </button>
              <button
                type="button"
                className="party-action-btn party-leave-btn"
                onClick={onLeaveParty}
                title="Leave room"
              >
                Leave
              </button>
            </div>
          </div>

          {/* User Display Name & Connection Status Bar */}
          <div className="party-user-status-bar">
            <div className="party-user-info">
              <User size={13} className="party-user-icon" />
              <span className="party-watching-as">You:</span>
              {isEditingName ? (
                <div className="party-inline-name-edit">
                  <input
                    type="text"
                    value={tempName}
                    onChange={(e) => setTempName(e.target.value)}
                    maxLength={24}
                    className="party-input-sm"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveName(tempName);
                      if (e.key === 'Escape') setIsEditingName(false);
                    }}
                  />
                  <button
                    type="button"
                    className="party-name-save-btn-sm"
                    onClick={() => handleSaveName(tempName)}
                    title="Save name"
                  >
                    <Check size={12} />
                  </button>
                  <button
                    type="button"
                    className="party-name-cancel-btn-sm"
                    onClick={() => setIsEditingName(false)}
                    title="Cancel"
                  >
                    <X size={12} />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="party-name-chip"
                  onClick={() => {
                    setTempName(partyClient.user.name || displayName);
                    setIsEditingName(true);
                  }}
                  title="Click to edit your display name"
                >
                  <span className="party-chip-name">{partyClient.user.name}</span>
                  <Edit2 size={11} className="party-chip-edit-icon" />
                </button>
              )}
            </div>

            <div className="party-sync-status-compact">
              <span
                className={`party-sync-dot ${
                  Math.abs(drift) < 1.0 ? 'is-synced' : 'is-drifting'
                }`}
              />
              <span className="party-sync-text">
                {Math.abs(drift) < 1.0
                  ? (connStatus === 'connected' ? 'Synced (Live)' : 'Synced (Edge)')
                  : `${drift > 0 ? '+' : ''}${drift.toFixed(1)}s`}
              </span>
            </div>
          </div>

          {/* Connected Members List */}
          <div className="party-members-strip" aria-label="Room participants">
            {members.map((m) => {
              const isMe = m.id === partyClient.user.id;
              return (
                <div
                  key={m.id}
                  className={`party-member-chip ${isMe ? 'is-current-user' : ''}`}
                  title={`${m.name}${m.isHost ? ' (Host)' : ''}${isMe ? ' (You)' : ''}`}
                >
                  <div
                    className="party-member-avatar"
                    style={{ backgroundColor: m.color }}
                  >
                    <span>{m.name.charAt(0).toUpperCase()}</span>
                    {m.isHost && (
                      <Crown size={10} className="party-crown-badge" aria-label="Host" />
                    )}
                  </div>
                  <span className="party-member-name">
                    {m.name}
                    {isMe && <span className="party-you-tag"> (You)</span>}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Live Chat Messages Feed */}
          <div className="party-chat-scroll" ref={chatScrollRef}>
            {messages.length === 0 ? (
              <div className="party-empty-chat">
                <p>Welcome to the watch party! Send a message or react below.</p>
              </div>
            ) : (
              messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`party-message-row ${
                    msg.senderId === partyClient.user.id ? 'is-me' : ''
                  }`}
                >
                  <div className="party-message-meta">
                    <span
                      className="party-message-sender"
                      style={{ color: msg.color }}
                    >
                      {msg.senderName}
                      {msg.senderId === partyClient.user.id ? ' (You)' : ''}
                    </span>
                    <span className="party-message-time">
                      {new Date(msg.timestamp).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                  <div className="party-message-bubble">{msg.text}</div>
                </div>
              ))
            )}
          </div>

          {/* Quick Reaction Bar */}
          <div className="party-reaction-bar">
            {PARTY_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                className="party-reaction-btn"
                onClick={() => handleSendReaction(emoji)}
                aria-label={`React ${emoji}`}
              >
                {emoji}
              </button>
            ))}
          </div>

          {/* Chat Input Bar */}
          <form onSubmit={handleSendMessage} className="party-chat-input-bar">
            <input
              type="text"
              placeholder="Send message to room..."
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              className="party-chat-input"
              maxLength={200}
            />
            <button
              type="submit"
              disabled={!inputText.trim()}
              className="party-chat-send-btn"
              aria-label="Send message"
            >
              <Send size={15} />
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
