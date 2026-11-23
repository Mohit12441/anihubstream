import React, { useState, useEffect } from 'react';
import { PlusCircle, ThumbsUp, Search, CheckCircle2, Clock, Play, AlertCircle, Sparkles, Check } from 'lucide-react';
import { Link } from 'react-router-dom';
import { getUserPersona } from '../lib/userSession';
import { useSEO } from '../lib/useSEO';
import '../styles/pages.css';

export interface AnimeRequestItem {
  id: string;
  title: string;
  nativeTitle?: string | null;
  anilistId?: number | null;
  malId?: number | null;
  year?: number | null;
  notes?: string | null;
  status: 'pending' | 'in_progress' | 'completed' | 'rejected';
  voteCount: number;
  requesterName: string;
  requesterUid: string;
  animeId?: string | null;
  createdAt: number;
  updatedAt: number;
  hasVoted: boolean;
}

export function Requests() {
  const [requests, setRequests] = useState<AnimeRequestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'in_progress' | 'completed'>('all');
  const [sortOrder, setSortOrder] = useState<'popular' | 'recent'>('popular');
  const [searchTerm, setSearchTerm] = useState('');
  const [persona] = useState(getUserPersona);

  // Modal State
  const [showModal, setShowModal] = useState(false);
  const [formTitle, setFormTitle] = useState('');
  const [formYear, setFormYear] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [formAnilistId, setFormAnilistId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  // Live duplicate detection
  const [duplicateWarning, setDuplicateWarning] = useState<{ existsInCatalog?: boolean; slug?: string; alreadyRequested?: boolean } | null>(null);

  useSEO({
    title: 'Request Anime — Community Queue & Status Tracker | AniHubStream',
    description: 'Request new anime series and movies to be added to AniHubStream. Vote on community favorites and track fulfillment status from pending to completed.',
    canonicalUrl: 'https://anihubstream.com/requests',
  });

  const fetchRequests = async () => {
    setLoading(true);
    try {
      const q = searchTerm.trim() ? `&q=${encodeURIComponent(searchTerm.trim())}` : '';
      const res = await fetch(`/api/requests?status=${statusFilter}&sort=${sortOrder}${q}&userUid=${encodeURIComponent(persona.uid)}`);
      const data = await res.json();
      if (data.requests) {
        setRequests(data.requests);
      }
    } catch {}
    finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRequests();
  }, [statusFilter, sortOrder, searchTerm]);

  // Handle vote toggle
  const handleVote = async (requestId: string) => {
    try {
      // Optimistic update
      setRequests((prev) =>
        prev.map((r) => {
          if (r.id === requestId) {
            const nextVoted = !r.hasVoted;
            return {
              ...r,
              hasVoted: nextVoted,
              voteCount: r.voteCount + (nextVoted ? 1 : -1),
            };
          }
          return r;
        })
      );

      const res = await fetch(`/api/requests/${encodeURIComponent(requestId)}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userUid: persona.uid }),
      });
      const data = await res.json();
      if (data.success) {
        setRequests((prev) =>
          prev.map((r) => (r.id === requestId ? { ...r, voteCount: data.voteCount, hasVoted: data.hasVoted } : r))
        );
      }
    } catch {}
  };

  // Submit request form
  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formTitle.trim() || submitting) return;

    setSubmitting(true);
    setFormError(null);
    setFormSuccess(null);

    try {
      const res = await fetch('/api/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: formTitle.trim(),
          year: formYear ? parseInt(formYear, 10) : null,
          anilistId: formAnilistId ? parseInt(formAnilistId, 10) : null,
          notes: formNotes.trim(),
          requesterName: persona.name,
          requesterUid: persona.uid,
        }),
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        setFormError(data.message || 'Failed to submit request.');
      } else if (data.alreadyExists) {
        setFormError(`Good news! "${data.animeTitle}" is already on AniHubStream!`);
        setDuplicateWarning({ existsInCatalog: true, slug: data.animeId });
      } else if (data.alreadyRequested) {
        setFormSuccess(data.message);
        setTimeout(() => {
          setShowModal(false);
          setFormTitle('');
          setFormNotes('');
          setFormSuccess(null);
          fetchRequests();
        }, 2000);
      } else {
        setFormSuccess('Request submitted! It is now live in the community queue.');
        setTimeout(() => {
          setShowModal(false);
          setFormTitle('');
          setFormNotes('');
          setFormYear('');
          setFormAnilistId('');
          setFormSuccess(null);
          fetchRequests();
        }, 1500);
      }
    } catch (err: any) {
      setFormError('Network error while submitting request.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page requests-page">
      <div className="shell">
        {/* Header */}
        <header className="requests-head">
          <div className="requests-head-content">
            <span className="eyebrow"><Sparkles size={14} /> Community Queue</span>
            <h1>Anime Requests</h1>
            <p className="requests-lede">
              Can't find your favorite anime? Submit a request and vote on community favorites. 
              Our automated ingestion pipeline prioritizes the highest voted anime!
            </p>
          </div>
          <button
            type="button"
            className="request-submit-trigger-btn"
            onClick={() => setShowModal(true)}
          >
            <PlusCircle size={18} />
            <span>Request Anime</span>
          </button>
        </header>

        {/* Filters and Search Toolbar */}
        <div className="requests-toolbar">
          <div className="requests-status-tabs">
            <button
              type="button"
              className={`status-tab ${statusFilter === 'all' ? 'active' : ''}`}
              onClick={() => setStatusFilter('all')}
            >
              All Requests
            </button>
            <button
              type="button"
              className={`status-tab ${statusFilter === 'pending' ? 'active' : ''}`}
              onClick={() => setStatusFilter('pending')}
            >
              Pending Review
            </button>
            <button
              type="button"
              className={`status-tab ${statusFilter === 'in_progress' ? 'active' : ''}`}
              onClick={() => setStatusFilter('in_progress')}
            >
              In Progress
            </button>
            <button
              type="button"
              className={`status-tab ${statusFilter === 'completed' ? 'active' : ''}`}
              onClick={() => setStatusFilter('completed')}
            >
              Completed ✓
            </button>
          </div>

          <div className="requests-search-sort">
            <div className="search-input-wrap">
              <Search size={16} className="search-icon" />
              <input
                type="text"
                placeholder="Search requests..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>

            <div className="sort-select-wrap">
              <select
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value as 'popular' | 'recent')}
              >
                <option value="popular">Most Wanted</option>
                <option value="recent">Recently Added</option>
              </select>
            </div>
          </div>
        </div>

        {/* Requests Cards Grid */}
        <div className="requests-grid">
          {loading ? (
            <div className="requests-loading">
              <div className="skeleton-card" />
              <div className="skeleton-card" />
              <div className="skeleton-card" />
            </div>
          ) : requests.length === 0 ? (
            <div className="requests-empty">
              <AlertCircle size={40} className="empty-icon" />
              <h3>No requests found</h3>
              <p>Be the first to request an anime or try a different filter!</p>
              <button
                type="button"
                className="btn-accent"
                onClick={() => setShowModal(true)}
              >
                Request an Anime Now
              </button>
            </div>
          ) : (
            requests.map((item) => (
              <div key={item.id} className={`request-card request-card--${item.status}`}>
                <div className="request-card-vote">
                  <button
                    type="button"
                    className={`vote-btn ${item.hasVoted ? 'voted' : ''}`}
                    onClick={() => handleVote(item.id)}
                    title={item.hasVoted ? 'Remove upvote' : 'Upvote this request'}
                  >
                    <ThumbsUp size={16} fill={item.hasVoted ? 'currentColor' : 'none'} />
                    <span className="vote-num">{item.voteCount}</span>
                  </button>
                </div>

                <div className="request-card-info">
                  <div className="request-card-top">
                    <span className={`request-status-pill request-status-pill--${item.status}`}>
                      {item.status === 'completed' && <CheckCircle2 size={12} />}
                      {item.status === 'in_progress' && <Clock size={12} />}
                      {item.status === 'pending' && 'Pending'}
                      {item.status === 'in_progress' && 'In Progress'}
                      {item.status === 'completed' && 'Completed'}
                      {item.status === 'rejected' && 'Unavailable'}
                    </span>
                    {item.year && <span className="request-year-badge">{item.year}</span>}
                  </div>

                  <h3 className="request-card-title">{item.title}</h3>

                  {item.notes && <p className="request-card-notes">"{item.notes}"</p>}

                  <div className="request-card-footer">
                    <span className="requester-label">Requested by <b>@{item.requesterName}</b></span>

                    {item.status === 'completed' && item.animeId ? (
                      <Link to={`/watch/${item.animeId}/1`} className="watch-now-pill">
                        <Play size={12} fill="currentColor" />
                        <span>Watch Now</span>
                      </Link>
                    ) : (
                      <span className="request-date">
                        {new Date(item.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Submit Request Modal */}
        {showModal && (
          <div className="modal-backdrop" onClick={() => setShowModal(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <div className="modal-head">
                <h2>Request an Anime</h2>
                <button type="button" className="modal-close" onClick={() => setShowModal(false)}>✕</button>
              </div>

              <form onSubmit={handleFormSubmit} className="request-modal-form">
                <div className="form-group">
                  <label htmlFor="req-title">Anime Title *</label>
                  <input
                    id="req-title"
                    type="text"
                    required
                    placeholder="e.g. Hunter x Hunter, Bleach, etc."
                    value={formTitle}
                    onChange={(e) => setFormTitle(e.target.value)}
                    maxLength={150}
                  />
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="req-year">Release Year (Optional)</label>
                    <input
                      id="req-year"
                      type="number"
                      placeholder="e.g. 2011"
                      min={1960}
                      max={2030}
                      value={formYear}
                      onChange={(e) => setFormYear(e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="req-anilist">AniList ID / MAL ID (Optional)</label>
                    <input
                      id="req-anilist"
                      type="number"
                      placeholder="e.g. 11061"
                      value={formAnilistId}
                      onChange={(e) => setFormAnilistId(e.target.value)}
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label htmlFor="req-notes">Notes or Version Preference</label>
                  <textarea
                    id="req-notes"
                    rows={2}
                    placeholder="e.g. Please add English Dub or Uncensored version if available..."
                    value={formNotes}
                    onChange={(e) => setFormNotes(e.target.value)}
                    maxLength={300}
                  />
                </div>

                {formError && (
                  <div className="form-alert form-alert--error">
                    {formError}
                    {duplicateWarning?.slug && (
                      <Link to={`/watch/${duplicateWarning.slug}/1`} className="alert-link">
                        Click here to Watch Now
                      </Link>
                    )}
                  </div>
                )}

                {formSuccess && (
                  <div className="form-alert form-alert--success">
                    <Check size={16} /> {formSuccess}
                  </div>
                )}

                <div className="modal-actions">
                  <button type="button" className="btn-secondary" onClick={() => setShowModal(false)}>
                    Cancel
                  </button>
                  <button type="submit" className="btn-primary" disabled={submitting || !formTitle.trim()}>
                    {submitting ? 'Submitting...' : 'Submit Request'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
