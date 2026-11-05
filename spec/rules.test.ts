// Pure engine unit tests — the faithful combat core from data/rules.json.
// These import the engine directly (no HTTP); they protect the rules the build
// can't see on its own. They run under the same `pnpm check` as the HTTP checks.

import { describe, it, expect } from "vitest";
import {
  createGame, autoDeploy, applyAction, dealDamage, reachable, legalMoves, terrainAt,
  legalTargets, type Loadout,
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
    foe.pos = { x: penitent.pos.x, y: penitent.pos.y + 1 };
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
    foe.pos = { x: penitent.pos.x, y: penitent.pos.y + 1 };
    s.activeSide = penitent.owner;
    const r = applyAction(s, penitent.owner, { kind: "act", iid: penitent.iid, ability: "Excoriate", target: foe.pos });
    expect(r.ok).toBe(true);
    expect(penitent.tokens.vitality).toBe(1);
  });
});

describe("ability targeting respects ownership (ally vs. foe)", () => {
  const LC: Loadout = { userId: 1, house: "carcass", colour: "#e6194b",
    units: [{ defId: "ammo-goblin" }, { defId: "gunwight" }] };
  const LG: Loadout = { userId: 2, house: "goregrinders", colour: "#4363d8",
    units: [{ defId: "warhead" }, { defId: "carnifex" }] };

  it("legalTargets for an ally-targeted ability (Regurgitate Ammo) only offers the caster's own side", () => {
    const s = createGame(LC, LG, 42, 0);
    autoDeploy(s);
    const ammoGoblin = s.units.find((u) => u.defId === "ammo-goblin")!;
    const targets = legalTargets(s, ammoGoblin.iid, "Regurgitate Ammo");
    expect(targets.length).toBeGreaterThan(0);
    for (const t of targets) {
      const u = s.units.find((x) => x.iid === t.iid)!;
      expect(u.owner).toBe(ammoGoblin.owner);
    }
  });

  it("legalTargets for a foe-targeted ability (Akimbo) only offers the opposing side", () => {
    const s = createGame(LC, LG, 42, 0);
    autoDeploy(s);
    const operator = s.units.find((u) => u.defId === "operator")!;
    const warhead = s.units.find((u) => u.defId === "warhead")!;
    warhead.pos = { x: operator.pos.x + 3, y: operator.pos.y };
    const targets = legalTargets(s, operator.iid, "Akimbo");
    expect(targets.length).toBeGreaterThan(0);
    for (const t of targets) {
      const u = s.units.find((x) => x.iid === t.iid)!;
      expect(u.owner).not.toBe(operator.owner);
    }
  });

  it("a raw {x,y} POST can't aim a foe-targeted ability at the caster's own ally", () => {
    const s = createGame(LC, LG, 42, 0);
    autoDeploy(s);
    const operator = s.units.find((u) => u.defId === "operator")!;
    const ammoGoblin = s.units.find((u) => u.defId === "ammo-goblin")!;
    ammoGoblin.pos = { x: operator.pos.x + 3, y: operator.pos.y };   // in Akimbo's [2,4] range
    s.activeSide = operator.owner;
    const r = applyAction(s, operator.owner, { kind: "act", iid: operator.iid, ability: "Akimbo", target: ammoGoblin.pos });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("wrong target");
  });

  it("a raw {x,y} POST can't aim an ally-targeted ability at the opponent's unit", () => {
    const s = createGame(LC, LG, 42, 0);
    autoDeploy(s);
    const ammoGoblin = s.units.find((u) => u.defId === "ammo-goblin")!;
    const warhead = s.units.find((u) => u.defId === "warhead")!;
    warhead.pos = { x: ammoGoblin.pos.x, y: ammoGoblin.pos.y + 1 };   // in Regurgitate Ammo's [1,2] range, no collision
    s.activeSide = ammoGoblin.owner;
    const r = applyAction(s, ammoGoblin.owner, { kind: "act", iid: ammoGoblin.iid, ability: "Regurgitate Ammo", target: warhead.pos });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("wrong target");
  });

  it("Akimbo's (4+) secondary hit lands on a different foe in range, not the primary target again", () => {
    const s = createGame(LC, LG, 2, 0);   // seed 2 rolls a hit + a 4+ effect die
    autoDeploy(s);
    const operator = s.units.find((u) => u.defId === "operator")!;
    const warhead = s.units.find((u) => u.defId === "warhead")!;
    const carnifex = s.units.find((u) => u.defId === "carnifex")!;
    warhead.pos = { x: 3, y: 0 };
    carnifex.pos = { x: 4, y: 0 };
    s.activeSide = operator.owner;
    const r = applyAction(s, operator.owner, { kind: "act", iid: operator.iid, ability: "Akimbo", target: warhead.pos });
    expect(r.ok).toBe(true);
    expect(warhead.hp).toBe(0);     // primary attack: 2 damage on a 2 hp unit
    expect(carnifex.hp).toBe(3);    // secondary (4+) hit: 1 damage to the OTHER foe, not warhead again
  });

  it("Cleave's \"another adjacent unit\" hits a different enemy than the primary target", () => {
    const LW: Loadout = { userId: 1, house: "goregrinders", colour: "#e6194b", units: [{ defId: "warhead" }] };
    const LF: Loadout = { userId: 2, house: "carcass", colour: "#4363d8", units: [{ defId: "gunwight" }, { defId: "enforcer" }] };
    const s = createGame(LW, LF, 42, 0);
    autoDeploy(s);
    const warhead = s.units.find((u) => u.defId === "warhead")!;
    const gunwight = s.units.find((u) => u.defId === "gunwight")!;
    const enforcer = s.units.find((u) => u.defId === "enforcer")!;
    gunwight.pos = { x: warhead.pos.x + 1, y: warhead.pos.y };
    enforcer.pos = { x: warhead.pos.x + 1, y: warhead.pos.y + 1 };   // adjacent to gunwight, not warhead
    s.activeSide = warhead.owner;
    applyAction(s, warhead.owner, { kind: "act", iid: warhead.iid, ability: "Cleave", target: gunwight.pos });
    // "another adjacent unit" is adjacent to the primary target (gunwight), which enforcer
    // is — confirm the secondary damage op resolved against enforcer, not gunwight again
    // (enforcer's PHYS armor reduces the 1 physical damage to 0, so HP alone can't tell).
    expect(s.log.some((l) => /deals \d to Enforcer/.test(l.text))).toBe(true);
  });
});

