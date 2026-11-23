import React, { useState, useEffect, useMemo } from 'react';
import { MessageSquare, Heart, CornerDownRight, AlertTriangle, Send, Clock } from 'lucide-react';
import { getUserPersona, saveUserPersona, AVATAR_PRESETS } from '../lib/userSession';

export interface CommentItem {
  id: string;
  animeId: string;
  episodeN: number | null;
  parentId: string | null;
  authorName: string;
  authorUid: string;
  authorAvatar: string;
  content: string;
  hasSpoiler: boolean;
  likes: number;
  isPinned: boolean;
  createdAt: number;
  hasLiked: boolean;
  replies: CommentItem[];
}

interface CommentsSectionProps {
  animeId: string;
  animeTitle?: string;
  currentEpisode?: number | null;
  onSeek?: (seconds: number) => void;
}

export function CommentsSection({ animeId, animeTitle, currentEpisode = null, onSeek }: CommentsSectionProps) {
  const [activeTab, setActiveTab] = useState<'episode' | 'series'>(currentEpisode !== null ? 'episode' : 'series');
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // User Persona State
  const [persona, setPersona] = useState(getUserPersona);
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(persona.name);

  // New Comment Form State
  const [content, setContent] = useState('');
  const [hasSpoiler, setHasSpoiler] = useState(false);
  const [replyingTo, setReplyingTo] = useState<CommentItem | null>(null);

  // Revealed spoilers set
  const [revealedSpoilers, setRevealedSpoilers] = useState<Set<string>>(new Set());

  const currentAvatar = useMemo(() => {
    return AVATAR_PRESETS.find((a) => a.id === persona.avatar) || AVATAR_PRESETS[0];
  }, [persona.avatar]);

  // Load comments
  const fetchComments = async () => {
    if (!animeId) return;
    setLoading(true);
    setError(null);
    try {
      const epQuery = activeTab === 'episode' && currentEpisode !== null ? `&episodeN=${currentEpisode}` : '';
      const res = await fetch(`/api/comments?animeId=${encodeURIComponent(animeId)}${epQuery}&userUid=${encodeURIComponent(persona.uid)}`);
      const data = await res.json();
      if (data.comments) {
        setComments(data.comments);
      }
    } catch (err: any) {
      setError('Could not load comments.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchComments();
  }, [animeId, currentEpisode, activeTab]);

  // Timestamp seeker helper
  const handleTimestampClick = (timeStr: string) => {
    const parts = timeStr.split(':').map(Number);
    let sec = 0;
    if (parts.length === 2) {
      sec = parts[0] * 60 + parts[1];
    } else if (parts.length === 3) {
      sec = parts[0] * 3600 + parts[1] * 60 + parts[2];
    }

    if (onSeek) {
      onSeek(sec);
    } else {
      window.dispatchEvent(new CustomEvent('anihub:seek', { detail: { seconds: sec } }));
    }
  };

  // Submit new comment or reply
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim() || submitting) return;

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch('/api/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          animeId,
          episodeN: activeTab === 'episode' ? currentEpisode : null,
          parentId: replyingTo?.id || null,
          authorName: persona.name,
          authorUid: persona.uid,
          authorAvatar: persona.avatar,
          content: content.trim(),
          hasSpoiler,
        }),
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        setError(data.message || 'Failed to post comment.');
      } else if (data.comment) {
        setContent('');
        setHasSpoiler(false);
        setReplyingTo(null);

        // Optimistically prepend or nest comment
        if (replyingTo) {
          setComments((prev) =>
            prev.map((c) =>
              c.id === replyingTo.id ? { ...c, replies: [...(c.replies || []), data.comment] } : c
            )
          );
        } else {
          setComments((prev) => [data.comment, ...prev]);
        }
      }
    } catch (err: any) {
      setError('Network error while posting comment.');
    } finally {
      setSubmitting(false);
    }
  };

  // Toggle Like
  const handleLike = async (commentId: string) => {
    try {
      const res = await fetch(`/api/comments/${encodeURIComponent(commentId)}/like`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userUid: persona.uid }),
      });
      const data = await res.json();
      if (data.success) {
        const updateTree = (items: CommentItem[]): CommentItem[] =>
          items.map((item) => {
            if (item.id === commentId) {
              return { ...item, hasLiked: data.hasLiked, likes: data.likes };
            }
            if (item.replies && item.replies.length > 0) {
              return { ...item, replies: updateTree(item.replies) };
            }
            return item;
          });

        setComments(updateTree);
      }
    } catch {}
  };

  // Render text with clickable timestamps & bold/spoiler tags
  const renderFormattedContent = (text: string, commentId: string, hasOverallSpoiler: boolean) => {
    const isRevealed = revealedSpoilers.has(commentId);

    if (hasOverallSpoiler && !isRevealed) {
      return (
        <div
          className="comment-spoiler-mask"
          onClick={() => setRevealedSpoilers((prev) => new Set(prev).add(commentId))}
          role="button"
          tabIndex={0}
        >
          <AlertTriangle size={15} className="spoiler-icon" />
          <span>Warning: Spoiler content. Click to reveal.</span>
        </div>
      );
    }

    // Parse timestamps (e.g. 02:45 or 1:23:45)
    const timestampRegex = /\b(\d{1,2}:\d{2}(?::\d{2})?)\b/g;
    const parts = text.split(timestampRegex);

    return (
      <div className="comment-text-body">
        {parts.map((part, i) => {
          if (timestampRegex.test(part)) {
            return (
              <button
                key={i}
                type="button"
                className="comment-timestamp-pill"
                onClick={() => handleTimestampClick(part)}
                title={`Jump video to ${part}`}
              >
                <Clock size={11} />
                <span>{part}</span>
              </button>
            );
          }
          return <span key={i}>{part}</span>;
        })}
      </div>
    );
  };

  // Render single comment node
  const renderComment = (item: CommentItem, isReply = false) => {
    const avatar = AVATAR_PRESETS.find((a) => a.id === item.authorAvatar) || AVATAR_PRESETS[0];

    return (
      <div key={item.id} className={`comment-card ${isReply ? 'comment-card--reply' : ''}`}>
        <div className="comment-avatar" style={{ backgroundColor: `${avatar.color}22`, borderColor: avatar.color }}>
          <span className="comment-avatar-icon">{avatar.icon}</span>
        </div>

        <div className="comment-main">
          <div className="comment-header">
            <span className="comment-author-name">{item.authorName}</span>
            {item.isPinned && <span className="comment-badge comment-badge--pinned">Pinned</span>}
            {item.hasSpoiler && <span className="comment-badge comment-badge--spoiler">Spoiler</span>}
            <span className="comment-time">
              {new Date(item.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </span>
          </div>

          <div className="comment-content">
            {renderFormattedContent(item.content, item.id, item.hasSpoiler)}
          </div>

          <div className="comment-actions">
            <button
              type="button"
              className={`comment-action-btn ${item.hasLiked ? 'active' : ''}`}
              onClick={() => handleLike(item.id)}
            >
              <Heart size={14} fill={item.hasLiked ? 'currentColor' : 'none'} />
              <span>{item.likes > 0 ? item.likes : 'Like'}</span>
            </button>

            {!isReply && (
              <button
                type="button"
                className="comment-action-btn"
                onClick={() => {
                  setReplyingTo(item);
                  document.getElementById('comments-input-box')?.focus();
                }}
              >
                <CornerDownRight size={14} />
                <span>Reply</span>
              </button>
            )}
          </div>

          {/* Nested Replies */}
          {item.replies && item.replies.length > 0 && (
            <div className="comment-replies-list">
              {item.replies.map((reply) => renderComment(reply, true))}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="comments-section">
      <div className="comments-header-bar">
        <div className="comments-title-wrap">
          <MessageSquare size={20} className="comments-title-icon" />
          <h3>{animeTitle ? `Discussion · ${animeTitle}` : 'Discussion'}</h3>
          <span className="comments-count-pill">{comments.length}</span>
        </div>

        {/* Tab switch: Episode vs Series */}
        {currentEpisode !== null && (
          <div className="comments-tab-switch">
            <button
              type="button"
              className={`comments-tab ${activeTab === 'episode' ? 'active' : ''}`}
              onClick={() => setActiveTab('episode')}
            >
              Episode {currentEpisode}
            </button>
            <button
              type="button"
              className={`comments-tab ${activeTab === 'series' ? 'active' : ''}`}
              onClick={() => setActiveTab('series')}
            >
              All Series
            </button>
          </div>
        )}
      </div>

      {/* User Persona Profile Bar */}
      <div className="comments-persona-bar">
        <div className="persona-chip" onClick={() => setShowAvatarPicker(!showAvatarPicker)}>
          <span className="persona-avatar-bubble" style={{ backgroundColor: currentAvatar.color }}>
            {currentAvatar.icon}
          </span>
          {editingName ? (
            <input
              type="text"
              className="persona-name-input"
              value={nameInput}
              autoFocus
              maxLength={25}
              onChange={(e) => setNameInput(e.target.value)}
              onBlur={() => {
                setEditingName(false);
                if (nameInput.trim()) setPersona(saveUserPersona({ name: nameInput }));
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  setEditingName(false);
                  if (nameInput.trim()) setPersona(saveUserPersona({ name: nameInput }));
                }
              }}
            />
          ) : (
            <span
              className="persona-name"
              title="Click to edit nickname"
              onClick={(e) => {
                e.stopPropagation();
                setEditingName(true);
              }}
            >
              {persona.name} ✎
            </span>
          )}
        </div>

        {showAvatarPicker && (
          <div className="avatar-picker-dropdown">
            <p className="avatar-picker-label">Choose your avatar:</p>
            <div className="avatar-picker-grid">
              {AVATAR_PRESETS.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className={`avatar-option ${persona.avatar === a.id ? 'active' : ''}`}
                  onClick={() => {
                    setPersona(saveUserPersona({ avatar: a.id }));
                    setShowAvatarPicker(false);
                  }}
                  title={a.name}
                >
                  <span className="avatar-option-icon">{a.icon}</span>
                  <span className="avatar-option-name">{a.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* New Comment / Reply Box */}
      <form className="comments-form" onSubmit={handleSubmit}>
        {replyingTo && (
          <div className="comment-replying-banner">
            <span>Replying to <b>@{replyingTo.authorName}</b></span>
            <button type="button" onClick={() => setReplyingTo(null)}>✕ Cancel</button>
          </div>
        )}

        <div className="comment-input-wrap">
          <textarea
            id="comments-input-box"
            className="comment-textarea"
            rows={3}
            placeholder={
              replyingTo
                ? `Reply to @${replyingTo.authorName}...`
                : activeTab === 'episode'
                ? `Share your thoughts on Episode ${currentEpisode} (e.g. "Loved the scene at 12:45!")...`
                : 'Leave a comment about this anime...'
            }
            value={content}
            onChange={(e) => setContent(e.target.value)}
            maxLength={1000}
            required
          />
        </div>

        <div className="comment-form-toolbar">
          <div className="toolbar-left">
            <label className="spoiler-toggle-label">
              <input
                type="checkbox"
                checked={hasSpoiler}
                onChange={(e) => setHasSpoiler(e.target.checked)}
              />
              <span className="spoiler-toggle-box" />
              <span>Mark as Spoiler</span>
            </label>
          </div>

          <div className="toolbar-right">
            <span className="char-counter">{content.length}/1000</span>
            <button
              type="submit"
              className="comment-submit-btn"
              disabled={submitting || !content.trim()}
            >
              <Send size={14} />
              <span>{submitting ? 'Posting...' : replyingTo ? 'Reply' : 'Comment'}</span>
            </button>
          </div>
        </div>

        {error && <div className="comment-error-banner">{error}</div>}
      </form>

      {/* Comments List */}
      <div className="comments-stream">
        {loading ? (
          <div className="comments-loading">
            <div className="skeleton-line" />
            <div className="skeleton-line short" />
          </div>
        ) : comments.length === 0 ? (
          <div className="comments-empty">
            <MessageSquare size={32} className="empty-icon" />
            <p>No comments yet. Be the first to start the discussion!</p>
          </div>
        ) : (
          comments.map((item) => renderComment(item))
        )}
      </div>
    </div>
  );
}
