// The game engine: pure, server-authoritative functions over GameState.
// Clients never decide outcomes — the server rolls (seeded PRNG in state),
// resolves, logs, and persists. Faithful to data/rules.json; the effect-op
// interpreter runs what it understands and logs the rest.

import type {
  Ability, Action, Armor, DamageType, EffectOp, GameState, LogEntry, Pos,
  SidePlayer, TerrainCell, TokenType, Unit,
} from "./types.ts";
import { makeRng, rollD6, rollPool, type Rng } from "./prng.ts";
import { allUnitDefs, faction, MAP_SIZE, MAX_ROUNDS } from "./data.ts";
import { applyUpgrade } from "./upgrades.ts";

// ---------- helpers ----------

const other = (s: 0 | 1): 0 | 1 => (s === 1 ? 0 : 1);
const key = (p: Pos) => `${p.x},${p.y}`;
const inBounds = (p: Pos, n = MAP_SIZE) => p.x >= 0 && p.y >= 0 && p.x < n && p.y < n;
const manhattan = (a: Pos, b: Pos) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const chebyshev = (a: Pos, b: Pos) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
export const adjacent = (a: Pos, b: Pos) => chebyshev(a, b) === 1;

export function unitAt(s: GameState, p: Pos): Unit | undefined {
  return s.units.find((u) => u.alive && u.pos.x === p.x && u.pos.y === p.y);
}
function unit(s: GameState, iid: string): Unit | undefined {
  return s.units.find((u) => u.iid === iid);
}
function log(s: GameState, e: Omit<LogEntry, "round">) {
  s.log.push({ round: s.round, ...e });
}

function tok(u: Unit, t: TokenType): number {
  return u.tokens[t] ?? 0;
}
function addToken(u: Unit, t: TokenType, n: number) {
  // Apply cancels: strength/weak, vitality/vulnerable, slow/speed.
  const pairs: Record<string, TokenType> = {
    strength: "weak", weak: "strength",
    vitality: "vulnerable", vulnerable: "vitality",
    slow: "speed", speed: "slow",
  };
  let have = tok(u, t) + n;
  const opp = pairs[t];
  if (opp) {
    const oppHave = tok(u, opp);
    const cancel = Math.min(have, oppHave);
    if (cancel > 0) {
      u.tokens[opp] = oppHave - cancel;
      have -= cancel;
    }
  }
  u.tokens[t] = Math.max(0, have);
}
function spendToken(u: Unit, t: TokenType) {
  if (tok(u, t) > 0) u.tokens[t] = tok(u, t) - 1;
}

// ---------- damage ----------

function armorReduces(arm: Armor, type: DamageType): boolean {
  if (arm === "SUPER") return true;
  if (arm === "PHYS") return type === "physical";
  if (arm === "MAG") return type === "fire" || type === "toxic" || type === "curse" || type === "holy";
  return false;
}

export interface DamageOpts { pierce?: boolean; cannotSlay?: boolean; obliterate?: boolean }

// Apply final damage to a unit, honouring armor, pierce, devil, vitality/
// vulnerable tokens, upgrade flags, and slain/obliterate. Returns damage dealt.
export function dealDamage(
  s: GameState, target: Unit, amount: number, type: DamageType, opts: DamageOpts = {},
): number {
  if (!target.alive || amount <= 0) return 0;
  let dmg = amount;

  if (type === "devil") {
    // Devil damage can't be reduced, increased or ignored.
    target.hp -= dmg;
    if (target.hp <= 0) obliterate(s, target);
    return dmg;
  }

  // vulnerable / vitality (one token each, discarded on taking damage)
  if (tok(target, "vulnerable") > 0) { dmg += 1; spendToken(target, "vulnerable"); }
  else if (tok(target, "vitality") > 0) { dmg = Math.max(0, dmg - 1); spendToken(target, "vitality"); }

  // armor — upgrade: super armor while at low HP overrides the base armor type
  let arm = target.arm;
  if (target.flags?.superArmorAtLowHp && target.hp <= 1) arm = "SUPER";
  if (!opts.pierce && arm && armorReduces(arm, type)) dmg = Math.max(0, dmg - 1);

  if (dmg <= 0) return 0;
  if (opts.cannotSlay) dmg = Math.min(dmg, Math.max(0, target.hp - 1));

  target.hp -= dmg;
  if (target.hp <= 0) { if (opts.obliterate) obliterate(s, target); else slay(s, target); }
  return dmg;
}

