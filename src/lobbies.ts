import { db } from "./db.ts";
import { nowISO } from "./time.ts";
import { audit } from "./audit.ts";
import { createGameRecord, usernameOf } from "./games.ts";
import { toEngineLoadout, type Mode, type SavedLoadout } from "./loadouts.ts";

export class LobbyError extends Error {}

interface LobbyRow {
  id: string; host_id: number; mode: Mode; visibility: string; status: string;
  host_loadout_json: string; guest_id: number | null; guest_loadout_json: string | null;
  game_id: string | null; created_at: string;
}

// Lobby codes: short, unambiguous (no 0/O/1/I), easy to read aloud.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function makeCode(): string {
  let c = "";
  for (let i = 0; i < 5; i++) c += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return c;
}
function freshCode(): string {
  for (let i = 0; i < 20; i++) {
    const c = makeCode();
    if (!db.prepare("SELECT 1 FROM lobbies WHERE id = ?").get(c)) return c;
  }
  throw new LobbyError("could not allocate a lobby code");
}

export function createLobby(hostId: number, mode: Mode, visibility: "public" | "private", loadout: SavedLoadout): string {
  const id = freshCode();
  db.prepare(
    `INSERT INTO lobbies (id, host_id, mode, visibility, status, host_loadout_json, created_at)
       VALUES (?, ?, ?, ?, 'open', ?, ?)`,
  ).run(id, hostId, mode, visibility, JSON.stringify(loadout), nowISO());
  audit(usernameOf(hostId), "lobby.create", { code: id, mode, visibility });
  return id;
}

function row(id: string): LobbyRow | undefined {
  return db.prepare("SELECT * FROM lobbies WHERE id = ?").get(id) as LobbyRow | undefined;
}

// A guest joins a lobby by code with their own validated loadout. When both
// sides are present the game is created and its id returned.
export function joinLobby(code: string, guestId: number, loadout: SavedLoadout): { gameId: string } {
  const l = row(code.toUpperCase());
  if (!l) throw new LobbyError("No lobby with that code.");
  if (l.status !== "open") throw new LobbyError("That lobby is no longer open.");
  if (l.host_id === guestId) throw new LobbyError("You can't join your own lobby.");
  if (l.mode !== loadout.mode) throw new LobbyError("Your loadout is for a different mode.");
  return startGame(l, guestId, loadout);
}

// Quick-join: find an open public lobby in the same mode you don't host, else
// create one and wait. Returns either a started game or the created lobby code.
export function quickJoin(userId: number, mode: Mode, loadout: SavedLoadout): { gameId?: string; code?: string } {
  // Prefer an opponent of similar rating (quick-join is ranked); break ties by
  // age so lobbies don't wait forever.
  const myElo = (db.prepare("SELECT elo FROM users WHERE id = ?").get(userId) as { elo: number } | undefined)?.elo ?? 1200;
  const open = db.prepare(
    `SELECT l.* FROM lobbies l JOIN users u ON u.id = l.host_id
      WHERE l.status = 'open' AND l.visibility = 'public' AND l.mode = ? AND l.host_id != ?
      ORDER BY ABS(u.elo - ?) ASC, l.created_at ASC LIMIT 1`,
  ).get(mode, userId, myElo) as LobbyRow | undefined;
  if (open) {
    const { gameId } = startGame(open, userId, loadout);
    return { gameId };
  }
  const code = createLobby(userId, mode, "public", loadout);
  return { code };
}

function startGame(l: LobbyRow, guestId: number, guestLoadout: SavedLoadout): { gameId: string } {
  const hostLoadout = JSON.parse(l.host_loadout_json) as SavedLoadout;
  const gameId = createGameRecord(
    toEngineLoadout(l.host_id, hostLoadout),
    toEngineLoadout(guestId, guestLoadout),
    l.mode,
    l.visibility === "public", // public matches are ranked; private are casual
  );
  db.prepare(
    `UPDATE lobbies SET status = 'started', guest_id = ?, guest_loadout_json = ?, game_id = ? WHERE id = ?`,
  ).run(guestId, JSON.stringify(guestLoadout), gameId, l.id);
  audit(usernameOf(guestId), "lobby.join", { code: l.id, game: gameId });
  return { gameId };
}

// Open public lobbies for a simple browser (newest first).
export function openLobbies(mode?: Mode): { code: string; mode: Mode; host: string }[] {
  const rows = db.prepare(
    `SELECT l.id AS code, l.mode AS mode, u.display_name AS host
       FROM lobbies l JOIN users u ON u.id = l.host_id
      WHERE l.status = 'open' AND l.visibility = 'public' ${mode ? "AND l.mode = ?" : ""}
      ORDER BY l.created_at DESC LIMIT 50`,
  );
  return (mode ? rows.all(mode) : rows.all()) as { code: string; mode: Mode; host: string }[];
}

export function lobbyGameId(code: string): string | null {
  return row(code.toUpperCase())?.game_id ?? null;
}
