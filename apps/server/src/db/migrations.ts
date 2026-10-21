// Append-only. Each entry runs once, in order, inside a transaction. Never edit a
// migration that has shipped; add a new one instead.
export const migrations: string[] = [
  /* 1 */ `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  );
  CREATE TABLE profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    avatar TEXT,
    pin_hash TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  );
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    profile_id INTEGER REFERENCES profiles(id) ON DELETE SET NULL,
    device_name TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    last_seen_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  );
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE tmdb_cache (
    key TEXT PRIMARY KEY,
    json TEXT NOT NULL,
    fetched_at INTEGER NOT NULL
  );
  CREATE TABLE files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    ref TEXT NOT NULL,
    name TEXT NOT NULL,
    size INTEGER NOT NULL,
    mtime INTEGER,
    parsed_json TEXT,
    probe_json TEXT,
    media_type TEXT,
    tmdb_id INTEGER,
    season INTEGER,
    episode INTEGER,
    match_status TEXT NOT NULL DEFAULT 'pending',
    missing INTEGER NOT NULL DEFAULT 0,
    added_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  );
  CREATE UNIQUE INDEX files_provider_ref ON files(provider, ref);
  CREATE INDEX files_tmdb ON files(media_type, tmdb_id, season, episode);
  CREATE TABLE media_items (
    type TEXT NOT NULL,
    tmdb_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    year INTEGER,
    poster_path TEXT,
    backdrop_path TEXT,
    added_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    PRIMARY KEY (type, tmdb_id)
  );
  CREATE TABLE progress (
    profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    media_type TEXT NOT NULL,
    tmdb_id INTEGER NOT NULL,
    season INTEGER NOT NULL DEFAULT 0,
    episode INTEGER NOT NULL DEFAULT 0,
    position_ms INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL,
    completed INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    PRIMARY KEY (profile_id, media_type, tmdb_id, season, episode)
  );
  CREATE TABLE watchlist (
    profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    tmdb_id INTEGER NOT NULL,
    added_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    PRIMARY KEY (profile_id, type, tmdb_id)
  );
  `,
  /* 2 */ `
  ALTER TABLE files ADD COLUMN source_hash TEXT;
  CREATE INDEX files_source_hash ON files(source_hash);
  `,
  /* 3 */ `
  ALTER TABLE sessions ADD COLUMN viewer_only INTEGER NOT NULL DEFAULT 0;
  `,
  /* 4 */ `
  ALTER TABLE media_items ADD COLUMN genre_ids TEXT;
  `,
  /* 5 */ `
  CREATE TABLE torbox_added (
    torrent_id INTEGER PRIMARY KEY,
    hash TEXT NOT NULL,
    name TEXT,
    added_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    last_played_at INTEGER
  );
  `,
  /* 6 */ `
  ALTER TABLE profiles ADD COLUMN content_limit TEXT NOT NULL DEFAULT 'none';
  ALTER TABLE profiles ADD COLUMN is_kids INTEGER NOT NULL DEFAULT 0;
  `,
  /* 7 */ `
  CREATE TABLE continue_hidden (
    profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    tmdb_id INTEGER NOT NULL,
    hidden_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    PRIMARY KEY (profile_id, type, tmdb_id)
  );
  `,
];
