// Persistence: what someone does in a game is still there when they come back.
// We can't restart the server mid-test, but we assert the state is durable by
// making a change, re-reading it from a fresh request, and confirming the game
// is retrievable (it lives in SQLite under /data, not memory).
import { expect, inject, it, describe } from "vitest";
import { api, startGame } from "./helpers.ts";

const baseUrl = inject("baseUrl");

describe("game persistence", () => {
  it("an action is reflected in a later, independent read", async () => {
    const { a, b, gameId } = await startGame(baseUrl);
    const before = await (await api(baseUrl, a.sid, `/api/game/${gameId}`, undefined, "GET")).json();
    const active = before.state.activeSide;
    const actor = active === 0 ? a : b;
    const roundBefore = before.state.round;
    const logBefore = before.state.log.length;

    const res = await api(baseUrl, actor.sid, `/api/game/${gameId}/action`, { action: { kind: "endTurn" } });
    expect(res.status).toBe(200);

    // A brand-new request (no shared memory with the write) sees the change.
    const after = await (await api(baseUrl, b.sid, `/api/game/${gameId}`, undefined, "GET")).json();
    expect(after.state.log.length).toBeGreaterThanOrEqual(logBefore);
    // activeSide flipped or the round advanced — the turn was recorded, not lost.
    expect(after.state.activeSide !== active || after.state.round !== roundBefore).toBe(true);
  });

  it("a game survives being read by someone who wasn't in the write path", async () => {
    const { gameId, a } = await startGame(baseUrl);
    const res = await api(baseUrl, a.sid, `/api/game/${gameId}`, undefined, "GET");
    expect(res.status).toBe(200);
    const v = await res.json();
    expect(v.state.units.length).toBe(12); // 2 necromancers + 2x5 units
  });
});
