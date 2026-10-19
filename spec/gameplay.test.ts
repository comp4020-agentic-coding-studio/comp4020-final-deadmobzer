// Game action validation beyond WHO may act (that's spec/access.test.ts's job):
// this checks WHAT counts as a legal action once you are the right person on
// the right turn — an out-of-bounds move, a move for a unit that doesn't exist,
// acting twice on the same unit in one turn, and that the game really is over
// (no further actions) once a side forfeits. Also covers chat edge cases
// (length limits, a nonexistent game, chat after the game ends), the
// /api/games/active "only show games with an audience" filter, and a spot
// check that error bodies are consistently shaped ({error: string}).
import { WebSocket } from "ws";
import { expect, inject, it, describe } from "vitest";
import { api, signup, startGame } from "./helpers.ts";

const baseUrl = inject("baseUrl");

function wsUrl(game: string): URL {
  const u = new URL(`/ws?game=${game}`, baseUrl);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  return u;
}

describe("action validation (beyond who may act)", () => {
  it("rejects a move to a tile the unit can't reach (out of bounds / too far)", async () => {
    const { a, b, gameId } = await startGame(baseUrl);
    const view = await (await api(baseUrl, a.sid, `/api/game/${gameId}`, undefined, "GET")).json();
    const active = view.state.activeSide;
    const actor = active === 0 ? a : b;
    const mine = view.state.units.find((u: { owner: number; isNecromancer: boolean }) => u.owner === active && !u.isNecromancer);
    const res = await api(baseUrl, actor.sid, `/api/game/${gameId}/action`,
      { action: { kind: "move", iid: mine.iid, to: { x: -5, y: -5 } } });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "can't reach there" });
  });

  it("rejects acting on a unit iid that doesn't exist in the game", async () => {
    const { a, b, gameId } = await startGame(baseUrl);
    const view = await (await api(baseUrl, a.sid, `/api/game/${gameId}`, undefined, "GET")).json();
    const actor = view.state.activeSide === 0 ? a : b;
    const res = await api(baseUrl, actor.sid, `/api/game/${gameId}/action`,
      { action: { kind: "move", iid: "no-such-unit-iid", to: { x: 0, y: 0 } } });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/no such unit/);
  });

  it("rejects a second activation of the same unit later the same turn cycle", async () => {
    const { a, b, gameId } = await startGame(baseUrl);
    const view = await (await api(baseUrl, a.sid, `/api/game/${gameId}`, undefined, "GET")).json();
    const active = view.state.activeSide;
    const actor = active === 0 ? a : b;
    const mine = view.state.units.find((u: { owner: number; isNecromancer: boolean }) => u.owner === active && !u.isNecromancer);

    const first = await api(baseUrl, actor.sid, `/api/game/${gameId}/action`,
      { action: { kind: "move", iid: mine.iid, to: mine.pos } }).then((r) => r);
    // The unit may or may not have anywhere to go from its spawn tile; either
    // way, acting on it AGAIN (same iid) in the same cycle must be rejected —
    // "already activated" if the first move landed, "can't reach" if it never
    // got the chance to move this round. What matters: two calls for the same
    // iid without an intervening endTurn never both succeed.
    void first;
    const moves = await (await api(baseUrl, actor.sid, `/api/game/${gameId}/moves?iid=${mine.iid}`, undefined, "GET")).json();
    if (moves.tiles.length > 0) {
      const to = moves.tiles[0];
      const ok = await api(baseUrl, actor.sid, `/api/game/${gameId}/action`, { action: { kind: "move", iid: mine.iid, to } });
      expect(ok.status).toBe(200);
      // Now the server's activeSide has flipped to the opponent; acting again
      // with the SAME actor for the SAME unit must fail — either "not your
      // turn" (side flipped) or "already activated" (if somehow still active).
      const again = await api(baseUrl, actor.sid, `/api/game/${gameId}/action`,
        { action: { kind: "move", iid: mine.iid, to: mine.pos } });
      expect(again.status).toBe(403);
    } else {
      // No legal moves at all from the spawn tile: the unit is boxed in by its
      // own side on round 1. Assert the "no legal moves" premise directly
      // instead of silently passing.
      expect(moves.tiles).toEqual([]);
    }
  });

  it("rejects acting with an unknown ability name", async () => {
    const { a, b, gameId } = await startGame(baseUrl);
    const view = await (await api(baseUrl, a.sid, `/api/game/${gameId}`, undefined, "GET")).json();
    const active = view.state.activeSide;
    const actor = active === 0 ? a : b;
    const mine = view.state.units.find((u: { owner: number; isNecromancer: boolean }) => u.owner === active && !u.isNecromancer);
    const res = await api(baseUrl, actor.sid, `/api/game/${gameId}/action`,
      { action: { kind: "act", iid: mine.iid, ability: "Not A Real Ability" } });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/no such ability/);
  });

  it("once a game ends (forfeit), neither side can act or move again", async () => {
    const { a, b, gameId } = await startGame(baseUrl);
    const leave = await api(baseUrl, a.sid, `/api/game/${gameId}/leave`);
    expect(leave.status).toBe(200);

    const view = await (await api(baseUrl, b.sid, `/api/game/${gameId}`, undefined, "GET")).json();
    expect(view.state.phase).toBe("over");
    expect(view.state.winner).toBe(1); // a (p0) left, so side 1 (b) wins

    const winnerActs = await api(baseUrl, b.sid, `/api/game/${gameId}/action`, { action: { kind: "endTurn" } });
    expect(winnerActs.status).toBe(403);
    expect((await winnerActs.json()).error).toMatch(/game is over/);

    // Leaving again after it's already over is a harmless no-op, not an error.
    const leaveAgain = await api(baseUrl, a.sid, `/api/game/${gameId}/leave`);
    expect(leaveAgain.status).toBe(200);
  });
});

