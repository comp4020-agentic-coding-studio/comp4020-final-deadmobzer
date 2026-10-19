// Lobbies: creating, joining by code, the mode filter on the public browser,
// and quick-join matchmaking. spec/helpers.ts's startGame() already exercises
// the happy path (create + join) indirectly for every other spec file; this
// file is about the lobby-specific edge cases those other specs never touch:
// a bad/expired code, joining your own lobby, a mode mismatch, a lobby that's
// already started, and that the mode filter on GET /api/lobbies actually filters.
import { expect, inject, it, describe } from "vitest";
import { api, get, signup } from "./helpers.ts";

const baseUrl = inject("baseUrl");

async function palette(): Promise<string[]> {
  return (await (await fetch(new URL("/api/factions", baseUrl))).json()).palette;
}

describe("POST /api/lobby/create + GET /api/lobbies", () => {
  it("a created public lobby shows up filtered by its own mode, not the other mode", async () => {
    const host = await signup(baseUrl);
    const pal = await palette();
    const create = await (await api(baseUrl, host.sid, "/api/lobby/create",
      { mode: "fixed", visibility: "public", house: "carcass", colour: pal[0], units: [] })).json();
    expect(create.code).toMatch(/^[A-Z0-9]{5}$/);

    try {
      const fixedList = await (await api(baseUrl, host.sid, "/api/lobbies?mode=fixed", undefined, "GET")).json();
      expect(fixedList.lobbies.some((l: { code: string }) => l.code === create.code)).toBe(true);

      const faithfulList = await (await api(baseUrl, host.sid, "/api/lobbies?mode=faithful", undefined, "GET")).json();
      expect(faithfulList.lobbies.some((l: { code: string }) => l.code === create.code)).toBe(false);

      const unfiltered = await (await api(baseUrl, host.sid, "/api/lobbies", undefined, "GET")).json();
      expect(unfiltered.lobbies.some((l: { code: string }) => l.code === create.code)).toBe(true);
    } finally {
      // Close the lobby out (join it) so it doesn't linger "open" and get
      // scooped up by a later/parallel quickjoin test in this file.
      const guest = await signup(baseUrl);
      await api(baseUrl, guest.sid, "/api/lobby/join",
        { code: create.code, mode: "fixed", house: "goregrinders", colour: pal[3], units: [] });
    }
  });

  it("a private lobby is joinable by code but never listed publicly", async () => {
    const host = await signup(baseUrl);
    const pal = await palette();
    const create = await (await api(baseUrl, host.sid, "/api/lobby/create",
      { mode: "fixed", visibility: "private", house: "carcass", colour: pal[0], units: [] })).json();

    const list = await (await api(baseUrl, host.sid, "/api/lobbies", undefined, "GET")).json();
    expect(list.lobbies.some((l: { code: string }) => l.code === create.code)).toBe(false);

    const guest = await signup(baseUrl);
    const join = await api(baseUrl, guest.sid, "/api/lobby/join",
      { code: create.code, mode: "fixed", house: "goregrinders", colour: pal[3], units: [] });
    expect(join.status).toBe(200);
  });

  it("is turned away unauthenticated", async () => {
    const res = await get(baseUrl, "/api/lobbies");
    expect(res.status).toBe(401);
  });
});

