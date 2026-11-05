// The game engine: pure, server-authoritative functions over GameState.
// Clients never decide outcomes — the server rolls (seeded PRNG in state),
// resolves, logs, and persists. Faithful to data/rules.json; the effect-op
// interpreter runs what it understands and logs the rest.

import type {
  Ability, Action, Armor, DamageType, EffectOp, GameState, LogEntry, Pos,
  SidePlayer, TerrainCell, TokenType, Unit,
} from "./types.ts";
import { makeRng, rollD6, rollPool, type Rng } from "./prng.ts";
import { allUnitDefs, faction, MAP_SIZE, MAX_ROUNDS, RULES } from "./data.ts";
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

// Miracle (data/factions/abhorrers.json specialMechanic): a unit affected by a
// Miracle has a 5+ effect chance to instantly return to life at 1 hp at the end
// of any turn it is slain, clearing all tokens. "End of any turn" (not
// immediately) needs a pending-revive subsystem the engine doesn't have, so this
// checks the miracle flag and rolls right when the unit would be slain — close
// enough to "its own slaying turn" for the common case (a unit dying on the
// attacker's turn), but a miracle unit slain earlier in a round that *could*
// still revive "at the end of any turn" before its own next activation isn't
// retried later. Not silently dropped — see the comment atop upgrades.ts.
function slay(s: GameState, u: Unit) {
  if (u.flags?.miracle) {
    const roll = rollD6(s.rng);
    if (roll >= 5) {
      u.hp = 1;
      u.tokens = {};
      log(s, { side: null, actor: u.name, dice: [roll], text: `${u.name}'s Miracle triggers (rolled ${roll}) — returns to life at 1 hp.` });
      return;
    }
    log(s, { side: null, actor: u.name, dice: [roll], text: `${u.name}'s Miracle fails (rolled ${roll}).` });
  }
  u.hp = 0;
  u.alive = false;
  s.corpses.push({ x: u.pos.x, y: u.pos.y });   // a slain unit leaves a corpse marker
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

// Berserk (data/factions/goregrinders.json specialTags.Berserk): after a berserk
// unit ACTs, it splashes (self) 1 damage, then discards a berserk token. If that
// splash damages no other character, it deals 1 to itself instead, ignoring
// armor. Runs after any ACT, not just abilities that grant berserk themselves.
function applyBerserkAfterAct(s: GameState, u: Unit) {
  if (!u.alive || tok(u, "berserk") <= 0) return;
  let anyDamaged = false;
  for (const o of s.units) {
    if (o.iid === u.iid || !o.alive || !adjacent(o.pos, u.pos)) continue;
    const dealt = dealDamage(s, o, 1, "physical");
    if (dealt > 0) {
      anyDamaged = true;
      log(s, { side: u.owner, actor: u.name, text: `${u.name}'s berserk rage splashes ${o.name} for ${dealt}.` });
    }
  }
  spendToken(u, "berserk");
  if (!anyDamaged && u.alive) {
    const dealt = dealDamage(s, u, 1, "physical", { pierce: true });
    if (dealt > 0) log(s, { side: u.owner, actor: u.name, text: `${u.name}'s unspent rage turns inward for ${dealt}.` });
  }
}

// Plague (data/factions/gargamox.json specialMechanic): a unit affected by
// plague takes 1 toxic damage at the end of its turn, then discards a plague
// token. The rulebook says that damage "can't be reduced or ignored by any
// means" — the same strength of wording used for devil damage — so this
// bypasses armor *and* vitality/vulnerable, floored at 1 hp (cannotSlay).
// Gargamox units don't take plague damage or remove plague tokens (they're the
// ones spreading it). Runs at the end of every unit's own activation (move,
// act, or a forfeited/"pass" turn) — the rulebook's "end of its turn", not end
// of round.
function applyPlagueAfterTurn(s: GameState, u: Unit) {
  if (!u.alive || tok(u, "plague") <= 0 || u.house === "gargamox") return;
  const dealt = Math.min(1, Math.max(0, u.hp - 1));
  u.hp -= dealt;
  spendToken(u, "plague");
  if (dealt > 0) log(s, { side: null, actor: u.name, text: `${u.name}'s plague festers for ${dealt}.` });
}

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

// The units an ability could legally target right now (for the client to
// highlight on the board). Range/melee is enforced here; the server still
// re-validates on use.
export function legalTargets(s: GameState, iid: string, abilityName: string): { iid: string; pos: Pos }[] {
  const u = unit(s, iid);
  if (!u || !u.alive || u.activatedThisRound || s.phase !== "playing") return [];
  const ab = u.acts.find((a) => a.name === abilityName);
  if (!ab) return [];
  const melee = ab.range === "melee" || ab.tags.includes("melee");
  const band = Array.isArray(ab.range) ? ab.range : null;
  const needsTarget = melee || band || ab.tags.includes("attack") || ab.tags.includes("curse") || ab.tags.includes("pull");
  if (!needsTarget) return [];                        // self / no-target ability
  const ally = wantsAlly(ab);
  const out: { iid: string; pos: Pos }[] = [];
  for (const o of s.units) {
    if (!o.alive || o.iid === u.iid) continue;
    if (ally ? o.owner !== u.owner : o.owner === u.owner) continue;
    const d = chebyshev(u.pos, o.pos);
    if (melee ? d === 1 : band ? d >= band[0] && d <= band[1] : true) out.push({ iid: o.iid, pos: o.pos });
  }
  return out;
}

// The tiles/units a SOUL ability could legally target right now, for the
// client to highlight. SOUL has no acting unit (it's cast by whichever side
// owns the necromancer, not tied to one unit's activation like legalTargets),
// so this takes `side` instead of an `iid`. "area" abilities (Soulfeed, Slime
// Form) and tile-targeted ones (Cyclopean Monolith) are handled distinctly
// from the ordinary unit-target case ACT abilities use.
export function legalSoulTargets(s: GameState, side: 0 | 1, abilityName: string): { iid?: string; pos: Pos }[] {
  if (s.phase !== "playing") return [];
  const nec = s.units.find((u) => u.owner === side && u.isNecromancer && u.alive);
  if (!nec) return [];
  const ab = (faction(nec.house).necromancer.souls ?? []).find((a) => a.name === abilityName);
  if (!ab || UNIMPLEMENTED_SOULS.has(ab.name) || ab.tags.includes("area")) return [];
  const band = Array.isArray(ab.range) ? ab.range : null;
  if (!band && ab.range !== "melee") return [];   // self / no-target ability
  if (ab.tags.includes("tile")) {
    const out: { pos: Pos }[] = [];
    for (let x = 0; x < s.mapSize; x++) for (let y = 0; y < s.mapSize; y++) {
      const p = { x, y };
      const d = chebyshev(nec.pos, p);
      if (band && (d < band[0] || d > band[1])) continue;
      if (unitAt(s, p) || isWall(s, p)) continue;
      out.push({ pos: p });
    }
    return out;
  }
  const ally = wantsAlly(ab);
  const out: { iid: string; pos: Pos }[] = [];
  for (const o of s.units) {
    if (!o.alive) continue;
    if (ally ? o.owner !== nec.owner : o.owner === nec.owner) continue;
    const d = chebyshev(nec.pos, o.pos);
    if (ab.range === "melee" ? d === 1 : band ? d >= band[0] && d <= band[1] : true) out.push({ iid: o.iid, pos: o.pos });
  }
  return out;
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
  range?: [number, number] | "melee" | "self";   // the ability's declared range, for otherFoeInRange
  pos?: Pos;           // a raw tile target (e.g. wall placement), distinct from a unit target
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
    // Wild Mutation (igorri SOUL, 1): "gains 1 strength, (3-4) or 1 speed,
    // (5-6) or 1 vitality" — a single roll into exactly one of several
    // mutually-exclusive buckets (effectDie's cascading thresholds can't
    // express "roll once, pick ONE branch").
    case "tieredRoll": {
      const roll = rollD6(s.rng);
      log(s, { side: actor.owner, actor: actor.name, dice: [roll], text: `Roll: ${roll}.` });
      const tiers = op.tiers as { max: number; then: EffectOp[] }[];
      const tier = tiers.find((t) => roll <= t.max);
      if (tier) resolveEffects(ctx, tier.then);
      break;
    }
    case "onHit": if (ctx.hit) resolveEffects(ctx, op.then as EffectOp[]); break;
    case "onHeadshot": if (ctx.lastRoll === 6) resolveEffects(ctx, op.then as EffectOp[]); break;
    // Stance (abhorrers.json specialTags.Stance): "an ability with stance gains
    // different effects on odd, even, or special numbered rounds." This covers
    // the common odd/even branch (e.g. Excoriate); the "special numbered round"
    // variant some upgrades add on top (Taste the Lash's "round 4+: both",
    // Witness's "round 4+: 2 holy instead", Punisher/Heart Destroyer's "round
    // 3+: obliterate") is a per-ability override of this base branch that the
    // upgrade handlers don't model — see upgrades.ts header comment.
    case "stance": {
      const branch = s.round % 2 === 1 ? (op.odd as EffectOp[] | undefined) : (op.even as EffectOp[] | undefined);
      resolveEffects(ctx, branch);
      break;
    }
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
    // Cyclopean Monolith (deadsouls SOUL, 1): "Create a wall in range and
    // inflict 1 weak on an adjacent foe to the wall."
    case "wall": {
      if (!ctx.pos) break;
      s.terrain[key(ctx.pos)] = { ...s.terrain[key(ctx.pos)], wall: { hp: 2 } };
      log(s, { side: actor.owner, actor: actor.name, text: `${actor.name} raises a wall at (${ctx.pos.x},${ctx.pos.y}).` });
      const foe = s.units.find((o) => o.alive && o.owner !== actor.owner && adjacent(o.pos, ctx.pos!));
      if (foe) resolveEffects({ ...ctx, target: foe }, op.then as EffectOp[]);
      break;
    }
    // Glory Kill (goregrinders SOUL, 3): "Obliterate an adjacent unit at 1 hp
    // or lower."
    case "obliterateAdjacentLowHp": {
      const tgt = ctx.target;
      if (!tgt || tgt.hp > 1) break;
      obliterate(s, tgt);
      break;
    }
    // Soulfeed (deadsouls SOUL, 3): "All isolated or doomed foes in range take
    // 1 curse damage, gain 1 weak, and this unit gains 1 strength for each."
    case "isolatedOrDoomedInRange": {
      const band = Array.isArray(ctx.range) ? ctx.range : null;
      let count = 0;
      for (const o of s.units) {
        if (!o.alive || o.owner === actor.owner) continue;
        const d = chebyshev(actor.pos, o.pos);
        if (band && (d < band[0] || d > band[1])) continue;
        if (!isIsolated(s, o) && tok(o, "doom") <= 0) continue;
        count++;
        resolveEffects({ ...ctx, target: o }, op.then as EffectOp[]);
      }
      if (count > 0) addToken(actor, "strength", count);
      break;
    }
    // Slime Form (gargamox SOUL, 3): "push or pull all units in range 2 one
    // (5+) two spaces." (the free "MOVE through walls/units" half is logged
    // only, like the "step" op above — partial fidelity, not a new
    // sub-engine for ignoring collision during a single free move. Pushed,
    // not pulled, as the simpler faithful reading of "push or pull" with no
    // per-unit choice modeled.)
    case "pushPullAllInRange": {
      const n = (op.n as number) ?? 1;
      const range = (op.range as number) ?? 2;
      for (const o of s.units) {
        if (!o.alive || o.iid === actor.iid || chebyshev(actor.pos, o.pos) > range) continue;
        applyShove({ ...ctx, target: o }, { op: "push", n }, +1);
      }
      break;
    }
    default:
      // Unknown op: carry it in the log so the faithful intent is visible.
      log(s, { side: actor.owner, actor: actor.name, text: `${actor.name}: ${op.op} (not simulated yet).` });
  }
}

