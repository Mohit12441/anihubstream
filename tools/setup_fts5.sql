-- Create FTS5 virtual table for fast search
CREATE VIRTUAL TABLE IF NOT EXISTS anime_fts USING fts5(
  title,
  native,
  search_text,
  content='anime',
  content_rowid='rowid'
);

-- Populate the FTS table with existing rows
INSERT INTO anime_fts(rowid, title, native, search_text)
SELECT rowid, title, native, search_text FROM anime;

-- Trigger to keep FTS in sync on INSERT
CREATE TRIGGER IF NOT EXISTS anime_fts_ai AFTER INSERT ON anime BEGIN
  INSERT INTO anime_fts(rowid, title, native, search_text)
  VALUES (new.rowid, new.title, new.native, new.search_text);
END;

-- Trigger on UPDATE
CREATE TRIGGER IF NOT EXISTS anime_fts_au AFTER UPDATE ON anime BEGIN
  UPDATE anime_fts SET title = new.title, native = new.native, search_text = new.search_text WHERE rowid = new.rowid;
END;

-- Trigger on DELETE
CREATE TRIGGER IF NOT EXISTS anime_fts_ad AFTER DELETE ON anime BEGIN
  DELETE FROM anime_fts WHERE rowid = old.rowid;
END;