function slay(s: GameState, u: Unit) {
  u.hp = 0;
  u.alive = false;
  log(s, { side: null, actor: u.name, text: `${u.name} is slain.` });
  onSlain(s, u);
}
function obliterate(s: GameState, u: Unit) {
  u.hp = 0;
  u.alive = false;
  log(s, { side: null, actor: u.name, text: `${u.name} is obliterated.` });
  // obliterated: no SOUL, no on-slain triggers.
  checkWin(s, u);
}
function onSlain(s: GameState, u: Unit) {
  // SOUL Harvest: the owner gains +1 SOUL the first time one of their units is slain.
  const owner = s.players[u.owner];
  if (!owner.firstSlainTaken) {
    owner.firstSlainTaken = true;
    owner.soul = Math.min(RULES_SOUL_MAX, owner.soul + 1);
  }
  checkWin(s, u);
}
const RULES_SOUL_MAX = 6;

function checkWin(s: GameState, slainUnit: Unit) {
  if (slainUnit.isNecromancer) {
    s.winner = other(slainUnit.owner);
    s.phase = "over";
    log(s, { side: null, actor: "system", text: `Side ${s.winner! + 1} wins — the enemy necromancer has fallen.` });
  }
}

// ---------- movement ----------

export function terrainAt(s: GameState, p: Pos): TerrainCell | undefined {
  return s.terrain?.[key(p)];
}
function isWall(s: GameState, p: Pos): boolean {
  return !!terrainAt(s, p)?.wall;
}
// A unit has cover if it is on, or orthogonally beside, a wall or elevated space.
function inCover(s: GameState, p: Pos): boolean {
  const here = terrainAt(s, p);
  if (here?.elevated || here?.wall) return true;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const t = terrainAt(s, { x: p.x + dx, y: p.y + dy });
    if (t?.wall || t?.elevated) return true;
  }
  return false;
}

function blocked(s: GameState, p: Pos, mover: Unit): boolean {
  if (isWall(s, p)) return true;                   // walls obstruct
  const u = unitAt(s, p);
  if (!u) return false;
  // can pass through allies (but not end there — enforced by caller), blocked by foes
  return u.owner !== mover.owner;
}

// Cost to step from `cur` into `np`: 1, +1 to enter elevated (unless stairs),
// +1 to exit an adverse cell (rulebook pg. 19).
function stepCost(s: GameState, cur: Pos, np: Pos): number {
  let c = 1;
  const to = terrainAt(s, np);
  if (to?.elevated && !to?.stairs) c += 1;
  if (terrainAt(s, cur)?.adverse) c += 1;
  return c;
}

// Cost-aware orthogonal search up to `budget` movement points; returns the empty
// cells a unit can legally end on, honouring walls, foes, elevation and adverse.
export function reachable(s: GameState, u: Unit, budget: number): Pos[] {
  const start = u.pos;
  const best = new Map<string, number>([[key(start), 0]]);
  const q: Pos[] = [start];
  const out: Pos[] = [];
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  while (q.length) {
    const cur = q.shift()!;
    const d = best.get(key(cur))!;
    for (const [dx, dy] of dirs) {
      const np = { x: cur.x + dx, y: cur.y + dy };
      if (!inBounds(np) || blocked(s, np, u)) continue;
      const nd = d + stepCost(s, cur, np);
      if (nd > budget) continue;
      if (best.has(key(np)) && best.get(key(np))! <= nd) continue;
      best.set(key(np), nd);
      q.push(np);
      if (!unitAt(s, np) && !out.some((p) => p.x === np.x && p.y === np.y)) out.push(np);
    }
  }
  return out;
}

