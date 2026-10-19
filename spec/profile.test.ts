// Profile + avatar: the avatar is a portrait (house + unit id) tinted by a
// palette colour (src/profile.ts). Like a loadout, it's player-chosen content
// that must be validated server-side — a client can't claim art that doesn't
// exist or paint it an off-palette colour — so this is tested the same way
// spec/loadout.test.ts tests Black Mass validation. Previously uncovered.
import { expect, inject, it, describe } from "vitest";
import { api, get, signup } from "./helpers.ts";

const baseUrl = inject("baseUrl");

async function factions(): Promise<{ palette: string[]; factions: { id: string; units: { id: string }[] }[] }> {
  return (await fetch(new URL("/api/factions", baseUrl))).json();
}

describe("GET /api/profile", () => {
  it("is turned away unauthenticated", async () => {
    const res = await get(baseUrl, "/api/profile");
    expect(res.status).toBe(401);
  });

  it("starts with no avatar set and default rating", async () => {
    const u = await signup(baseUrl);
    const res = await api(baseUrl, u.sid, "/api/profile", undefined, "GET");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.username).toBe(u.username);
    expect(body.elo).toBe(1200);
    expect(body.avatarHouse).toBeNull();
    expect(body.avatarUnit).toBeNull();
  });
});

describe("POST /api/profile/avatar", () => {
  it("accepts a valid house/unit/colour combo and it's reflected on re-read", async () => {
    const u = await signup(baseUrl);
    const { palette, factions: facs } = await factions();
    const house = facs[0].id;
    const unit = facs[0].units[0].id;
    const res = await api(baseUrl, u.sid, "/api/profile/avatar", { house, unit, colour: palette[0] });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);

    const profile = await (await api(baseUrl, u.sid, "/api/profile", undefined, "GET")).json();
    expect(profile.avatarHouse).toBe(house);
    expect(profile.avatarUnit).toBe(unit);
    expect(profile.colour).toBe(palette[0]);
  });

  it("rejects an unknown House", async () => {
    const u = await signup(baseUrl);
    const { palette } = await factions();
    const res = await api(baseUrl, u.sid, "/api/profile/avatar", { house: "not-a-house", unit: "whatever", colour: palette[0] });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/house/i);
  });

  it("rejects a unit that doesn't belong to the given House (no cross-house portraits)", async () => {
    const u = await signup(baseUrl);
    const { palette, factions: facs } = await factions();
    const house = facs[0].id;
    const unitFromAnotherHouse = facs[1].units[0].id;
    const res = await api(baseUrl, u.sid, "/api/profile/avatar", { house, unit: unitFromAnotherHouse, colour: palette[0] });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/unit/i);
  });

  it("rejects a colour outside the 16-colour player palette", async () => {
    const u = await signup(baseUrl);
    const { factions: facs } = await factions();
    const res = await api(baseUrl, u.sid, "/api/profile/avatar",
      { house: facs[0].id, unit: facs[0].units[0].id, colour: "#123456" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/colour/i);
  });

  it("is turned away unauthenticated", async () => {
    const { palette, factions: facs } = await factions();
    const res = await fetch(new URL("/api/profile/avatar", baseUrl), {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ house: facs[0].id, unit: facs[0].units[0].id, colour: palette[0] }),
    });
    expect(res.status).toBe(401);
  });
});

describe("POST /profile/avatar (server-rendered form)", () => {
  it("sets the avatar from a form POST and redirects back to /profile", async () => {
    const u = await signup(baseUrl);
    const { palette, factions: facs } = await factions();
    const house = facs[0].id;
    const unit = facs[0].units[0].id;
    const res = await fetch(new URL("/profile/avatar", baseUrl), {
      method: "POST", redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: "sid=" + u.sid },
      body: new URLSearchParams({ avatar: `${house}:${unit}`, colour: palette[2] }),
    });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/profile");

    const profile = await (await api(baseUrl, u.sid, "/api/profile", undefined, "GET")).json();
    expect(profile.avatarHouse).toBe(house);
    expect(profile.avatarUnit).toBe(unit);
    expect(profile.colour).toBe(palette[2]);
  });

  it("silently ignores an invalid avatar instead of erroring (still redirects)", async () => {
    const u = await signup(baseUrl);
    const res = await fetch(new URL("/profile/avatar", baseUrl), {
      method: "POST", redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: "sid=" + u.sid },
      body: new URLSearchParams({ avatar: "nope:nope", colour: "#ffffff" }),
    });
    expect(res.status).toBe(303);
    const profile = await (await api(baseUrl, u.sid, "/api/profile", undefined, "GET")).json();
    expect(profile.avatarHouse).toBeNull();
  });
});
