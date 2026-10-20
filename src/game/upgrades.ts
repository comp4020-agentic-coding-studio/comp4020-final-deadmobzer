// Applying a chosen upgrade to a unit at game creation. Each upgrade either sets a
// mechanical flag the engine honours, or patches one of the unit's abilities
// (extra damage / push / range / effects). Upgrades whose faithful effect needs a
// subsystem the engine doesn't model yet still attach to the unit and show in the
// inspector, and apply whatever part IS expressible — nothing is silently
// dropped. Berserk, Doom, Plague, Miracle and the common odd/even branch of
// Stance are now mechanical (see applyBerserkAfterAct, applyDoomAtEndOfRound,
// applyPlagueAfterTurn, the `miracle` flag check in slay(), and the `stance`
// effect op, all in engine.ts). Mutation tokens are generic (TokenType
// "mutation") and the one static grant named in the data (Homonculus's
// Warpflesh: starts with 4) is wired in makeUnit; mutation's "discard in place
// of any other token, or stand in as a copy of one" substitution rule needs the
// engine to know, at the moment a token would be discarded, which token type the
// caller actually wanted spent and whether the player chooses to substitute —
// that's a player-choice prompt the engine has no hook for, so mutation tokens
// accumulate and display but are never auto-substituted. The honest remainder
// still standing: Doom only accumulates, it never clears early by slaying
// another unit (needs attacker-vs-victim tracking); Miracle's "at the end of
// any turn it is slain" revive check fires immediately at the point of slaying
// rather than waiting for a true end-of-turn pass, so a unit slain mid-opponent's-
// turn that could still revive later that same turn is resolved early instead;
// and the "special numbered round" stance overrides some upgrades add on top of
// the base odd/even branch (Taste the Lash, Witness, Punisher, Heart Destroyer)
// are applied unconditionally rather than gated to their stated round, since
// round-gating a *handler's* patch would require the handler to close over the
// live round number at resolve time, not just mutate the ability once at setup.

import type { EffectOp, Unit } from "./types.ts";

function ability(u: Unit, name: string) {
  return u.acts.find((a) => a.name === name);
}
// Add an effect op under an ability's onHit (e.g. push on hit).
function addOnHit(u: Unit, name: string, op: EffectOp): void {
  const a = ability(u, name);
  if (!a) return;
  a.effect = a.effect ?? [];
  const onHit = a.effect.find((e) => e.op === "onHit");
  if (onHit) (onHit.then as EffectOp[]).push(op);
  else a.effect.push({ op: "onHit", then: [op] });
}
function bumpDamage(u: Unit, name: string, by: number): void {
  const a = ability(u, name);
  if (!a?.effect) return;
  for (const e of a.effect) if (e.op === "attack" || e.op === "damage") e.damage = ((e.damage as number) ?? 0) + by;
}
function flag(u: Unit, f: keyof NonNullable<Unit["flags"]>): void {
  u.flags = { ...u.flags, [f]: true };
}

// Registry keyed by upgrade name. Handlers mutate the unit in place.
const HANDLERS: Record<string, (u: Unit) => void> = {
  // --- cover / positioning ---
  "Brace": (u) => flag(u, "coverAttackBonus"),
  "Bulwark": (u) => flag(u, "coverAttackBonus"),
  "Hot Chamber": (u) => flag(u, "coverAttackBonus"),
  // --- push / pull immunity & extra push ---
  "Extended Barrel": (u) => flag(u, "immunePush"),
  "Caliber Up": (u) => addOnHit(u, "Snipe", { op: "push", n: 1, target: "hit" }),
  "Heavy Caliber Cannon": (u) => addOnHit(u, "Catechism Devil Cannon", { op: "push", n: 1, target: "hit" }),
  // --- obliterate-on-kill ---
  "Fuel Injectors": (u) => flag(u, "obliterateOnSlay"),
  "Punisher": (u) => flag(u, "obliterateOnSlay"),
  "Heart Destroyer": (u) => flag(u, "obliterateOnSlay"),
  "Supremacy": (u) => flag(u, "obliterateOnSlay"),
  // --- armour / low-hp resilience ---
  "Machineheart": (u) => flag(u, "superArmorAtLowHp"),
  "Bloody Teeth": (u) => flag(u, "pierceAtLowHp"),
  // --- curseproof ---
  "Lobotomized": (u) => flag(u, "curseproof"),
  "Strong Pact": (u) => flag(u, "curseproof"),
  "Stim Haze": (u) => flag(u, "curseproof"),
  "Smog Shroud": (u) => flag(u, "curseproof"),
  // --- damage boosts ---
  "Taste the Lash": (u) => bumpDamage(u, "Excoriate", 1),
  "Witness": (u) => bumpDamage(u, "Indignation", 1),
  // --- start-of-combat tokens ---
  "Holy Blood": (u) => { u.tokens.vitality = (u.tokens.vitality ?? 0) + 1; },
};

// Apply the named upgrade to a unit. Always records the name for the inspector;
// runs the mechanical handler when one exists.
export function applyUpgrade(u: Unit, upgradeName: string): void {
  u.upgrade = upgradeName;
  HANDLERS[upgradeName]?.(u);
}
