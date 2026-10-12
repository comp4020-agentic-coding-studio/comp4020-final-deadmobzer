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

  -- A saved default loadout per user per mode (faithful | fixed).
  CREATE TABLE IF NOT EXISTS loadouts (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id),
    mode       TEXT NOT NULL CHECK (mode IN ('faithful', 'fixed')),
    house      TEXT NOT NULL,
    colour     TEXT NOT NULL,
    units_json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (user_id, mode)
  );

  -- A lobby. The id is also the shareable join code. host_loadout_json captures
  -- the host's chosen Black Mass; the guest's is captured when they join.
  CREATE TABLE IF NOT EXISTS lobbies (
    id                 TEXT PRIMARY KEY,
    host_id            INTEGER NOT NULL REFERENCES users(id),
    mode               TEXT NOT NULL CHECK (mode IN ('faithful', 'fixed')),
    visibility         TEXT NOT NULL CHECK (visibility IN ('public', 'private')),
    status             TEXT NOT NULL CHECK (status IN ('open', 'started', 'closed')),
    host_loadout_json  TEXT NOT NULL,
    guest_id           INTEGER REFERENCES users(id),
    guest_loadout_json TEXT,
    game_id            TEXT,
    created_at         TEXT NOT NULL
  );

  -- A game. The full GameState is serialized to state_json so a game survives a
  -- restart/redeploy; p0/p1 are the two participants (for access + recent opps).
  CREATE TABLE IF NOT EXISTS games (
    id         TEXT PRIMARY KEY,
    mode       TEXT NOT NULL,
    p0_id      INTEGER NOT NULL REFERENCES users(id),
    p1_id      INTEGER NOT NULL REFERENCES users(id),
    status     TEXT NOT NULL CHECK (status IN ('active', 'over')),
    winner     INTEGER,
    ranked     INTEGER NOT NULL DEFAULT 0,
    state_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  -- In-game chat. channel is 'player' (the two participants) or 'audience'
  -- (spectators). Body is stored raw and HTML-escaped on output (no injection).
  CREATE TABLE IF NOT EXISTS chat_messages (
    id           INTEGER PRIMARY KEY,
    game_id      TEXT NOT NULL REFERENCES games(id),
    channel      TEXT NOT NULL CHECK (channel IN ('player', 'audience')),
    user_id      INTEGER NOT NULL REFERENCES users(id),
    display_name TEXT NOT NULL,
    body         TEXT NOT NULL,
    created_at   TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_games_players ON games(p0_id, p1_id);
  CREATE INDEX IF NOT EXISTS idx_chat_game ON chat_messages(game_id, channel, id);
`);

// Idempotent column adds (users predates the game columns).
function ensureColumn(table: string, column: string, decl: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${decl}`);
  }
}
ensureColumn("users", "elo", "elo INTEGER NOT NULL DEFAULT 1200");
ensureColumn("users", "avatar_house", "avatar_house TEXT");
ensureColumn("users", "avatar_unit", "avatar_unit TEXT");
ensureColumn("users", "colour", "colour TEXT");