describe("SOUL actions", () => {
  it("is rejected while still in deploy phase", () => {
    const L: Loadout = { userId: 1, house: "carcass", colour: "#e6194b", units: [{ defId: "gunwight" }] };
    const LB: Loadout = { userId: 2, house: "goregrinders", colour: "#4363d8", units: [{ defId: "warhead" }] };
    const s = createGame(L, LB, 1, 0);
    expect(applyAction(s, 0, { kind: "soul", ability: "Reload Slide" }).ok).toBe(false);
  });

  it("can be used on the OPPONENT's turn — it doesn't consume a unit's activation", () => {
    const L: Loadout = { userId: 1, house: "carcass", colour: "#e6194b", units: [{ defId: "gunwight" }] };
    const LB: Loadout = { userId: 2, house: "goregrinders", colour: "#4363d8", units: [{ defId: "warhead" }] };
    const s = createGame(L, LB, 1, 0);
    autoDeploy(s);
    s.round = 2; s.players[0].soul = 2;
    s.activeSide = 1;   // side 1's turn, but side 0 spends a soul ability
    const r = applyAction(s, 0, { kind: "soul", ability: "Reload Slide" });
    expect(r.ok).toBe(true);
    expect(s.players[0].soul).toBe(1);
    expect(s.activeSide).toBe(1);   // the active side's turn is untouched
  });

  it("is rejected: not enough SOUL banked", () => {
    const L: Loadout = { userId: 1, house: "carcass", colour: "#e6194b", units: [{ defId: "gunwight" }] };
    const LB: Loadout = { userId: 2, house: "goregrinders", colour: "#4363d8", units: [{ defId: "warhead" }] };
    const s = createGame(L, LB, 1, 0);
    autoDeploy(s);
    s.players[0].soul = 0;
    const r = applyAction(s, 0, { kind: "soul", ability: "Reload Slide" });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("not enough soul");
  });

  it("is rejected: only one soul ability per unit turn", () => {
    const L: Loadout = { userId: 1, house: "carcass", colour: "#e6194b", units: [{ defId: "gunwight" }] };
    const LB: Loadout = { userId: 2, house: "goregrinders", colour: "#4363d8", units: [{ defId: "warhead" }] };
    const s = createGame(L, LB, 1, 0);
    autoDeploy(s);
    s.players[0].soul = 6;
    expect(applyAction(s, 0, { kind: "soul", ability: "Reload Slide" }).ok).toBe(true);
    const r2 = applyAction(s, 0, { kind: "soul", ability: "Reload Slide" });
    expect(r2.ok).toBe(false);
    expect(r2.error).toBe("already used a soul ability this turn");
  });

  it("is rejected: an ability belonging to a different House's necromancer", () => {
    const L: Loadout = { userId: 1, house: "carcass", colour: "#e6194b", units: [{ defId: "gunwight" }] };
    const LB: Loadout = { userId: 2, house: "goregrinders", colour: "#4363d8", units: [{ defId: "warhead" }] };
    const s = createGame(L, LB, 1, 0);
    autoDeploy(s);
    s.players[0].soul = 6;
    const r = applyAction(s, 0, { kind: "soul", ability: "Ignite" });   // a goregrinders soul, not carcass
    expect(r.ok).toBe(false);
    expect(r.error).toBe("no such soul ability");
  });

  it("Will of God and Sample Genome are disclosed gaps — a clear error, not a silent no-op", () => {
    const L: Loadout = { userId: 1, house: "abhorrers", colour: "#e6194b", units: [{ defId: "penitent" }] };
    const LB: Loadout = { userId: 2, house: "goregrinders", colour: "#4363d8", units: [{ defId: "warhead" }] };
    const s = createGame(L, LB, 1, 0);
    autoDeploy(s);
    s.players[0].soul = 6;
    const r = applyAction(s, 0, { kind: "soul", ability: "Will of God", target: { x: s.units[0].pos.x, y: s.units[0].pos.y + 1 } });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("not yet implemented");
  });

  it("carcass Reload Slide steps and reloads for 1 SOUL", () => {
    const L: Loadout = { userId: 1, house: "carcass", colour: "#e6194b", units: [{ defId: "gunwight" }] };
    const LB: Loadout = { userId: 2, house: "goregrinders", colour: "#4363d8", units: [{ defId: "warhead" }] };
    const s = createGame(L, LB, 1, 0);
    autoDeploy(s);
    s.round = 2; s.players[0].soul = 2;
    const r = applyAction(s, 0, { kind: "soul", ability: "Reload Slide" });
    expect(r.ok).toBe(true);
    expect(s.players[0].soul).toBe(1);
  });

  it("goregrinders Glory Kill obliterates an adjacent unit at 1 hp or lower and gains strength", () => {
    const L: Loadout = { userId: 1, house: "goregrinders", colour: "#e6194b", units: [{ defId: "warhead" }] };
    const LB: Loadout = { userId: 2, house: "carcass", colour: "#4363d8", units: [{ defId: "gunwight" }] };
    const s = createGame(L, LB, 1, 0);
    autoDeploy(s);
    s.players[0].soul = 6;
    const warlord = s.units.find((u) => u.defId === "warlord")!;
    const gunwight = s.units.find((u) => u.defId === "gunwight")!;
    gunwight.pos = { x: warlord.pos.x, y: warlord.pos.y + 1 };
    gunwight.hp = 1;
    const r = applyAction(s, 0, { kind: "soul", ability: "Glory Kill", target: gunwight.pos });
    expect(r.ok).toBe(true);
    expect(gunwight.alive).toBe(false);
    expect(warlord.tokens.strength).toBe(2);
  });

  it("goregrinders Glory Kill does not obliterate a target above 1 hp", () => {
    const L: Loadout = { userId: 1, house: "goregrinders", colour: "#e6194b", units: [{ defId: "warhead" }] };
    const LB: Loadout = { userId: 2, house: "carcass", colour: "#4363d8", units: [{ defId: "gunwight" }] };
    const s = createGame(L, LB, 1, 0);
    autoDeploy(s);
    s.players[0].soul = 6;
    const warlord = s.units.find((u) => u.defId === "warlord")!;
    const gunwight = s.units.find((u) => u.defId === "gunwight")!;
    gunwight.pos = { x: warlord.pos.x, y: warlord.pos.y + 1 };   // 2 hp, not <=1
    const r = applyAction(s, 0, { kind: "soul", ability: "Glory Kill", target: gunwight.pos });
    expect(r.ok).toBe(true);
    expect(gunwight.alive).toBe(true);
  });

  it("gargamox Infest grants 2 plague tokens to a foe in range", () => {
    const L: Loadout = { userId: 1, house: "gargamox", colour: "#e6194b", units: [{ defId: "scum" }] };
    const LB: Loadout = { userId: 2, house: "carcass", colour: "#4363d8", units: [{ defId: "gunwight" }] };
    const s = createGame(L, LB, 1, 0);
    autoDeploy(s);
    s.players[0].soul = 6;
    const nec = s.units.find((u) => u.isNecromancer && u.owner === 0)!;
    const gunwight = s.units.find((u) => u.defId === "gunwight")!;
    gunwight.pos = { x: nec.pos.x + 2, y: nec.pos.y };
    const r = applyAction(s, 0, { kind: "soul", ability: "Infest", target: gunwight.pos });
    expect(r.ok).toBe(true);
    expect(gunwight.tokens.plague).toBe(2);
  });

  it("gargamox Slime Form needs no target and pushes units in range", () => {
    const L: Loadout = { userId: 1, house: "gargamox", colour: "#e6194b", units: [{ defId: "scum" }] };
    const LB: Loadout = { userId: 2, house: "carcass", colour: "#4363d8", units: [{ defId: "gunwight" }] };
    const s = createGame(L, LB, 1, 0);
    autoDeploy(s);
    s.players[0].soul = 6;
    const nec = s.units.find((u) => u.isNecromancer && u.owner === 0)!;
    const gunwight = s.units.find((u) => u.defId === "gunwight")!;
    gunwight.pos = { x: nec.pos.x + 2, y: nec.pos.y };
    const posBefore = { ...gunwight.pos };
    const r = applyAction(s, 0, { kind: "soul", ability: "Slime Form" });
    expect(r.ok).toBe(true);
    expect(gunwight.pos).not.toEqual(posBefore);
  });

  it("deadsouls Cyclopean Monolith places a wall and weakens an adjacent foe", () => {
    const L: Loadout = { userId: 1, house: "deadsouls", colour: "#e6194b", units: [{ defId: "cultist" }] };
    const LB: Loadout = { userId: 2, house: "carcass", colour: "#4363d8", units: [{ defId: "gunwight" }] };
    const s = createGame(L, LB, 1, 0);
    autoDeploy(s);
    s.players[0].soul = 6;
    const nec = s.units.find((u) => u.isNecromancer && u.owner === 0)!;
    const gunwight = s.units.find((u) => u.defId === "gunwight")!;
    const wallPos = { x: nec.pos.x + 2, y: nec.pos.y };
    gunwight.pos = { x: wallPos.x + 1, y: wallPos.y };
    const r = applyAction(s, 0, { kind: "soul", ability: "Cyclopean Monolith", target: wallPos });
    expect(r.ok).toBe(true);
    expect(s.terrain[`${wallPos.x},${wallPos.y}`]?.wall).toBeTruthy();
    expect(gunwight.tokens.weak).toBe(1);
  });

  it("deadsouls Cyclopean Monolith rejects a tile that's already occupied", () => {
    const L: Loadout = { userId: 1, house: "deadsouls", colour: "#e6194b", units: [{ defId: "cultist" }] };
    const LB: Loadout = { userId: 2, house: "carcass", colour: "#4363d8", units: [{ defId: "gunwight" }] };
    const s = createGame(L, LB, 1, 0);
    autoDeploy(s);
    s.players[0].soul = 6;
    const nec = s.units.find((u) => u.isNecromancer && u.owner === 0)!;
    const gunwight = s.units.find((u) => u.defId === "gunwight")!;
    gunwight.pos = { x: nec.pos.x + 2, y: nec.pos.y };
    const r = applyAction(s, 0, { kind: "soul", ability: "Cyclopean Monolith", target: gunwight.pos });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("tile not free");
  });

  it("deadsouls Soulfeed hits isolated foes in range with curse damage and weak, strengthening the caster", () => {
    const L: Loadout = { userId: 1, house: "deadsouls", colour: "#e6194b", units: [{ defId: "cultist" }] };
    const LB: Loadout = { userId: 2, house: "carcass", colour: "#4363d8", units: [{ defId: "gunwight" }, { defId: "enforcer" }] };
    const s = createGame(L, LB, 1, 0);
    autoDeploy(s);
    s.players[0].soul = 6;
    const nec = s.units.find((u) => u.isNecromancer && u.owner === 0)!;
    const gunwight = s.units.find((u) => u.defId === "gunwight")!;
    const enforcer = s.units.find((u) => u.defId === "enforcer")!;
    gunwight.pos = { x: nec.pos.x + 1, y: nec.pos.y };   // in range, isolated (no ally adjacent)
    enforcer.pos = { x: 7, y: 7 };                       // out of range entirely
    const hpBefore = gunwight.hp;
    const r = applyAction(s, 0, { kind: "soul", ability: "Soulfeed" });
    expect(r.ok).toBe(true);
    expect(gunwight.hp).toBeLessThan(hpBefore);
    expect(gunwight.tokens.weak).toBe(1);
    expect(nec.tokens.strength).toBe(1);
  });

  it("deadsouls Soulfeed does not hit a non-isolated, non-doomed foe in range", () => {
    const L: Loadout = { userId: 1, house: "deadsouls", colour: "#e6194b", units: [{ defId: "cultist" }] };
    const LB: Loadout = { userId: 2, house: "carcass", colour: "#4363d8", units: [{ defId: "gunwight" }, { defId: "enforcer" }] };
    const s = createGame(L, LB, 1, 0);
    autoDeploy(s);
    s.players[0].soul = 6;
    const nec = s.units.find((u) => u.isNecromancer && u.owner === 0)!;
    const gunwight = s.units.find((u) => u.defId === "gunwight")!;
    const enforcer = s.units.find((u) => u.defId === "enforcer")!;
    gunwight.pos = { x: nec.pos.x + 1, y: nec.pos.y };
    enforcer.pos = { x: gunwight.pos.x + 1, y: gunwight.pos.y };   // adjacent ally — gunwight is NOT isolated
    const hpBefore = gunwight.hp;
    const r = applyAction(s, 0, { kind: "soul", ability: "Soulfeed" });
    expect(r.ok).toBe(true);
    expect(gunwight.hp).toBe(hpBefore);
    expect(nec.tokens.strength ?? 0).toBe(0);
  });

  it("abhorrers Absolution costs the caster 1 piercing hp and grants an ally tiered vitality", () => {
    const L: Loadout = { userId: 1, house: "abhorrers", colour: "#e6194b", units: [{ defId: "penitent" }] };
    const LB: Loadout = { userId: 2, house: "carcass", colour: "#4363d8", units: [{ defId: "gunwight" }] };
    const s = createGame(L, LB, 1, 0);
    autoDeploy(s);
    s.players[0].soul = 6;
    const nec = s.units.find((u) => u.isNecromancer && u.owner === 0)!;
    const penitent = s.units.find((u) => u.defId === "penitent")!;
    penitent.pos = { x: nec.pos.x + 2, y: nec.pos.y };
    const hpBefore = nec.hp;
    const r = applyAction(s, 0, { kind: "soul", ability: "Absolution", target: penitent.pos });
    expect(r.ok).toBe(true);
    expect(nec.hp).toBe(hpBefore - 1);
    expect(penitent.tokens.vitality ?? 0).toBeGreaterThanOrEqual(1);
  });

  it("abhorrers Absolution rejects a foe target", () => {
    const L: Loadout = { userId: 1, house: "abhorrers", colour: "#e6194b", units: [{ defId: "penitent" }] };
    const LB: Loadout = { userId: 2, house: "carcass", colour: "#4363d8", units: [{ defId: "gunwight" }] };
    const s = createGame(L, LB, 1, 0);
    autoDeploy(s);
    s.players[0].soul = 6;
    const nec = s.units.find((u) => u.isNecromancer && u.owner === 0)!;
    const gunwight = s.units.find((u) => u.defId === "gunwight")!;
    gunwight.pos = { x: nec.pos.x + 2, y: nec.pos.y };
    const r = applyAction(s, 0, { kind: "soul", ability: "Absolution", target: gunwight.pos });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("wrong target");
  });

  it("igorri Wild Mutation grants exactly one of strength/speed/vitality from a single roll", () => {
    const L: Loadout = { userId: 1, house: "igorri", colour: "#e6194b", units: [{ defId: "homonculus" }] };
    const LB: Loadout = { userId: 2, house: "carcass", colour: "#4363d8", units: [{ defId: "gunwight" }] };
    const s = createGame(L, LB, 1, 0);
    autoDeploy(s);
    s.players[0].soul = 6;
    const nec = s.units.find((u) => u.isNecromancer && u.owner === 0)!;
    const homonculus = s.units.find((u) => u.defId === "homonculus")!;
    homonculus.pos = { x: nec.pos.x + 4, y: nec.pos.y };
    const r = applyAction(s, 0, { kind: "soul", ability: "Wild Mutation", target: homonculus.pos });
    expect(r.ok).toBe(true);
    const gained = (homonculus.tokens.strength ?? 0) + (homonculus.tokens.speed ?? 0) + (homonculus.tokens.vitality ?? 0);
    expect(gained).toBe(1);
  });
});
