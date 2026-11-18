-- AniHubStream HDRezka migration: add hdrezka_slug column and provider session tables
-- Run with: wrangler d1 execute anihub --local --file=tools/migrations/0042_hdrezka.sql

ALTER TABLE anime_id_map ADD COLUMN hdrezka_slug TEXT;

CREATE TABLE IF NOT EXISTS provider_session (
  provider_id TEXT PRIMARY KEY,
  cookie      TEXT NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS provider_sync_state (
  provider_id TEXT NOT NULL,
  shard       INTEGER NOT NULL,
  cursor_id   INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (provider_id, shard)
);

CREATE INDEX IF NOT EXISTS idx_aim_hdrezka_null
  ON anime_id_map (id) WHERE hdrezka_slug IS NULL;