// Does this ability's effect graph ever target "ally"? Everything else in the
// data (hit/choose/adjacentFoe/otherAdjacent/otherFoeInRange) always means an
// opponent's unit in this ruleset — there's no "any unit regardless of side"
// label, so this one check is enough to tell a support ability from an attack.
function wantsAlly(ability: Ability): boolean {
  const scan = (ops: EffectOp[] | undefined): boolean =>
    !!ops?.some((op) => {
      if (op.target === "ally") return true;
      if (scan(op.then as EffectOp[] | undefined)) return true;
      const tiers = op.tiers as { then: EffectOp[] }[] | undefined;
      return !!tiers?.some((t) => scan(t.then));
    });
  return scan(ability.effect);
}

// Isolation (data/raw/page-25.txt specialTag): a unit with no allies adjacent.
function isIsolated(s: GameState, u: Unit): boolean {
  return !s.units.some((o) => o.alive && o.iid !== u.iid && o.owner === u.owner && adjacent(o.pos, u.pos));
}

function pickTarget(ctx: Ctx, which: string | undefined): Unit | undefined {
  const { s, actor } = ctx;
  switch (which) {
    case "self": return ctx.actor;
    case "ally": case "hit": case "choose": case undefined: return ctx.target;
    case "adjacentFoe":
      return s.units.find((o) => o.alive && o.owner !== actor.owner && adjacent(o.pos, actor.pos));
    case "otherAdjacent": {
      const primary = ctx.target;
      if (!primary) return undefined;
      return s.units.find((o) => o.alive && o.iid !== primary.iid && o.owner !== actor.owner && adjacent(o.pos, primary.pos));
    }
    case "otherFoeInRange": {
      const primary = ctx.target;
      const band = Array.isArray(ctx.range) ? ctx.range : null;
      return s.units.find((o) => {
        if (!o.alive || o.owner === actor.owner || o.iid === primary?.iid) return false;
        const d = chebyshev(actor.pos, o.pos);
        return band ? d >= band[0] && d <= band[1] : true;
      });
    }
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
    souls: def.souls ? def.souls.map((a) => ({ ...a })) : undefined,
    reloaded: Object.fromEntries(def.acts.filter((a) => a.tags.includes("reload")).map((a) => [a.name, true])),
    activatedThisRound: false,
    alive: true,
    isNecromancer: def.type === "necromancer",
  };
  // Miracle (data/factions/abhorrers.json specialMechanic): units with a trait
  // literally named "Miracle" get the revive-on-slay flag (see slay()). Units
  // that explicitly lack it (e.g. "Holy Vessel", "Miraculous Flesh") are
  // unaffected — they don't carry that trait name.
  if (def.traits.some((t) => t.name === "Miracle")) u.flags = { ...u.flags, miracle: true };
  // Mutation (data/factions/igorri.json specialTags.Mutate): "Warpflesh" starts
  // combat with 4 mutation tokens. The tokens themselves are generic (TokenType
  // "mutation") and granted elsewhere via the normal `token` effect op; this is
  // the one static starting grant named in the data.
  if (def.traits.some((t) => t.name === "Warpflesh")) u.tokens.mutation = 4;
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
    corpses: [],
    rng: makeRng(seed),
    log: [{ round: 1, side: null, actor: "system", text: "The battle begins. Deploy your Black Mass." }],
    winner: null, soulUsedThisTurn: [false, false],
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

// Doom (data/factions/deadsouls.json specialMechanic): any unit with at least one
// Doom token takes 4 devil damage at the end of round 4. Devil damage can't be
// reduced, increased or ignored (dealDamage handles that), and can obliterate.
// Clearing a Doom token by slaying another unit needs attacker-vs-victim tracking
// the engine doesn't have yet, so Doom only accumulates today — it never clears
// early. That's the honest remainder, not silently dropped (PROCESS.md).
function applyDoomAtEndOfRound(s: GameState) {
  if (s.round !== 4) return;
  for (const u of s.units) {
    if (u.alive && tok(u, "doom") > 0) {
      dealDamage(s, u, 4, "devil");
      log(s, { side: null, actor: u.name, text: `${u.name}'s Doom comes due: 4 devil damage.` });
    }
  }
}

function endTurn(s: GameState) {
  // "one SOUL ability per unit turn" resets at every unit activation boundary —
  // this runs once per move/act/endTurn, i.e. once per "unit turn" — for BOTH
  // sides, since either side may use a SOUL ability triggered by any single
  // unit's activation (data/raw/page-13/14.txt).
  s.soulUsedThisTurn = [false, false];
  // round advances once everyone has activated
  const allDone = s.units.filter((u) => u.alive).every((u) => u.activatedThisRound);
  if (allDone) {
    applyDoomAtEndOfRound(s);
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
    if (s.phase !== "deploy") return { ok: false, error: "not in deploy phase", state: s };
    // data/rules.json deployFromEdgeSpaces: each side may only deploy within N
    // rows of its own board edge. Side 0's edge is y=0 (rows [0, N-1]); side 1's
    // edge is y=mapSize-1 (rows [mapSize-N, mapSize-1]).
    const edge = RULES.mode.deployFromEdgeSpaces as number;
    const inEdgeBand = (p: Pos) => side === 0 ? p.y >= 0 && p.y < edge : p.y >= s.mapSize - edge && p.y < s.mapSize;
    // Validate the whole batch atomically: resolve every target position first,
    // check it against bounds/edge-band/other-targets-in-this-batch/already-
    // placed units, and only mutate state once the whole batch is legal.
    const resolved: { u: Unit; pos: Pos }[] = [];
    for (const pl of action.placements) {
      const u = unit(s, pl.iid);
      if (!u || u.owner !== side) return { ok: false, error: "not your unit", state: s };
      if (!inBounds(pl.pos)) return { ok: false, error: "out of bounds", state: s };
      if (!inEdgeBand(pl.pos)) return { ok: false, error: "must deploy within your edge zone", state: s };
      resolved.push({ u, pos: pl.pos });
    }
    const occupied = new Set(
      s.units.filter((u) => u.pos.x >= 0 && !resolved.some((r) => r.u.iid === u.iid))
        .map((u) => key(u.pos)),
    );
    for (const { pos } of resolved) {
      const k = key(pos);
      if (occupied.has(k)) return { ok: false, error: "space already occupied", state: s };
      occupied.add(k);
    }
    for (const { u, pos } of resolved) u.pos = pos;
    // deployed flips once every one of this side's units has a real position —
    // deployment can be incremental (one placements batch per unit, or all at
    // once), so this isn't set unconditionally after any deploy action.
    s.players[side].deployed = s.units.filter((u) => u.owner === side).every((u) => u.pos.x >= 0);
    if (s.players[0].deployed && s.players[1].deployed) {
      s.phase = "playing";
      log(s, { side: null, actor: "system", text: "Both sides deployed. Fight!" });
    }
    return { ok: true, state: s };
  }

  if (s.phase !== "playing") return { ok: false, error: "not playing", state: s };

  // SOUL abilities don't consume a unit's activation and can be used on
  // either side's turn, even the opponent's (data/raw/page-13/14.txt), so
  // this runs before the turn gate below rather than inside the switch.
  if (action.kind === "soul") {
    const p = s.players[side];
    const nec = s.units.find((u) => u.owner === side && u.isNecromancer && u.alive);
    if (!nec) return { ok: false, error: "necromancer down", state: s };
    const ability = (faction(nec.house).necromancer.souls ?? []).find((a) => a.name === action.ability);
    if (!ability) return { ok: false, error: "no such soul ability", state: s };
    if (UNIMPLEMENTED_SOULS.has(ability.name)) return { ok: false, error: "not yet implemented", state: s };
    if (s.soulUsedThisTurn[side]) return { ok: false, error: "already used a soul ability this turn", state: s };
    if (p.soul < (ability.soul ?? 0)) return { ok: false, error: "not enough soul", state: s };
    const err = validateAndResolveSoul(s, nec, ability, action.target);
    if (err) return { ok: false, error: err, state: s };
    p.soul -= ability.soul ?? 0;
    s.soulUsedThisTurn[side] = true;
    return { ok: true, state: s };
  }

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
      applyPlagueAfterTurn(s, u);
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
      applyBerserkAfterAct(s, u);
      applyPlagueAfterTurn(s, u);
      u.activatedThisRound = true;
      endTurn(s);
      return { ok: true, state: s };
    }
    case "endTurn": {
      // pass: the active side forfeits remaining activations this cycle
      const next = s.units.find((u) => u.alive && u.owner === side && !u.activatedThisRound);
      if (next) { applyPlagueAfterTurn(s, next); next.activatedThisRound = true; }
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
    // ownership check — a raw {x,y} POST must respect the same ally/foe
    // restriction legalTargets already filters on, not just range/adjacency.
    const ally = wantsAlly(ability);
    if (ally ? tgtUnit.owner !== u.owner : tgtUnit.owner === u.owner) return "wrong target";
  }
  resolveEffects({ s, actor: u, target: tgtUnit, range: ability.range }, ability.effect);
  if (!ability.effect || ability.effect.length === 0) {
    log(s, { side: u.owner, actor: u.name, text: `${u.name} uses ${ability.name}.` });
  }
  return undefined;
}

