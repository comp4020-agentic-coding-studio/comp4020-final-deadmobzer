import { db } from "./db.ts";
import { nowISO } from "./time.ts";
import { randomBytes } from "node:crypto";
import { applyAction, createGame, viewFor, legalMoves, legalTargets, type Loadout } from "./game/engine.ts";
import type { Action, GameState, Pos } from "./game/types.ts";
import { applyRankedResult } from "./elo.ts";
import { audit } from "./audit.ts";

export class GameError extends Error {}

// Audit lines name people, not ids, so two players are legible in `flyctl logs`.
export function usernameOf(userId: number): string {
  const row = db.prepare("SELECT username FROM users WHERE id = ?").get(userId) as { username: string } | undefined;
  return row?.username ?? String(userId);
}

export type Role = "p0" | "p1" | "spectator";

interface GameRow {
  id: string; mode: string; p0_id: number; p1_id: number;
  status: string; winner: number | null; ranked: number;
  state_json: string; version: number; created_at: string; updated_at: string;
}

function rowFor(id: string): GameRow | undefined {
  return db.prepare("SELECT * FROM games WHERE id = ?").get(id) as GameRow | undefined;
}

function newId(): string {
  return randomBytes(9).toString("base64url");
}

// The compare-and-swap write shared by act() and leaveGame() (see
// docs/adr-005-concurrent-actions.md): the write only lands if the row's
// version still matches readVersion — what this caller saw when it decided
// what to write. Exported so spec/concurrency.test.ts can exercise the guard
// directly: two writes built from the same read version, one lands, the other
// reports the conflict instead of silently losing it.
export function writeIfCurrent(
  id: string, readVersion: number, status: "active" | "over", winner: number | null, state: GameState,
): boolean {
  const write = db.prepare(
    `UPDATE games SET state_json = ?, status = ?, winner = ?, version = version + 1, updated_at = ?
       WHERE id = ? AND version = ?`,
  ).run(JSON.stringify(state), status, winner, nowISO(), id, readVersion);
  return write.changes > 0;
}

// Create and persist a new game from two loadouts. Initiative is rolled here
// (server-side). ranked games update ELO on completion.
export function createGameRecord(a: Loadout, b: Loadout, mode: string, ranked: boolean): string {
  const seed = randomBytes(4).readUInt32LE(0);
  const firstSide = (randomBytes(1)[0] & 1) as 0 | 1;
  const state = createGame(a, b, seed, firstSide);
  // Games start in createGame's default "deploy" phase; players place their own
  // units via the "deploy" action (applyAction in engine.ts), not auto-deployed.
  const id = newId();
  db.prepare(
    `INSERT INTO games (id, mode, p0_id, p1_id, status, winner, ranked, state_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', NULL, ?, ?, ?, ?)`,
  ).run(id, mode, a.userId, b.userId, ranked ? 1 : 0, JSON.stringify(state), nowISO(), nowISO());
  audit(usernameOf(a.userId), "game.start", { game: id, vs: usernameOf(b.userId), mode, ranked: String(ranked) });
  return id;
}

export function loadState(id: string): GameState | null {
  const row = rowFor(id);
  if (!row) return null;
  return JSON.parse(row.state_json) as GameState;
}

// What role a user plays in a game. Anyone who isn't a participant is a spectator
// (read-only). This is the server-side access decision crit-10 requires.
export function roleOf(id: string, userId: number | null): Role {
  const row = rowFor(id);
  if (!row) throw new GameError("no such game");
  if (userId === row.p0_id) return "p0";
  if (userId === row.p1_id) return "p1";
  return "spectator";
}

// The viewer-filtered state (participants and spectators both get the open board;
// rng internals are stripped in viewFor).
export function gameView(id: string, userId: number | null): { role: Role; state: GameState } | null {
  const state = loadState(id);
  if (!state) return null;
  const role = roleOf(id, userId);
  return { role, state: viewFor(state, userId) };
}

// The legal move tiles for one of a player's units — only for its owner, on their
// turn. Returns [] otherwise (never leaks the other side's options as "yours").
export function movesFor(id: string, userId: number, iid: string): Pos[] {
  const row = rowFor(id);
  if (!row) return [];
  const role = roleOf(id, userId);
  if (role === "spectator") return [];
  const state = JSON.parse(row.state_json) as GameState;
  const side: 0 | 1 = role === "p0" ? 0 : 1;
  if (state.activeSide !== side) return [];
  const u = state.units.find((x) => x.iid === iid);
  if (!u || u.owner !== side) return [];
  return legalMoves(state, iid);
}

// The valid targets of an ability, for one of a player's units, on their turn.
export function targetsFor(id: string, userId: number, iid: string, ability: string): { iid: string; pos: Pos }[] {
  const row = rowFor(id);
  if (!row) return [];
  const role = roleOf(id, userId);
  if (role === "spectator") return [];
  const state = JSON.parse(row.state_json) as GameState;
  const side: 0 | 1 = role === "p0" ? 0 : 1;
  if (state.activeSide !== side) return [];
  const u = state.units.find((x) => x.iid === iid);
  if (!u || u.owner !== side) return [];
  return legalTargets(state, iid, ability);
}

