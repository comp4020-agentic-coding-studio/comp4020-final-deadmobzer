// Applying a chosen upgrade to a unit at game creation. Each upgrade either sets a
// mechanical flag the engine honours, or patches one of the unit's abilities
// (extra damage / push / range / effects). Upgrades whose faithful effect needs a
// subsystem the engine doesn't model yet (plague, Doom, Miracle, mutation, stance,
// corpses, deathburst) still attach to the unit and show in the inspector, and
// apply whatever part IS expressible — nothing is silently dropped. Berserk itself
// is now mechanical (see applyBerserkAfterAct in engine.ts): abilities that grant
// berserk tokens pay off with the splash-and-discard the rulebook describes.

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