// SOUL abilities (data/raw/page-13/14.txt): necromancer-only, cost SOUL instead
// of an ACT slot, and can be cast any time on either side's turn (handled by
// applyAction's early "soul" branch, before the turn gate). Ten of the twelve
// abilities (two per House) are implemented below with real effect[] data
// (data/factions/*.json) running through the same resolveEffects/resolveOp
// interpreter ACT abilities use. Two are an honest remainder, not silently
// dropped:
//   - Will of God (abhorrers): "treat the current round as either 2 or 5"
//     needs a per-unit effective-round override threaded through every
//     round-dependent check (Stance's odd/even branch, Doom's round-4 timer)
//     without mutating shared state — the engine has no such hook.
//   - Sample Genome (igorri): "copy all positive tokens from one unit, then
//     grant them to another" needs a two-target selection flow; `Action`'s
//     `target` is a single `Pos | string`, not a pair.
// Submitting either returns a clear "not yet implemented" error rather than
// silently no-opping.
const UNIMPLEMENTED_SOULS = new Set(["Will of God", "Sample Genome"]);

function validateAndResolveSoul(s: GameState, nec: Unit, ability: Ability, target?: Pos | string): string | undefined {
  let tgtUnit: Unit | undefined;
  let tgtPos: Pos | undefined;
  // "area" abilities (Soulfeed, Slime Form) act on everything in range of the
  // necromancer itself — no single target to pick, so they skip this block
  // entirely even though they carry a range (used by isolatedOrDoomedInRange/
  // pushPullAllInRange to size the AoE from the actor's own position).
  const isArea = ability.tags.includes("area");
  const needsTarget = !isArea && (Array.isArray(ability.range) || ability.range === "melee");
  // Cyclopean Monolith targets an empty battlefield tile (to place a wall),
  // not a unit — the one soul ability whose target is a position, not a unit.
  const targetsTile = ability.tags.includes("tile");
  if (needsTarget) {
    if (!target || typeof target === "string") return "target required";
    if (ability.range === "melee") {
      if (!adjacent(nec.pos, target)) return "target not adjacent";
    } else {
      const [min, max] = ability.range as [number, number];
      const dist = chebyshev(nec.pos, target);
      if (dist < min || dist > max) return "target out of range";
    }
    if (targetsTile) {
      if (!inBounds(target) || unitAt(s, target) || isWall(s, target)) return "tile not free";
      tgtPos = target;
    } else {
      tgtUnit = unitAt(s, target);
      if (!tgtUnit) return "no unit there";
      const ally = wantsAlly(ability);
      if (ally ? tgtUnit.owner !== nec.owner : tgtUnit.owner === nec.owner) return "wrong target";
    }
  }
  resolveEffects({ s, actor: nec, target: tgtUnit, range: ability.range, pos: tgtPos }, ability.effect);
  if (!ability.effect || ability.effect.length === 0) {
    log(s, { side: nec.owner, actor: nec.name, text: `${nec.name} uses ${ability.name}.` });
  }
  return undefined;
}

// Filter state for a viewer (Maleghast is open information, so we send the whole
// board; this hook exists for future fog and to strip the rng internals).
export function viewFor(s: GameState, _userId: number | null): GameState {
  return { ...s, rng: { seed: 0, count: s.rng.count } as Rng };
}
