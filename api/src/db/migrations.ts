/** Migrations applied in order at startup. Never edit a released migration: add a new one. */
export const MIGRATIONS: string[] = [
  `
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    lastfm_user TEXT NOT NULL,
    plex_token TEXT,
    playlist_title TEXT NOT NULL,
    tracks INTEGER NOT NULL DEFAULT 30,
    liked_subdir TEXT NOT NULL DEFAULT 'pickarr',
    review_mode INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TABLE blocked_artists (
    profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    normalized TEXT NOT NULL,
    PRIMARY KEY (profile_id, normalized)
  );

  -- status : review (en attente de validation) -> downloading -> active (playlist en place) -> cleaned
  CREATE TABLE weeks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    activated_at TEXT,
    cleaned_at TEXT
  );
  CREATE INDEX weeks_profile ON weeks(profile_id, status);

  -- status : candidate, rejected, queued, imported, failed, liked, deleted, pending (ménage reporté)
  CREATE TABLE tracks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    week_id INTEGER NOT NULL REFERENCES weeks(id) ON DELETE CASCADE,
    artist TEXT NOT NULL,
    title TEXT NOT NULL,
    key TEXT NOT NULL,
    kind TEXT NOT NULL,
    score REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL,
    link TEXT,
    preview_url TEXT,
    cover_url TEXT,
    pick_id INTEGER,
    file TEXT,
    rating_key TEXT,
    rating INTEGER,
    keep INTEGER NOT NULL DEFAULT 0,
    lossless INTEGER,
    origin TEXT,
    quality TEXT,
    error TEXT,
    position INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX tracks_week ON tracks(week_id);
  CREATE INDEX tracks_key ON tracks(key);
  CREATE INDEX tracks_file ON tracks(file);

  CREATE TABLE runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id INTEGER REFERENCES profiles(id) ON DELETE SET NULL,
    trigger TEXT NOT NULL,
    dry_run INTEGER NOT NULL DEFAULT 0,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    ok INTEGER,
    step TEXT,
    error TEXT
  );
  `,
];
