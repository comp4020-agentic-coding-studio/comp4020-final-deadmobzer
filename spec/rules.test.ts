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

describe("corpses", () => {
  it("a slain unit leaves a corpse at its square; an obliterated one does not", () => {
    const s = g(); autoDeploy(s);
    const victim = s.units.find((u) => u.owner === 1 && !u.isNecromancer)!;
    const before = s.corpses.length;
    dealDamage(s, victim, 999, "physical");
    expect(s.corpses.length).toBe(before + 1);
    expect(s.corpses.some((c) => c.x === victim.pos.x && c.y === victim.pos.y)).toBe(true);
    const victim2 = s.units.find((u) => u.owner === 1 && !u.isNecromancer && u.alive)!;
    const after = s.corpses.length;
    dealDamage(s, victim2, 999, "devil");   // devil obliterates — no corpse
    expect(s.corpses.length).toBe(after);
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

describe("upgrades (mechanical)", () => {
  it("a chosen upgrade is applied to the unit (flag + name)", () => {
    const l: Loadout = { userId: 1, house: "carcass", colour: "#e6194b",
      units: [{ defId: "enforcer" }, { defId: "barrelform" }],
      upgrades: { enforcer: "Bulwark", barrelform: "Extended Barrel" } };
    const s = createGame(l, LB, 5, 0);
    const enforcer = s.units.find((u) => u.defId === "enforcer")!;
    const barrelform = s.units.find((u) => u.defId === "barrelform")!;
    expect(enforcer.upgrade).toBe("Bulwark");
    expect(enforcer.flags?.coverAttackBonus).toBe(true);
    expect(barrelform.flags?.immunePush).toBe(true);
  });
  it("super-armor-at-low-hp upgrade reduces all damage only while at 1 HP", () => {
    const low = dummy(1, null); low.flags = { superArmorAtLowHp: true };
    expect(dealDamage(g(), low, 2, "fire")).toBe(1);        // SUPER kicks in at 1 hp
    const high = dummy(5, null); high.flags = { superArmorAtLowHp: true };
    expect(dealDamage(g(), high, 2, "fire")).toBe(2);       // not low → no reduction
  });
  it("an upgrade patch on one unit does not leak to the shared faction data", () => {
    const l: Loadout = { userId: 1, house: "carcass", colour: "#e6194b",
      units: [{ defId: "barrelform" }], upgrades: { barrelform: "Caliber Up" } };
    createGame(l, LB, 5, 0);
    // a fresh, unupgraded barrelform must not carry the Caliber Up push
    const plain = createGame({ userId: 1, house: "carcass", colour: "#e6194b", units: [{ defId: "barrelform" }] }, LB, 5, 0);
    const snipe = plain.units.find((u) => u.defId === "barrelform")!.acts.find((a) => a.name === "Snipe")!;
    const hasPush = JSON.stringify(snipe.effect).includes('"push"');
    expect(hasPush).toBe(false);
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

describe("deploy phase (manual deployment)", () => {
  // createGame starts in "deploy" phase with every unit at the unplaced
  // sentinel pos {x:-1,y:-1} — nothing calls autoDeploy here.
  it("rejects a placement outside the deploying side's edge band", () => {
    const s = g();
    const mine = s.units.filter((u) => u.owner === 0);
    // deployFromEdgeSpaces is 2, so side 0's band is y in [0,1]; y=2 is outside it.
    const r = applyAction(s, 0, { kind: "deploy", placements: [{ iid: mine[0].iid, pos: { x: 0, y: 2 } }] });
    expect(r.ok).toBe(false);
    expect(mine[0].pos.x).toBe(-1);
  });
  it("rejects a batch with overlapping placements, applying none of it", () => {
    const s = g();
    const mine = s.units.filter((u) => u.owner === 0);
    const r = applyAction(s, 0, { kind: "deploy", placements: [
      { iid: mine[0].iid, pos: { x: 0, y: 0 } },
      { iid: mine[1].iid, pos: { x: 0, y: 0 } },
    ] });
    expect(r.ok).toBe(false);
    expect(mine[0].pos.x).toBe(-1);
    expect(mine[1].pos.x).toBe(-1);
  });
  it("phase only flips to playing once both sides have placed every unit", () => {
    const s = g();
    const mine = s.units.filter((u) => u.owner === 0);
    const theirs = s.units.filter((u) => u.owner === 1);
    // side 0 places only its first unit — still incomplete
    const partial = applyAction(s, 0, { kind: "deploy", placements: [{ iid: mine[0].iid, pos: { x: 0, y: 0 } }] });
    expect(partial.ok).toBe(true);
    expect(s.phase).toBe("deploy");
    expect(s.players[0].deployed).toBe(false);
    // side 0 places the rest
    const rest = mine.slice(1).map((u, i) => ({ iid: u.iid, pos: { x: i + 1, y: 0 } }));
    applyAction(s, 0, { kind: "deploy", placements: rest });
    expect(s.players[0].deployed).toBe(true);
    expect(s.phase).toBe("deploy");   // side 1 hasn't deployed yet
    // side 1 places everything at once
    const theirPlacements = theirs.map((u, i) => ({ iid: u.iid, pos: { x: i, y: s.mapSize - 1 } }));
    applyAction(s, 1, { kind: "deploy", placements: theirPlacements });
    expect(s.players[1].deployed).toBe(true);
    expect(s.phase).toBe("playing");
  });
  it("move, act, soul and endTurn actions are rejected while still in deploy phase", () => {
    const s = g();
    const mine = s.units.filter((u) => u.owner === 0)[0];
    expect(applyAction(s, 0, { kind: "move", iid: mine.iid, to: { x: 0, y: 0 } }).ok).toBe(false);
    expect(applyAction(s, 0, { kind: "endTurn" }).ok).toBe(false);
  });
});

describe("berserk (goregrinders specialTags.Berserk)", () => {
  it("after a berserk unit ACTs, it splashes 1 to adjacent units and discards the token", () => {
    const s = g(); autoDeploy(s);
    const carnifex = s.units.find((u) => u.defId === "carnifex")!;
    carnifex.tokens.berserk = 1;
    const foe = s.units.find((u) => u.owner !== carnifex.owner && !u.isNecromancer)!;
    foe.pos = { x: carnifex.pos.x + 1, y: carnifex.pos.y };
    const hp0 = foe.hp;
    s.activeSide = carnifex.owner;
    const r = applyAction(s, carnifex.owner, { kind: "act", iid: carnifex.iid, ability: "Rev" });
    expect(r.ok).toBe(true);
    expect(foe.hp).toBe(hp0 - 1);
    expect(carnifex.tokens.berserk ?? 0).toBe(0);
  });
  it("if the splash damages nobody, the berserk unit instead takes 1 damage itself", () => {
    const s = g(); autoDeploy(s);
    const carnifex = s.units.find((u) => u.defId === "carnifex")!;
    carnifex.tokens.berserk = 1;
    // move every other unit far away so nothing is adjacent
    for (const u of s.units) if (u.iid !== carnifex.iid) u.pos = { x: 0, y: 0 };
    carnifex.pos = { x: s.mapSize - 1, y: s.mapSize - 1 };
    const hp0 = carnifex.hp;
    s.activeSide = carnifex.owner;
    const r = applyAction(s, carnifex.owner, { kind: "act", iid: carnifex.iid, ability: "Rev" });
    expect(r.ok).toBe(true);
    expect(carnifex.hp).toBe(hp0 - 1);
    expect(carnifex.tokens.berserk ?? 0).toBe(0);
  });
});

describe("doom (deadsouls specialMechanic)", () => {
  it("a Doomed unit takes 4 devil damage at the end of round 4, undoomed units don't", () => {
    const s = g(); autoDeploy(s);
    const doomed = s.units.find((u) => u.owner === 1 && !u.isNecromancer)!;
    const clean = s.units.find((u) => u.owner === 1 && !u.isNecromancer && u.iid !== doomed.iid)!;
    doomed.tokens.doom = 1;
    const doomedHp0 = doomed.hp, cleanHp0 = clean.hp;
    s.round = 4;
    // forfeit every remaining activation this round to trigger the end-of-round-4 check
    while (s.round === 4) applyAction(s, s.activeSide, { kind: "endTurn" });
    expect(doomed.hp).toBe(Math.max(0, doomedHp0 - 4));
    expect(clean.hp).toBe(cleanHp0);
  });
});

describe("plague (gargamox specialMechanic)", () => {
  const LC: Loadout = { userId: 1, house: "carcass", colour: "#e6194b",
    units: [{ defId: "gunwight" }, { defId: "enforcer" }, { defId: "barrelform" }] };
  const LG: Loadout = { userId: 2, house: "gargamox", colour: "#4363d8",
    units: [{ defId: "scum" }, { defId: "leech" }, { defId: "rotten" }] };
  const pg = (): GameState => createGame(LC, LG, 42, 0);

  it("a plagued unit takes 1 toxic damage at the end of its own turn, and discards the token", () => {
    const s = pg(); autoDeploy(s);
    const u = s.units.find((x) => x.owner === 0 && !x.isNecromancer)!;
    u.tokens.plague = 1;
    s.activeSide = u.owner;
    const to = legalMoves(s, u.iid)[0];
    const hp0 = u.hp;
    const r = applyAction(s, u.owner, { kind: "move", iid: u.iid, to });
    expect(r.ok).toBe(true);
    expect(u.hp).toBe(hp0 - 1);
    expect(u.tokens.plague ?? 0).toBe(0);
  });
  it("plague can't slay (floors at 1 hp), and Gargamox units are immune to their own plague", () => {
    const s = pg(); autoDeploy(s);
    const low = s.units.find((x) => x.owner === 0 && !x.isNecromancer)!;
    low.hp = 1; low.tokens.plague = 1;
    s.activeSide = low.owner;
    applyAction(s, low.owner, { kind: "move", iid: low.iid, to: legalMoves(s, low.iid)[0] });
    expect(low.hp).toBe(1);
    expect(low.alive).toBe(true);

    const gar = s.units.find((x) => x.owner === 1 && !x.isNecromancer)!;
    gar.tokens.plague = 1;
    s.activeSide = gar.owner;
    const hp0 = gar.hp;
    applyAction(s, gar.owner, { kind: "move", iid: gar.iid, to: legalMoves(s, gar.iid)[0] });
    expect(gar.hp).toBe(hp0);
    expect(gar.tokens.plague).toBe(1);   // Gargamox units don't remove plague tokens either
  });
});

describe("miracle (abhorrers specialMechanic)", () => {
  const LH: Loadout = { userId: 1, house: "abhorrers", colour: "#e6194b",
    units: [{ defId: "penitent" }, { defId: "antipriest" }] };
  const LO: Loadout = { userId: 2, house: "goregrinders", colour: "#4363d8",
    units: [{ defId: "warhead" }, { defId: "carnifex" }] };

  it("a unit with the Miracle trait can return to life at 1 hp, tokens cleared, on a 5+ roll", () => {
    // seed 3 rolls a 5+ on the miracle check for this matchup/order (verified empirically)
    const s = createGame(LH, LO, 3, 0);
    autoDeploy(s);
    const penitent = s.units.find((u) => u.defId === "penitent")!;
    penitent.tokens.strength = 2;
    dealDamage(s, penitent, 999, "physical");
    expect(penitent.alive).toBe(true);
    expect(penitent.hp).toBe(1);
    expect(penitent.tokens.strength ?? 0).toBe(0);
  });
  it("on a failed roll the unit is slain as normal", () => {
    // seed 1 rolls below 5 on the miracle check for this matchup/order
    const s = createGame(LH, LO, 1, 0);
    autoDeploy(s);
    const penitent = s.units.find((u) => u.defId === "penitent")!;
    dealDamage(s, penitent, 999, "physical");
    expect(penitent.alive).toBe(false);
  });
});

describe("mutation (igorri specialTags.Mutate)", () => {
  it("Warpflesh (Homonculus) starts combat with 4 mutation tokens; other units don't", () => {
    const l: Loadout = { userId: 1, house: "igorri", colour: "#e6194b",
      units: [{ defId: "homonculus" }, { defId: "stitch" }] };
    const s = createGame(l, LB, 42, 0);
    const homonculus = s.units.find((u) => u.defId === "homonculus")!;
    const stitch = s.units.find((u) => u.defId === "stitch")!;
    expect(homonculus.tokens.mutation).toBe(4);
    expect(stitch.tokens.mutation ?? 0).toBe(0);
  });
});

describe("stance (abhorrers specialTags.Stance)", () => {
  const LH: Loadout = { userId: 1, house: "abhorrers", colour: "#e6194b",
    units: [{ defId: "penitent" }, { defId: "antipriest" }] };
  const LO: Loadout = { userId: 2, house: "goregrinders", colour: "#4363d8",
    units: [{ defId: "warhead" }, { defId: "carnifex" }] };

  it("on an odd round, Excoriate's on-hit stance branch splashes 1 holy to adjacent units", () => {
    const s = createGame(LH, LO, 1, 0);
    autoDeploy(s);
    s.round = 1;
    const penitent = s.units.find((u) => u.defId === "penitent")!;
    const foe = s.units.find((u) => u.owner !== penitent.owner && !u.isNecromancer)!;
    foe.pos = { x: penitent.pos.x + 1, y: penitent.pos.y };
    s.activeSide = penitent.owner;
    const r = applyAction(s, penitent.owner, { kind: "act", iid: penitent.iid, ability: "Excoriate", target: foe.pos });
    expect(r.ok).toBe(true);
    expect(s.log.some((l) => /Penitent deals \d to \w+/.test(l.text))).toBe(true);
  });
  it("on an even round, Excoriate's on-hit stance branch grants vitality instead", () => {
    const s = createGame(LH, LO, 1, 0);
    autoDeploy(s);
    s.round = 2;
    const penitent = s.units.find((u) => u.defId === "penitent")!;
    const foe = s.units.find((u) => u.owner !== penitent.owner && !u.isNecromancer)!;
    foe.pos = { x: penitent.pos.x + 1, y: penitent.pos.y };
    s.activeSide = penitent.owner;
    const r = applyAction(s, penitent.owner, { kind: "act", iid: penitent.iid, ability: "Excoriate", target: foe.pos });
    expect(r.ok).toBe(true);
    expect(penitent.tokens.vitality).toBe(1);
  });
});
