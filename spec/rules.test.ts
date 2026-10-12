// Pure engine unit tests — the faithful combat core from data/rules.json.
// These import the engine directly (no HTTP); they protect the rules the build
// can't see on its own. They run under the same `pnpm check` as the HTTP checks.

import { describe, it, expect } from "vitest";
import {
  createGame, autoDeploy, applyAction, dealDamage, reachable, legalMoves, terrainAt,
  type Loadout,
} from "../src/game/engine.ts";
import type { GameState, Unit } from "../src/game/types.ts";

const LA: Loadout = { userId: 1, house: "carcass", colour: "#e6194b",
  units: [{ defId: "gunwight" }, { defId: "enforcer" }, { defId: "barrelform" }] };
const LB: Loadout = { userId: 2, house: "goregrinders", colour: "#4363d8",
  units: [{ defId: "warhead" }, { defId: "carnifex" }, { defId: "painwheel" }] };

function dummy(hp: number, arm: Unit["arm"], df = 4): Unit {
  return { iid: "t", owner: 1, house: "carcass", defId: "gunwight", name: "Dummy",
    type: "scion", art: "", mv: 3, hp, maxHp: hp, df, arm, large: false,
    pos: { x: 0, y: 0 }, tokens: {}, acts: [], reloaded: {},
    activatedThisRound: false, alive: true, isNecromancer: false };
}
const g = (): GameState => createGame(LA, LB, 42, 0);

describe("damage: armor, pierce, devil", () => {
  it("physical armor reduces physical damage by 1", () => {
    expect(dealDamage(g(), dummy(5, "PHYS"), 2, "physical")).toBe(1);
  });
  it("piercing ignores armor", () => {
    expect(dealDamage(g(), dummy(5, "PHYS"), 2, "physical", { pierce: true })).toBe(2);
  });
  it("MAG armor reduces fire but not physical", () => {
    expect(dealDamage(g(), dummy(5, "MAG"), 2, "fire")).toBe(1);
    expect(dealDamage(g(), dummy(5, "MAG"), 2, "physical")).toBe(2);
  });
  it("SUPER armor reduces all types", () => {
    expect(dealDamage(g(), dummy(5, "SUPER"), 2, "physical")).toBe(1);
    expect(dealDamage(g(), dummy(5, "SUPER"), 2, "toxic")).toBe(1);
  });
  it("devil damage can't be reduced and obliterates at 0", () => {
    const s = g(); const d = dummy(3, "SUPER");
    expect(dealDamage(s, d, 3, "devil")).toBe(3);
    expect(d.alive).toBe(false);
  });
  it("cannotSlay leaves the target at 1 hp", () => {
    const d = dummy(3, null);
    dealDamage(g(), d, 10, "fire", { cannotSlay: true });
    expect(d.hp).toBe(1);
    expect(d.alive).toBe(true);
  });
});

describe("tokens", () => {
  it("vulnerable adds 1 and is spent", () => {
    const d = dummy(5, null); d.tokens.vulnerable = 1;
    expect(dealDamage(g(), d, 2, "physical")).toBe(3);
    expect(d.tokens.vulnerable).toBe(0);
  });
  it("vitality subtracts 1 and is spent", () => {
    const d = dummy(5, null); d.tokens.vitality = 1;
    expect(dealDamage(g(), d, 2, "physical")).toBe(1);
    expect(d.tokens.vitality).toBe(0);
  });
});

describe("movement", () => {
  it("reachable respects MV and never includes occupied cells", () => {
    const s = g(); autoDeploy(s);
    const u = s.units.find((x) => x.owner === 0 && !x.isNecromancer)!;
    const spots = reachable(s, u, u.mv);
    expect(spots.length).toBeGreaterThan(0);
    for (const p of spots) expect(s.units.some((o) => o.alive && o.pos.x === p.x && o.pos.y === p.y)).toBe(false);
  });
});

describe("terrain", () => {
  it("every game generates terrain (walls / elevated / hazard / adverse)", () => {
    const s = g();
    const cells = Object.values(s.terrain);
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.some((c) => c.wall)).toBe(true);
    expect(cells.some((c) => c.elevated)).toBe(true);
  });
  it("a wall blocks movement — no legal move lands on it", () => {
    const s = g(); autoDeploy(s);
    const walls = new Set(Object.entries(s.terrain).filter(([, c]) => c.wall).map(([k]) => k));
    for (const u of s.units.filter((x) => x.alive)) {
      for (const p of legalMoves(s, u.iid)) expect(walls.has(`${p.x},${p.y}`)).toBe(false);
    }
  });
  it("entering a hazard deals 1 damage ignoring armor", () => {
    const s = g(); autoDeploy(s);
    const mover = s.units.find((u) => u.owner === s.activeSide && !u.isNecromancer)!;
    // put a hazard on an empty orthogonal neighbour and move onto it
    const spot = legalMoves(s, mover.iid)[0];
    s.terrain[`${spot.x},${spot.y}`] = { hazard: true };
    const hp0 = mover.hp;
    const r = applyAction(s, s.activeSide, { kind: "move", iid: mover.iid, to: spot });
    expect(r.ok).toBe(true);
    expect(mover.hp).toBe(hp0 - 1);
    expect(terrainAt(s, spot)?.hazard).toBe(true);
  });
});

describe("turn flow + win", () => {
  it("rejects acting out of turn and on the wrong side's units", () => {
    const s = g(); autoDeploy(s);
    const mine = s.units.find((u) => u.owner === 0 && !u.isNecromancer)!;
    // side 1 cannot move while it is side 0's turn
    expect(applyAction(s, 1, { kind: "move", iid: mine.iid, to: { x: mine.pos.x, y: mine.pos.y } }).ok).toBe(false);
    // side 0 cannot move side 1's unit
    const theirs = s.units.find((u) => u.owner === 1)!;
    expect(applyAction(s, 0, { kind: "move", iid: theirs.iid, to: theirs.pos }).error).toMatch(/your unit/);
  });
  it("slaying a necromancer ends the game", () => {
    const s = g(); autoDeploy(s);
    const necro = s.units.find((u) => u.owner === 1 && u.isNecromancer)!;
    dealDamage(s, necro, 999, "physical");
    expect(s.phase).toBe("over");
    expect(s.winner).toBe(0);
  });
});
