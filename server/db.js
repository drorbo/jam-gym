// SQLite storage (node:sqlite, built into Node 24: no npm packages) and numbered migrations.

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * Each migration runs once, inside a transaction, in order. `PRAGMA user_version` records how many have run,
 * so starting the server is always safe to repeat. Never edit a migration that has shipped: add a new one.
 */
const MIGRATIONS = [
  // 1: identities, tracks, likes, reports, search index
  (db) => db.exec(`
    CREATE TABLE users (
      id            INTEGER PRIMARY KEY,
      public_id     TEXT NOT NULL UNIQUE,
      secret_hash   TEXT NOT NULL UNIQUE,
      display_name  TEXT NOT NULL,
      banned        INTEGER NOT NULL DEFAULT 0,
      auth_provider TEXT,
      auth_subject  TEXT,
      created_at    INTEGER NOT NULL,
      last_seen_at  INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX users_auth ON users(auth_provider, auth_subject) WHERE auth_provider IS NOT NULL;

    CREATE TABLE tracks (
      id             TEXT PRIMARY KEY,
      owner_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title          TEXT NOT NULL,
      description    TEXT NOT NULL DEFAULT '',
      data           TEXT NOT NULL,
      style          TEXT NOT NULL,
      key            TEXT NOT NULL,
      time_signature TEXT NOT NULL,
      tempo          INTEGER NOT NULL,
      bars           INTEGER NOT NULL,
      chords         TEXT NOT NULL,
      chord_tokens   TEXT NOT NULL DEFAULT '',
      visibility     TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','published','hidden')),
      like_count     INTEGER NOT NULL DEFAULT 0 CHECK (like_count >= 0),
      created_at     INTEGER NOT NULL,
      updated_at     INTEGER NOT NULL,
      published_at   INTEGER
    );
    CREATE INDEX tracks_owner     ON tracks(owner_id, updated_at DESC);
    CREATE INDEX tracks_published ON tracks(visibility, like_count DESC, published_at DESC);

    CREATE TABLE likes (
      user_id    INTEGER NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
      track_id   TEXT    NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, track_id)
    );
    CREATE INDEX likes_track ON likes(track_id);

    CREATE TABLE reports (
      id          INTEGER PRIMARY KEY,
      track_id    TEXT    NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
      reporter_id INTEGER NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
      reason      TEXT    NOT NULL DEFAULT '',
      created_at  INTEGER NOT NULL,
      UNIQUE (track_id, reporter_id)
    );

    -- Search index over PUBLISHED tracks. rowid = tracks.rowid. Kept in step by server/tracks.js.
    CREATE VIRTUAL TABLE track_search USING fts5(
      title, description, author, chords,
      tokenize = 'unicode61 remove_diacritics 2'
    );
  `),
];

export const SCHEMA_VERSION = MIGRATIONS.length;

/**
 * Open (creating if needed) the database and bring it up to date.
 * @param {string} file  a path, or ':memory:' for tests
 */
export function openDatabase(file) {
  if (file !== ':memory:') mkdirSync(join(file, '..'), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA busy_timeout = 5000');

  const current = db.prepare('PRAGMA user_version').get().user_version;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      MIGRATIONS[v](db);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`Database migration ${v + 1} failed: ${err.message}`);
    }
  }
  return db;
}

/** Run `fn` in a transaction (rolled back if it throws). node:sqlite has no helper for this. */
export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
