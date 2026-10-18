// Concurrent writes to one game (docs/adr-005-concurrent-actions.md). The
// server is single-threaded with no `await` between act()'s read and write, so
// two HTTP requests can't actually interleave mid-call — by the time a second
// request reaches act(), the first has already landed and the engine itself
// rejects it (e.g. "not your turn"), never reaching the version guard. A
// genuine lost-update can't be provoked from outside the process over HTTP
// (that's the ADR's own point). What's testable directly is the guard itself:
// two writes built from the same read version — the actual shape of a race,
// should the driver or deployment ever stop guaranteeing single-threaded
// writes — one lands, the other reports a conflict instead of losing data.
//
// This talks to its own private SQLite file, not the running app the other
// specs hit over HTTP: src/db.ts is a singleton keyed off DATA_DIR, and the
// live app's database may be inside a separate CI container this process
// can't see. Pointing DATA_DIR at a throwaway temp dir before importing keeps
// this test fully self-contained, the same way rules.test.ts/elo.test.ts
// import engine/elo-core directly without touching the running app.
import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "maleghast-concurrency-"));
const { createGameRecord, writeIfCurrent } = await import("../src/games.ts");
const { db } = await import("../src/db.ts");

function makeUser(username: string): number {
  const info = db.prepare(
    "INSERT INTO users (username, password_hash, display_name, created_at) VALUES (?, 'x', ?, datetime())",
  ).run(username, username);
  return Number(info.lastInsertRowid);
}

function freshGame(): string {
  const uA = makeUser("concurrency-a");
  const uB = makeUser("concurrency-b");
  const a = { userId: uA, house: "carcass", colour: "#e6194b", units: [{ defId: "enforcer" }] };
  const b = { userId: uB, house: "goregrinders", colour: "#4363d8", units: [{ defId: "warhead" }] };
  return createGameRecord(a, b, "fixed", false);
}

describe("concurrent game writes", () => {
  it("of two writes racing from the same read version, exactly one lands and the other conflicts", () => {
    const gameId = freshGame();
    const row = db.prepare("SELECT state_json, version FROM games WHERE id = ?").get(gameId) as
      { state_json: string; version: number };

    // Both "requests" read the game at the same version and each proposes a
    // different state built from that one read.
    const stateA = JSON.parse(row.state_json);
    const stateB = JSON.parse(row.state_json);
    stateA.round = stateA.round + 100; // distinguishable, arbitrary mutation
    stateB.round = stateB.round + 200;

    const firstOk = writeIfCurrent(gameId, row.version, "active", null, stateA);
    const secondOk = writeIfCurrent(gameId, row.version, "active", null, stateB);

    // One write wins, the other is rejected — never both, never neither.
    expect([firstOk, secondOk].sort()).toEqual([false, true]);

    // The surviving state is whichever one actually won, not a merge or the
    // loser's data silently overwriting it — no lost update, no corruption.
    const after = db.prepare("SELECT state_json, version FROM games WHERE id = ?").get(gameId) as
      { state_json: string; version: number };
    const survivingRound = JSON.parse(after.state_json).round;
    expect([stateA.round, stateB.round]).toContain(survivingRound);
    expect(after.version).toBe(row.version + 1);

    // A third write still built from the original (now stale) version also
    // conflicts — the guard doesn't let a later straggler back in either.
    const staleState = JSON.parse(row.state_json);
    staleState.round = staleState.round + 300;
    expect(writeIfCurrent(gameId, row.version, "active", null, staleState)).toBe(false);
  });
});
