-- Migration 0043: Anime Request Hub and Threaded Comments System
-- Supports user requests with upvoting & auto-completion status, and advanced comments with spoilers & timestamp seeks.

CREATE TABLE IF NOT EXISTS anime_request (
  id             TEXT PRIMARY KEY,
  title          TEXT NOT NULL,
  native_title   TEXT,
  anilist_id     INTEGER,
  mal_id         INTEGER,
  year           INTEGER,
  notes          TEXT,
  status         TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'in_progress' | 'completed' | 'rejected'
  vote_count     INTEGER NOT NULL DEFAULT 1,
  requester_name TEXT NOT NULL DEFAULT 'Otaku',
  requester_uid  TEXT NOT NULL,
  anime_id       TEXT,                             -- Linked catalogue slug once completed (e.g. 'overgeared')
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_anime_req_status_votes ON anime_request(status, vote_count DESC);
CREATE INDEX IF NOT EXISTS idx_anime_req_created ON anime_request(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_anime_req_anilist ON anime_request(anilist_id);
CREATE INDEX IF NOT EXISTS idx_anime_req_uid ON anime_request(requester_uid);

CREATE TABLE IF NOT EXISTS anime_request_vote (
  request_id TEXT NOT NULL,
  user_uid   TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (request_id, user_uid),
  FOREIGN KEY (request_id) REFERENCES anime_request(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS comment (
  id            TEXT PRIMARY KEY,
  anime_id      TEXT NOT NULL,
  episode_n     INTEGER DEFAULT NULL,              -- NULL = series-level, integer = episode-specific
  parent_id     TEXT DEFAULT NULL,                 -- NULL = top-level comment, UUID = nested reply
  author_name   TEXT NOT NULL,
  author_uid    TEXT NOT NULL,
  author_avatar TEXT NOT NULL DEFAULT 'luffy',    -- luffy, zoro, gojo, nezuko, anya, naruto, levi, fern
  content       TEXT NOT NULL,
  has_spoiler   BOOLEAN NOT NULL DEFAULT 0,
  likes         INTEGER NOT NULL DEFAULT 0,
  is_pinned     BOOLEAN NOT NULL DEFAULT 0,
  is_deleted    BOOLEAN NOT NULL DEFAULT 0,
  ip_hash       TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_comment_feed ON comment(anime_id, episode_n, is_deleted, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comment_parent ON comment(parent_id);
CREATE INDEX IF NOT EXISTS idx_comment_author ON comment(author_uid);

CREATE TABLE IF NOT EXISTS comment_like (
  comment_id TEXT NOT NULL,
  user_uid   TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (comment_id, user_uid),
  FOREIGN KEY (comment_id) REFERENCES comment(id) ON DELETE CASCADE
);
