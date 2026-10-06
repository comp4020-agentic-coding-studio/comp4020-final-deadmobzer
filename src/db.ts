import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

// The one place anything survives a restart or redeploy is the mounted volume
// at /data (fly.toml). DATA_DIR lets the tests and local runs point somewhere
// writable instead; in the container it stays /data.
const dataDir = process.env.DATA_DIR ?? "/data";
mkdirSync(dataDir, { recursive: true });

export const db = new Database(join(dataDir, "app.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Schema is created on boot so an empty volume (CI's throwaway --tmpfs /data)
// comes up working. Everything here is additive and idempotent.
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name  TEXT NOT NULL,
    created_at    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS friendships (
    id           INTEGER PRIMARY KEY,
    requester_id INTEGER NOT NULL REFERENCES users(id),
    addressee_id INTEGER NOT NULL REFERENCES users(id),
    status       TEXT NOT NULL CHECK (status IN ('pending', 'accepted')),
    created_at   TEXT NOT NULL,
    responded_at TEXT,
    UNIQUE (requester_id, addressee_id)
  );

  -- One row marks a day's prompts/matching as generated: the idempotency lock
  -- that makes ensureAssignments(day) safe to call from any request.
  CREATE TABLE IF NOT EXISTS daily_runs (
    day        TEXT PRIMARY KEY,
    created_at TEXT NOT NULL
  );

  -- One row per user per day: their self prompt, and (if they were matched to
  -- one) the friend they write about plus that prompt.
  CREATE TABLE IF NOT EXISTS daily_tasks (
    id                 INTEGER PRIMARY KEY,
    day                TEXT NOT NULL,
    user_id            INTEGER NOT NULL REFERENCES users(id),
    self_prompt_text   TEXT NOT NULL,
    friend_target_id   INTEGER REFERENCES users(id),
    friend_prompt_text TEXT,
    UNIQUE (day, user_id)
  );

  -- The written answers. A 'self' entry has target_id NULL; a 'friend' entry's
  -- target_id is who it's about. UNIQUE keeps it to one of each kind per day.
  CREATE TABLE IF NOT EXISTS entries (
    id          INTEGER PRIMARY KEY,
    day         TEXT NOT NULL,
    author_id   INTEGER NOT NULL REFERENCES users(id),
    kind        TEXT NOT NULL CHECK (kind IN ('self', 'friend')),
    target_id   INTEGER REFERENCES users(id),
    prompt_text TEXT NOT NULL,
    body        TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    UNIQUE (day, author_id, kind)
  );

  CREATE INDEX IF NOT EXISTS idx_entries_target ON entries(target_id, day);
  CREATE INDEX IF NOT EXISTS idx_entries_author ON entries(author_id, kind, day);
`);