function moveBudget(u: Unit): number {
  if (tok(u, "slow") > 0) return 1;
  let b = u.mv;
  if (tok(u, "speed") > 0) b += 2;
  return b;
}

// The tiles a unit may legally move to right now (for the client to highlight).
export function legalMoves(s: GameState, iid: string): Pos[] {
  const u = unit(s, iid);
  if (!u || !u.alive || u.activatedThisRound || s.phase !== "playing") return [];
  return reachable(s, u, moveBudget(u));
}

// ---------- attack ----------

function dicePool(s: GameState, attacker: Unit): number {
  let pool = 1;
  // Formation: +1D while adjacent to an ally.
  if (attacker.acts.some(() => false)) { /* placeholder */ }
  if (hasTrait(s, attacker, "Formation") && adjacentAlly(s, attacker)) pool += 1;
  if (tok(attacker, "weak") > 0) { /* weak affects damage, not pool */ }
  return pool;
}
function hasTrait(_s: GameState, u: Unit, name: string): boolean {
  const f = faction(u.house);
  const def = [f.necromancer, ...f.units].find((d) => d.id === u.defId);
  return !!def?.traits.some((t) => t.name === name);
}
function adjacentAlly(s: GameState, u: Unit): boolean {
  return s.units.some((o) => o.alive && o.iid !== u.iid && o.owner === u.owner && adjacent(o.pos, u.pos));
}

function damageBonus(u: Unit): number {
  if (tok(u, "strength") > 0) return 1;
  if (tok(u, "weak") > 0) return -1;
  return 0;
}

// ---------- effect interpreter ----------

interface Ctx {
  s: GameState;
  actor: Unit;
  target?: Unit;       // primary target (attack/choose)
  lastRoll?: number;   // final attack roll (for headshot)
  hit?: boolean;
}

function resolveEffects(ctx: Ctx, ops: EffectOp[] | undefined) {
  if (!ops) return;
  for (const op of ops) resolveOp(ctx, op);
}