describe("POST /api/lobby/join edge cases", () => {
  it("rejects a code that was never issued", async () => {
    const u = await signup(baseUrl);
    const pal = await palette();
    const res = await api(baseUrl, u.sid, "/api/lobby/join",
      { code: "ZZZZZ", mode: "fixed", house: "carcass", colour: pal[0], units: [] });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/no lobby/i);
  });

  it("rejects the host joining their own lobby", async () => {
    const host = await signup(baseUrl);
    const pal = await palette();
    const create = await (await api(baseUrl, host.sid, "/api/lobby/create",
      { mode: "fixed", visibility: "private", house: "carcass", colour: pal[0], units: [] })).json();
    const res = await api(baseUrl, host.sid, "/api/lobby/join",
      { code: create.code, mode: "fixed", house: "goregrinders", colour: pal[3], units: [] });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/own lobby/i);
  });

  it("rejects joining with a loadout from a different mode than the lobby", async () => {
    const host = await signup(baseUrl);
    const guest = await signup(baseUrl);
    const pal = await palette();
    const create = await (await api(baseUrl, host.sid, "/api/lobby/create",
      { mode: "fixed", visibility: "private", house: "carcass", colour: pal[0], units: [] })).json();
    const res = await api(baseUrl, guest.sid, "/api/lobby/join",
      { code: create.code, mode: "faithful", house: "carcass", colour: pal[3], units: [{ defId: "gunwight" }] });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/mode/i);
  });

  it("rejects joining a lobby that already started", async () => {
    const host = await signup(baseUrl);
    const guest = await signup(baseUrl);
    const latecomer = await signup(baseUrl);
    const pal = await palette();
    const create = await (await api(baseUrl, host.sid, "/api/lobby/create",
      { mode: "fixed", visibility: "private", house: "carcass", colour: pal[0], units: [] })).json();
    const join = await api(baseUrl, guest.sid, "/api/lobby/join",
      { code: create.code, mode: "fixed", house: "goregrinders", colour: pal[3], units: [] });
    expect(join.status).toBe(200);

    const res = await api(baseUrl, latecomer.sid, "/api/lobby/join",
      { code: create.code, mode: "fixed", house: "carcass", colour: pal[0], units: [] });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/no longer open/i);
  });

  it("GET /api/lobby/<code> resolves to the started game's id, and to null for an unknown code", async () => {
    const host = await signup(baseUrl);
    const guest = await signup(baseUrl);
    const pal = await palette();
    const create = await (await api(baseUrl, host.sid, "/api/lobby/create",
      { mode: "fixed", visibility: "private", house: "carcass", colour: pal[0], units: [] })).json();
    const join = await (await api(baseUrl, guest.sid, "/api/lobby/join",
      { code: create.code, mode: "fixed", house: "goregrinders", colour: pal[3], units: [] })).json();

    const lookup = await (await api(baseUrl, host.sid, `/api/lobby/${create.code}`, undefined, "GET")).json();
    expect(lookup.gameId).toBe(join.gameId);

    const missing = await (await api(baseUrl, host.sid, "/api/lobby/ZZZZZ", undefined, "GET")).json();
    expect(missing.gameId).toBeNull();
  });

  it("is turned away unauthenticated", async () => {
    const res = await fetch(new URL("/api/lobby/join", baseUrl), {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "AAAAA", mode: "fixed", house: "carcass", colour: "#e6194b", units: [] }),
    });
    expect(res.status).toBe(401);
  });
});

describe("POST /api/quickjoin", () => {
  it("the first caller waits (gets a lobby code); the second is matched into a game", async () => {
    const a = await signup(baseUrl);
    const b = await signup(baseUrl);
    const pal = await palette();

    const first = await (await api(baseUrl, a.sid, "/api/quickjoin",
      { mode: "fixed", house: "carcass", colour: pal[0], units: [] })).json();
    expect(first.code).toBeTruthy();
    expect(first.gameId).toBeUndefined();

    const second = await (await api(baseUrl, b.sid, "/api/quickjoin",
      { mode: "fixed", house: "goregrinders", colour: pal[3], units: [] })).json();
    expect(second.gameId).toBeTruthy();

    // Both participants agree on the same game.
    const view = await (await api(baseUrl, a.sid, `/api/game/${second.gameId}`, undefined, "GET")).json();
    expect(["p0", "p1"]).toContain(view.role);
  });

  it("is turned away unauthenticated", async () => {
    const res = await fetch(new URL("/api/quickjoin", baseUrl), {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "fixed", house: "carcass", colour: "#e6194b", units: [] }),
    });
    expect(res.status).toBe(401);
  });
});