// Apply a player's action. Rejects spectators and anyone acting for the other
// side; the engine rejects acting out of turn / illegal moves. Persists + runs
// ELO on game over. Returns the updated (viewer-agnostic) state on success.
//
// Concurrency (docs/adr-005-concurrent-actions.md): better-sqlite3 is synchronous
// and this function never awaits between its read and its write, so today, in
// this single Fly machine (`ha=false`), each call already applies atomically —
// nothing else can run between rowFor(id) and the UPDATE below. But that
// atomicity is a property of the DB driver and the deployment, not something
// enforced here; an async driver, a queue, or a second machine would silently
// reintroduce a lost-update with no test to catch it. The version check below
// makes the atomicity structural instead of incidental: the write is
// conditioned on the row's version not having moved since this call read it.
export function act(id: string, userId: number, action: Action): { ok: boolean; error?: string; state?: GameState; conflict?: boolean } {
  const row = rowFor(id);
  if (!row) return { ok: false, error: "no such game" };
  if (row.status === "over") return { ok: false, error: "game is over" };
  const role = roleOf(id, userId);
  if (role === "spectator") return { ok: false, error: "spectators cannot act" };
  const side: 0 | 1 = role === "p0" ? 0 : 1;

  const state = JSON.parse(row.state_json) as GameState;
  const result = applyAction(state, side, action);
  if (!result.ok) return { ok: false, error: result.error };

  const over = result.state.phase === "over";
  const winnerUserId = result.state.winner === null ? null
    : result.state.winner === 0 ? row.p0_id : row.p1_id;

  if (!writeIfCurrent(id, row.version, over ? "over" : "active", winnerUserId, result.state)) {
    audit(usernameOf(userId), "game.action.conflict", { game: id, kind: action.kind });
    return { ok: false, error: "the game moved under you — refetch and retry", conflict: true };
  }

  audit(usernameOf(userId), "game.action", { game: id, kind: action.kind });

  if (over && row.ranked) {
    const delta = applyRankedResult(row.p0_id, row.p1_id, winnerUserId);
    audit(usernameOf(userId), "elo.update", { game: id, p0: String(delta.p0), p1: String(delta.p1) });
  }
  return { ok: true, state: result.state };
}

// Active games for the spectator list (newest first), with both players' names.
export function activeGames(limit = 30): { id: string; mode: string; players: string[] }[] {
  const rows = db.prepare(
    `SELECT g.id AS id, g.mode AS mode, a.display_name AS p0, b.display_name AS p1
       FROM games g JOIN users a ON a.id = g.p0_id JOIN users b ON b.id = g.p1_id
      WHERE g.status = 'active'
      ORDER BY g.updated_at DESC LIMIT ?`,
  ).all(limit) as { id: string; mode: string; p0: string; p1: string }[];
  return rows.map((r) => ({ id: r.id, mode: r.mode, players: [r.p0, r.p1] }));
}

// A participant leaving ends the game as a forfeit (the other side wins), so the
// opponent isn't left waiting. Spectators leaving is purely client-side. Returns
// true if the game was ended.
export function leaveGame(id: string, userId: number): boolean {
  const row = rowFor(id);
  if (!row) return false;
  const role = roleOf(id, userId);
  if (role === "spectator") return false;
  if (row.status === "over") return true;
  const state = JSON.parse(row.state_json) as GameState;
  const winnerSide: 0 | 1 = role === "p0" ? 1 : 0;
  state.phase = "over";
  state.winner = winnerSide;
  state.log.push({ round: state.round, side: null, actor: "system",
    text: `${usernameOf(userId)} left — side ${winnerSide + 1} wins by forfeit.` });
  const winnerUser = winnerSide === 0 ? row.p0_id : row.p1_id;
  // Same version guard as act() (see its comment): structural, not a fix for an
  // observed bug. If it ever did fire — the game no longer being the one we
  // read — re-read and retry rather than overwrite whatever happened meanwhile.
  if (!writeIfCurrent(id, row.version, "over", winnerUser, state)) return leaveGame(id, userId);
  audit(usernameOf(userId), "game.leave", { game: id });
  if (row.ranked) applyRankedResult(row.p0_id, row.p1_id, winnerUser);
  return true;
}

// Distinct recent opponents for a user, newest first — used by the Friends tab.
export function recentOpponents(userId: number, limit = 10): { id: number; username: string; display_name: string }[] {
  return db.prepare(
    `SELECT u.id, u.username, u.display_name
       FROM games g
       JOIN users u ON u.id = CASE WHEN g.p0_id = ? THEN g.p1_id ELSE g.p0_id END
      WHERE g.p0_id = ? OR g.p1_id = ?
      GROUP BY u.id
      ORDER BY MAX(g.created_at) DESC
      LIMIT ?`,
  ).all(userId, userId, userId, limit) as { id: number; username: string; display_name: string }[];
}