function resolveOp(ctx: Ctx, op: EffectOp) {
  const { s, actor } = ctx;
  switch (op.op) {
    case "attack": {
      let pool = dicePool(s, actor);
      const t = ctx.target;
      if (t) {
        const ranged = !adjacent(actor.pos, t.pos);            // ranged ⇒ cover applies
        if (ranged && inCover(s, t.pos)) pool -= 1;            // -1D vs a covered target
        const aEl = !!terrainAt(s, actor.pos)?.elevated;
        const tEl = !!terrainAt(s, t.pos)?.elevated;
        if (aEl && !tEl) pool += 1;                             // high ground: +1D
        if (tEl && !aEl) pool -= 1;                             // shooting uphill: -1D
      }
      if (actor.flags?.coverAttackBonus && inCover(s, actor.pos)) pool += 1;  // upgrade
      const { value, dice } = rollPool(s.rng, pool);
      ctx.lastRoll = value;
      const tgt = ctx.target;
      if (!tgt) return;
      const hit = value >= tgt.df;
      ctx.hit = hit;
      const base = (op.damage as number) ?? 0;
      if (hit) {
        const dmg = Math.max(0, base + damageBonus(actor));
        if (damageBonus(actor) !== 0) spendToken(actor, tok(actor, "strength") > 0 ? "strength" : "weak");
        const pierce = !!op.pierce || (!!actor.flags?.pierceAtLowHp && actor.hp <= 1);
        const dealt = dealDamage(s, tgt, dmg, (op.damageType as DamageType) ?? "physical",
          { pierce, obliterate: actor.flags?.obliterateOnSlay });
        log(s, { side: actor.owner, actor: actor.name, dice, text: `${actor.name} hits ${tgt.name} for ${dealt} (rolled ${value} vs ${tgt.df}+).` });
      } else {
        // graze: 1 damage, inherits type only
        const dealt = dealDamage(s, tgt, 1, (op.damageType as DamageType) ?? "physical");
        log(s, { side: actor.owner, actor: actor.name, dice, text: `${actor.name} grazes ${tgt.name} for ${dealt} (rolled ${value} vs ${tgt.df}+).` });
      }
      break;
    }
    case "damage": {
      const tgt = pickTarget(ctx, op.target as string);
      if (!tgt) return;
      const dealt = dealDamage(s, tgt, (op.damage as number) ?? 0, (op.damageType as DamageType) ?? "physical",
        { pierce: !!op.pierce, cannotSlay: !!op.cannotSlay });
      log(s, { side: actor.owner, actor: actor.name, text: `${actor.name} deals ${dealt} to ${tgt.name}.` });
      break;
    }
    case "token": {
      const tgt = pickTarget(ctx, op.target as string);
      if (!tgt) return;
      addToken(tgt, op.token as TokenType, (op.n as number) ?? 1);
      log(s, { side: actor.owner, actor: actor.name, text: `${tgt.name} gains ${op.n ?? 1} ${op.token}.` });
      break;
    }
    case "push": applyShove(ctx, op, +1); break;
    case "pull": applyShove(ctx, op, -1); break;
    case "effectDie": {
      const roll = rollD6(s.rng);
      log(s, { side: actor.owner, actor: actor.name, dice: [roll], text: `Effect die: ${roll} (needs ${op.threshold}+).` });
      if (roll >= (op.threshold as number)) resolveEffects(ctx, op.then as EffectOp[]);
      break;
    }
    case "onHit": if (ctx.hit) resolveEffects(ctx, op.then as EffectOp[]); break;
    case "onHeadshot": if (ctx.lastRoll === 6) resolveEffects(ctx, op.then as EffectOp[]); break;
    case "reload": {
      const who = op.target === "ally" ? ctx.target : actor;
      if (who) for (const k of Object.keys(who.reloaded)) who.reloaded[k] = true;
      break;
    }
    case "clearNegativeTokens": {
      const tgt = pickTarget(ctx, (op.target as string) ?? "self");
      if (tgt) for (const t of ["weak", "vulnerable", "slow"] as TokenType[]) tgt.tokens[t] = 0;
      break;
    }
    case "obliterateSelf": obliterate(s, actor); break;
    case "step": {
      // simplest faithful step: toward nothing specific is a no-op here; movement
      // steps are handled by move actions. Logged for the battle log.
      log(s, { side: actor.owner, actor: actor.name, text: `${actor.name} steps.` });
      break;
    }
    case "splash": {
      const center = op.center === "self" ? actor.pos : ctx.target?.pos;
      if (!center) break;
      for (const u of s.units) {
        if (u.alive && adjacent(u.pos, center) && u.iid !== ctx.target?.iid) {
          resolveEffects({ ...ctx, target: u }, op.then as EffectOp[]);
        }
      }
      break;
    }
    default:
      // Unknown op: carry it in the log so the faithful intent is visible.
      log(s, { side: actor.owner, actor: actor.name, text: `${actor.name}: ${op.op} (not simulated yet).` });
  }
}

function pickTarget(ctx: Ctx, which: string | undefined): Unit | undefined {
  switch (which) {
    case "self": return ctx.actor;
    case "hit": case "choose": case undefined: return ctx.target;
    default: return ctx.target;
  }
}

function applyShove(ctx: Ctx, op: EffectOp, sign: number) {
  const { s, actor } = ctx;
  const tgt = pickTarget(ctx, op.target as string);
  if (!tgt) return;
  if (tgt.flags?.immunePush) {
    log(s, { side: actor.owner, actor: actor.name, text: `${tgt.name} resists forced movement.` });
    return;
  }
  const n = (op.n as number) ?? 1;
  // push: away from actor; pull: toward actor. Orthogonal, one axis (the larger).
  const dx = Math.sign(tgt.pos.x - actor.pos.x) * sign;
  const dy = Math.sign(tgt.pos.y - actor.pos.y) * sign;
  let moved = 0;
  for (let i = 0; i < n; i++) {
    const step = Math.abs(tgt.pos.x - actor.pos.x) >= Math.abs(tgt.pos.y - actor.pos.y)
      ? { x: tgt.pos.x + dx, y: tgt.pos.y } : { x: tgt.pos.x, y: tgt.pos.y + dy };
    if (!inBounds(step) || unitAt(s, step)) break;
    tgt.pos = step;
    moved++;
  }
  if (moved) log(s, { side: actor.owner, actor: actor.name, text: `${tgt.name} is ${sign > 0 ? "pushed" : "pulled"} ${moved}.` });
}

