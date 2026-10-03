import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export function openDatabase(filename) {
  if (filename !== ':memory:') mkdirSync(path.dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS pastes (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      view_count INTEGER NOT NULL DEFAULT 0
    ) STRICT;
    CREATE INDEX IF NOT EXISTS pastes_created_at ON pastes(created_at);
    CREATE TABLE IF NOT EXISTS owner_sessions (
      token_hash TEXT PRIMARY KEY,
      csrf TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      password_version TEXT NOT NULL
    ) STRICT;
  `);
  // Additive migration: existing pastes remain available without expiration.
  const columns = db.prepare('PRAGMA table_info(pastes)').all();
  if (!columns.some(column => column.name === 'expires_at')) db.exec('ALTER TABLE pastes ADD COLUMN expires_at INTEGER');
  if (!columns.some(column => column.name === 'view_count')) db.exec('ALTER TABLE pastes ADD COLUMN view_count INTEGER NOT NULL DEFAULT 0');
  db.exec('CREATE INDEX IF NOT EXISTS pastes_expires_at ON pastes(expires_at)');
  return db;
}

export function purgeExpired(db, now = Date.now()) {
  return db.prepare('DELETE FROM pastes WHERE expires_at IS NOT NULL AND expires_at <= ?').run(now).changes;
}