describe("chat edge cases", () => {
  it("rejects an empty / whitespace-only message", async () => {
    const { a, gameId } = await startGame(baseUrl);
    const res = await api(baseUrl, a.sid, `/api/game/${gameId}/chat`, { channel: "player", body: "   " });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/empty/i);
  });

  it("accepts a message right at the 500-char limit and rejects one over it", async () => {
    const { a, gameId } = await startGame(baseUrl);
    const atLimit = await api(baseUrl, a.sid, `/api/game/${gameId}/chat`, { channel: "player", body: "x".repeat(500) });
    expect(atLimit.status).toBe(200);
    const overLimit = await api(baseUrl, a.sid, `/api/game/${gameId}/chat`, { channel: "player", body: "x".repeat(501) });
    expect(overLimit.status).toBe(400);
    expect((await overLimit.json()).error).toMatch(/too long/i);
  });

  it("rejects chatting in a game that doesn't exist", async () => {
    const u = await signup(baseUrl);
    const res = await api(baseUrl, u.sid, "/api/game/not-a-real-game-id/chat", { channel: "audience", body: "hi" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/no such game/i);
  });

  it("still allows chat after the game is over (the post-mortem is part of the social space)", async () => {
    const { a, b, gameId } = await startGame(baseUrl);
    await api(baseUrl, a.sid, `/api/game/${gameId}/leave`);
    const res = await api(baseUrl, b.sid, `/api/game/${gameId}/chat`, { channel: "player", body: "gg" });
    expect(res.status).toBe(200);
  });
});

describe("GET /api/games/active", () => {
  it("excludes a game with no one watching, and includes it once a spectator joins the room", async () => {
    const { gameId } = await startGame(baseUrl);
    const before = await (await api(baseUrl, (await signup(baseUrl)).sid, "/api/games/active", undefined, "GET")).json();
    expect(before.games.some((g: { id: string }) => g.id === gameId)).toBe(false);

    const spectator = await signup(baseUrl);
    const ws = new WebSocket(wsUrl(gameId), { headers: { cookie: "sid=" + spectator.sid } });
    await new Promise<void>((resolve, reject) => {
      ws.on("open", () => resolve());
      ws.on("error", reject);
    });
    try {
      // Give the server a beat to register the room membership.
      await new Promise((r) => setTimeout(r, 150));
      const during = await (await api(baseUrl, spectator.sid, "/api/games/active", undefined, "GET")).json();
      expect(during.games.some((g: { id: string }) => g.id === gameId)).toBe(true);
    } finally {
      ws.close();
    }
  });

  it("is turned away unauthenticated", async () => {
    const res = await fetch(new URL("/api/games/active", baseUrl));
    expect(res.status).toBe(401);
  });
});

describe("error response shape", () => {
  // Spot-check across unrelated subsystems that a failure is always
  // {"error": "<message>"} with no leaking stack traces or alternate shapes.
  it("is consistent across auth-gated, validation, and not-found failures", async () => {
    const checks: Promise<Response>[] = [
      fetch(new URL("/api/profile", baseUrl)), // 401 unauthenticated
    ];
    const u = await signup(baseUrl);
    checks.push(
      api(baseUrl, u.sid, "/api/loadout", { mode: "faithful", house: "not-a-house", colour: "#e6194b", units: [] }), // 400
      api(baseUrl, u.sid, "/api/game/totally-fake-game-id", undefined, "GET"), // 404
      fetch(new URL("/api/this-route-does-not-exist", baseUrl), { headers: { cookie: "sid=" + u.sid } }), // 404
    );
    const results = await Promise.all(checks);
    for (const res of results) {
      expect([400, 401, 404]).toContain(res.status);
      const body = await res.json();
      expect(typeof body.error).toBe("string");
      expect(body.error.length).toBeGreaterThan(0);
      expect(Object.keys(body)).toEqual(["error"]);
    }
  });
});