// ---------- game setup ----------

export interface LoadoutEntry { defId: string }
export interface Loadout {
  userId: number;
  house: string;
  colour: string;
  units: LoadoutEntry[];                 // roster unit defIds to field (necromancer auto-added)
  upgrades?: Record<string, string>;     // unit defId -> chosen upgrade name
}

let iidCounter = 0;
function makeUnit(owner: 0 | 1, house: string, defId: string, upgrade?: string): Unit {
  const f = faction(house);
  const def = [f.necromancer, ...f.units].find((d) => d.id === defId)!;
  const u: Unit = {
    iid: `${owner}-${defId}-${iidCounter++}`,
    owner, house, defId,
    name: def.name, type: def.type, art: def.art,
    mv: def.mv, hp: def.hp, maxHp: def.hp, df: def.df, arm: def.arm,
    large: !!def.large,
    pos: { x: -1, y: -1 },
    tokens: {},
    // deep-copy abilities so an upgrade patch on one unit can't leak to the shared def
    acts: def.acts.map((a) => ({ ...a, effect: a.effect ? JSON.parse(JSON.stringify(a.effect)) : undefined })),
    reloaded: Object.fromEntries(def.acts.filter((a) => a.tags.includes("reload")).map((a) => [a.name, true])),
    activatedThisRound: false,
    alive: true,
    isNecromancer: def.type === "necromancer",
  };
  if (upgrade) applyUpgrade(u, upgrade);
  return u;
}

// Generate battlefield terrain in the middle rows (never the deploy zones), the
// scenario-style mix the rulebook recommends: a couple of walls, an elevated
// plateau reached by stairs, a hazard patch, and some adverse terrain. Seeded, so
// it's part of the authoritative, persisted state.
function generateTerrain(s: GameState): void {
  const n = s.mapSize;
  const lo = 2, hi = n - 3;                     // middle band, clear of deploy rows
  const set = (x: number, y: number, c: TerrainCell) => {
    if (x < 0 || y < 0 || x >= n || y >= n) return;
    s.terrain[key({ x, y })] = { ...s.terrain[key({ x, y })], ...c };
  };
  const pick = () => ({ x: lo + Math.floor(rollD6(s.rng) / 6 * (hi - lo + 1)) % (hi - lo + 1),
                        y: lo + Math.floor(rollD6(s.rng) / 6 * (hi - lo + 1)) % (hi - lo + 1) });
  // a 2x2 elevated plateau with a stair tile
  const p = pick();
  set(p.x, p.y, { elevated: true }); set(p.x + 1, p.y, { elevated: true });
  set(p.x, p.y + 1, { elevated: true, stairs: true }); set(p.x + 1, p.y + 1, { elevated: true });
  // a short wall line (cover + LoS block)
  const w = pick();
  for (let i = 0; i < 2 + (rollD6(s.rng) % 2); i++) set(w.x + i, w.y, { wall: { hp: 2 } });
  // a hazard patch
  const h = pick(); set(h.x, h.y, { hazard: true }); set(h.x + 1, h.y, { hazard: true });
  // adverse terrain
  const a = pick(); set(a.x, a.y, { adverse: true }); set(a.x, a.y + 1, { adverse: true });
}

