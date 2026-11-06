import { db } from "./db.ts";
import { nowISO } from "./time.ts";
import { audit } from "./audit.ts";
import { createGameRecord, usernameOf } from "./games.ts";
import { toEngineLoadout, reconcileMalice, type Mode, type SavedLoadout } from "./loadouts.ts";

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
  const guest = reconcileMalice(guestLoadout, hostLoadout.malice);
  const gameId = createGameRecord(
    toEngineLoadout(l.host_id, hostLoadout),
    toEngineLoadout(guestId, guest),
    l.mode,
    l.visibility === "public", // public matches are ranked; private are casual
  );
  db.prepare(
    `UPDATE lobbies SET status = 'started', guest_id = ?, guest_loadout_json = ?, game_id = ? WHERE id = ?`,
  ).run(guestId, JSON.stringify(guest), gameId, l.id);
  audit(usernameOf(guestId), "lobby.join", { code: l.id, game: gameId });
  return { gameId };
}

interface OpenLobbyRow { code: string; mode: Mode; host: string; host_loadout_json: string }
// Open public lobbies for a simple browser (newest first). Includes the
// Malice level (faithful mode only — it's meaningless in fixed mode) so a
// browsing player can see the battle's strength before joining, same
// information `previewLobby` gives for a typed-in code.
export function openLobbies(mode?: Mode): { code: string; mode: Mode; host: string; malice?: string }[] {
  const rows = db.prepare(
    `SELECT l.id AS code, l.mode AS mode, u.display_name AS host, l.host_loadout_json
       FROM lobbies l JOIN users u ON u.id = l.host_id
      WHERE l.status = 'open' AND l.visibility = 'public' ${mode ? "AND l.mode = ?" : ""}
      ORDER BY l.created_at DESC LIMIT 50`,
  );
  const all = (mode ? rows.all(mode) : rows.all()) as OpenLobbyRow[];
  return all.map(({ code, mode: m, host, host_loadout_json }) => ({
    code, mode: m, host,
    malice: m === "faithful" ? (JSON.parse(host_loadout_json) as SavedLoadout).malice : undefined,
  }));
}

// The same preview info as openLobbies' rows, but for one lobby by code —
// covers "someone gave me a code" the same way the public browse list covers
// "I'm picking from what's open." Read-only; doesn't require the caller to
// be anyone in particular, since a code alone doesn't leak anything a public
// listing wouldn't.
export function previewLobby(code: string): { mode: Mode; host: string; malice?: string; visibility: string } | null {
  const l = db.prepare(
    `SELECT l.mode AS mode, l.visibility AS visibility, l.status AS status,
            u.display_name AS host, l.host_loadout_json
       FROM lobbies l JOIN users u ON u.id = l.host_id
      WHERE l.id = ?`,
  ).get(code.toUpperCase()) as { mode: Mode; visibility: string; status: string; host: string; host_loadout_json: string } | undefined;
  if (!l || l.status !== "open") return null;
  const hostLoadout = JSON.parse(l.host_loadout_json) as SavedLoadout;
  return { mode: l.mode, host: l.host, visibility: l.visibility, malice: l.mode === "faithful" ? hostLoadout.malice : undefined };
}

export function lobbyGameId(code: string): string | null {
  return row(code.toUpperCase())?.game_id ?? null;
}
