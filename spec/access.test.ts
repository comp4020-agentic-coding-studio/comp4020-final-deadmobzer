import { expect, inject, it, describe } from "vitest";
import { api, get, signup, startGame } from "./helpers.ts";

// The crit-10 contract: what each person may see and change is checked on the
// SERVER, not just hidden by the UI. Asserted over HTTP via status codes + the
// /api/game JSON, so it survives any change of UI or stack.
const baseUrl = inject("baseUrl");

describe("game access control (server-side)", () => {
  it("participants get a player role; a third party is a read-only spectator", async () => {
    const { a, b, gameId } = await startGame(baseUrl);
    const c = await signup(baseUrl);
    const va = await (await api(baseUrl, a.sid, `/api/game/${gameId}`, undefined, "GET")).json();
    const vb = await (await api(baseUrl, b.sid, `/api/game/${gameId}`, undefined, "GET")).json();
    const vc = await (await api(baseUrl, c.sid, `/api/game/${gameId}`, undefined, "GET")).json();
    expect(va.role).toBe("p0");
    expect(vb.role).toBe("p1");
    expect(vc.role).toBe("spectator");
  });

  it("a spectator cannot act", async () => {
    const { gameId } = await startGame(baseUrl);
    const spectator = await signup(baseUrl);
    const res = await api(baseUrl, spectator.sid, `/api/game/${gameId}/action`, { action: { kind: "endTurn" } });
    expect(res.status).toBe(403);
  });

  it("the side whose turn it is NOT cannot act", async () => {
    const { a, b, gameId } = await startGame(baseUrl);
    const view = await (await api(baseUrl, a.sid, `/api/game/${gameId}`, undefined, "GET")).json();
    const inactive = view.state.activeSide === 0 ? b : a;
    const res = await api(baseUrl, inactive.sid, `/api/game/${gameId}/action`, { action: { kind: "endTurn" } });
    expect(res.status).toBe(403);
  });

  it("a player cannot move the opponent's unit", async () => {
    const { a, b, gameId } = await startGame(baseUrl);
    const view = await (await api(baseUrl, a.sid, `/api/game/${gameId}`, undefined, "GET")).json();
    const active = view.state.activeSide;
    const actor = active === 0 ? a : b;
    const enemy = view.state.units.find((u: { owner: number }) => u.owner !== active);
    const res = await api(baseUrl, actor.sid, `/api/game/${gameId}/action`,
      { action: { kind: "move", iid: enemy.iid, to: enemy.pos } });
    expect(res.status).toBe(403);
  });

  it("the signed-out visitor is turned away from the game API", async () => {
    const { gameId } = await startGame(baseUrl);
    const res = await get(baseUrl, `/api/game/${gameId}`);
    expect(res.status).toBe(401);
  });
});