// Create a game from two loadouts. `seed` makes dice deterministic; `firstSide`
// is the initiative winner (rolled by the caller/lobby).
export function createGame(a: Loadout, b: Loadout, seed: number, firstSide: 0 | 1 = 0): GameState {
  iidCounter = 0;
  const mk = (l: Loadout, owner: 0 | 1): Unit[] =>
    [makeUnit(owner, l.house, faction(l.house).necromancer.id),
     ...l.units.map((u) => makeUnit(owner, l.house, u.defId, l.upgrades?.[u.defId]))];
  const players: [SidePlayer, SidePlayer] = [
    { userId: a.userId, house: a.house, colour: a.colour, soul: 0, deployed: false, firstSlainTaken: false },
    { userId: b.userId, house: b.house, colour: b.colour, soul: 0, deployed: false, firstSlainTaken: false },
  ];
  const s: GameState = {
    version: 1, mapSize: MAP_SIZE, phase: "deploy", round: 1,
    activeSide: firstSide, firstSide,
    players,
    units: [...mk(a, 0), ...mk(b, 1)],
    terrain: {},
    rng: makeRng(seed),
    log: [{ round: 1, side: null, actor: "system", text: "The battle begins. Deploy your Black Mass." }],
    winner: null, soulUsedThisTurn: false,
  };
  generateTerrain(s);
  return s;
}

// Default deploy: rows nearest each side's edge. side 0 at y=0..1, side 1 at y=n-1..n-2.
export function autoDeploy(s: GameState) {
  for (const side of [0, 1] as const) {
    const mine = s.units.filter((u) => u.owner === side);
    let i = 0;
    for (const u of mine) {
      const row = side === 0 ? (i < s.mapSize ? 0 : 1) : (i < s.mapSize ? s.mapSize - 1 : s.mapSize - 2);
      const col = i % s.mapSize;
      u.pos = { x: col, y: row };
      i++;
    }
    s.players[side].deployed = true;
  }
  s.phase = "playing";
  log(s, { side: null, actor: "system", text: "Both sides deployed. Fight!" });
}

// ---------- turn flow ----------

function endTurn(s: GameState) {
  s.soulUsedThisTurn = false;
  // round advances once everyone has activated
  const allDone = s.units.filter((u) => u.alive).every((u) => u.activatedThisRound);
  if (allDone) {
    s.round += 1;
    for (const u of s.units) { u.activatedThisRound = false; }
    // SOUL Gather from round 2
    if (s.round >= 2) for (const p of s.players) p.soul = Math.min(RULES_SOUL_MAX, p.soul + 1);
    s.activeSide = s.firstSide;
    if (s.round > MAX_ROUNDS && s.winner === null) {
      s.phase = "over";
      log(s, { side: null, actor: "system", text: "Round 6 ends with both necromancers alive — a draw." });
    } else {
      log(s, { side: null, actor: "system", text: `Round ${s.round}.` });
    }
  } else {
    s.activeSide = other(s.activeSide);
    // skip a side with no un-activated units
    if (s.units.filter((u) => u.alive && u.owner === s.activeSide).every((u) => u.activatedThisRound)) {
      s.activeSide = other(s.activeSide);
    }
  }
}

// ---------- public action entry ----------

export interface ApplyResult { ok: boolean; error?: string; state: GameState }

