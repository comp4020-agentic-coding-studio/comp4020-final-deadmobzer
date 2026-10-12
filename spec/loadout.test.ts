// The faithful Black Mass builder is validated server-side: slot budget, unit
// limits, Malice dark-power budget, and valid upgrade choices. Asserted over the
// loadout API so the UI can't smuggle an illegal army into a game.
import { expect, inject, it, describe } from "vitest";
import { api, signup } from "./helpers.ts";

const baseUrl = inject("baseUrl");
const save = (sid: string, body: unknown) => api(baseUrl, sid, "/api/loadout", body);

describe("faithful loadout validation", () => {
  it("accepts a roster within the slot budget", async () => {
    const u = await signup(baseUrl);
    const res = await save(u.sid, { mode: "faithful", house: "carcass", colour: "#e6194b",
      units: [{ defId: "enforcer" }, { defId: "barrelform" }, { defId: "ammo-goblin" }] });
    expect(res.status).toBe(200);
  });

  it("rejects a roster over the slot budget", async () => {
    const u = await signup(baseUrl);
    const units = [
      { defId: "enforcer" }, { defId: "enforcer" }, { defId: "enforcer" },   // scion ×3
      { defId: "barrelform" }, { defId: "barrelform" },                        // hunter ×2
      { defId: "ammo-goblin" }, { defId: "ammo-goblin" },                      // freak ×2
      { defId: "egis-weapon" },                                                // tyrant ×1  => 8 slots
    ];
    const res = await save(u.sid, { mode: "faithful", house: "carcass", colour: "#e6194b", units });
    expect(res.status).toBe(400);
  });

  it("rejects spending dark power you don't have (Spite = 0)", async () => {
    const u = await signup(baseUrl);
    const res = await save(u.sid, { mode: "faithful", house: "carcass", colour: "#e6194b",
      units: [{ defId: "enforcer" }], malice: "Spite", upgrades: { enforcer: "Shield Charge" } });
    expect(res.status).toBe(400);
  });

  it("accepts an upgrade within the Malice budget", async () => {
    const u = await signup(baseUrl);
    const res = await save(u.sid, { mode: "faithful", house: "carcass", colour: "#e6194b",
      units: [{ defId: "enforcer" }], malice: "Loathing", upgrades: { enforcer: "Shield Charge" } });
    expect(res.status).toBe(200);
  });

  it("rejects an upgrade that isn't one of the unit's three", async () => {
    const u = await signup(baseUrl);
    const res = await save(u.sid, { mode: "faithful", house: "carcass", colour: "#e6194b",
      units: [{ defId: "enforcer" }], malice: "Loathing", upgrades: { enforcer: "Not A Real Upgrade" } });
    expect(res.status).toBe(400);
  });
});