// Validate + apply one action for `side`. Server-authoritative: rejects acting
// out of turn, on another side's units, or illegal moves.
export function applyAction(s: GameState, side: 0 | 1, action: Action): ApplyResult {
  if (s.phase === "over") return { ok: false, error: "game is over", state: s };

  if (action.kind === "deploy") {
    // v1 uses autoDeploy; manual deploy accepted but validated minimally.
    if (s.phase !== "deploy") return { ok: false, error: "not in deploy phase", state: s };
    for (const pl of action.placements) {
      const u = unit(s, pl.iid);
      if (!u || u.owner !== side) return { ok: false, error: "not your unit", state: s };
      if (!inBounds(pl.pos)) return { ok: false, error: "out of bounds", state: s };
      u.pos = pl.pos;
    }
    s.players[side].deployed = true;
    if (s.players[0].deployed && s.players[1].deployed) { s.phase = "playing"; }
    return { ok: true, state: s };
  }

  if (s.phase !== "playing") return { ok: false, error: "not playing", state: s };
  if (side !== s.activeSide) return { ok: false, error: "not your turn", state: s };

  switch (action.kind) {
    case "move": {
      const u = unit(s, action.iid);
      if (!u || !u.alive) return { ok: false, error: "no such unit", state: s };
      if (u.owner !== side) return { ok: false, error: "not your unit", state: s };
      if (u.activatedThisRound) return { ok: false, error: "already activated", state: s };
      const canReach = reachable(s, u, moveBudget(u)).some((p) => p.x === action.to.x && p.y === action.to.y);
      if (!canReach) return { ok: false, error: "can't reach there", state: s };
      u.pos = action.to;
      if (tok(u, "slow") > 0) spendToken(u, "slow");
      if (tok(u, "speed") > 0) spendToken(u, "speed");
      log(s, { side, actor: u.name, text: `${u.name} moves to (${action.to.x},${action.to.y}).` });
      // entering a hazard deals 1 damage, ignoring armor
      if (terrainAt(s, u.pos)?.hazard) {
        const dealt = dealDamage(s, u, 1, "physical", { pierce: true });
        if (dealt) log(s, { side: null, actor: u.name, text: `${u.name} takes ${dealt} from a hazard.` });
      }
      u.activatedThisRound = true;
      endTurn(s);
      return { ok: true, state: s };
    }
    case "act": {
      const u = unit(s, action.iid);
      if (!u || !u.alive) return { ok: false, error: "no such unit", state: s };
      if (u.owner !== side) return { ok: false, error: "not your unit", state: s };
      if (u.activatedThisRound) return { ok: false, error: "already activated", state: s };
      const ability = u.acts.find((a) => a.name === action.ability);
      if (!ability) return { ok: false, error: "no such ability", state: s };
      if (ability.tags.includes("reload") && u.reloaded[ability.name] === false) {
        return { ok: false, error: "needs reload", state: s };
      }
      const err = validateAndResolveAct(s, u, ability, action.target);
      if (err) return { ok: false, error: err, state: s };
      if (ability.tags.includes("reload")) u.reloaded[ability.name] = false;
      u.activatedThisRound = true;
      endTurn(s);
      return { ok: true, state: s };
    }
    case "endTurn": {
      // pass: the active side forfeits remaining activations this cycle
      const next = s.units.find((u) => u.alive && u.owner === side && !u.activatedThisRound);
      if (next) next.activatedThisRound = true;
      endTurn(s);
      return { ok: true, state: s };
    }
    default:
      return { ok: false, error: "unknown action", state: s };
  }
}

function validateAndResolveAct(s: GameState, u: Unit, ability: Ability, target?: Pos | string): string | undefined {
  let tgtUnit: Unit | undefined;
  const needsTarget = ability.tags.includes("attack") || ability.tags.includes("curse") ||
    ability.tags.includes("pull") || (ability.range && ability.range !== "self");
  if (needsTarget) {
    if (!target || typeof target === "string") return "target required";
    tgtUnit = unitAt(s, target);
    if (!tgtUnit) return "no unit there";
    // range / melee check
    if (ability.range === "melee" || ability.tags.includes("melee")) {
      if (!adjacent(u.pos, tgtUnit.pos)) return "target not adjacent";
    } else if (Array.isArray(ability.range)) {
      const [min, max] = ability.range;
      const dist = chebyshev(u.pos, tgtUnit.pos);
      if (dist < min || dist > max) return "target out of range";
    }
  }
  resolveEffects({ s, actor: u, target: tgtUnit }, ability.effect);
  if (!ability.effect || ability.effect.length === 0) {
    log(s, { side: u.owner, actor: u.name, text: `${u.name} uses ${ability.name}.` });
  }
  return undefined;
}

// Filter state for a viewer (Maleghast is open information, so we send the whole
// board; this hook exists for future fog and to strip the rng internals).
export function viewFor(s: GameState, _userId: number | null): GameState {
  return { ...s, rng: { seed: 0, count: s.rng.count } as Rng };
}
