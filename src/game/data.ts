// Loads the rules + faction data. JSON is imported so esbuild inlines it into
// dist/server.js — no runtime fs, nothing extra to copy into the image.

import rules from "../../data/rules.json" with { type: "json" };
import carcass from "../../data/factions/carcass.json" with { type: "json" };
import goregrinders from "../../data/factions/goregrinders.json" with { type: "json" };
import gargamox from "../../data/factions/gargamox.json" with { type: "json" };
import deadsouls from "../../data/factions/deadsouls.json" with { type: "json" };
import abhorrers from "../../data/factions/abhorrers.json" with { type: "json" };
import igorri from "../../data/factions/igorri.json" with { type: "json" };
import type { Ability, Armor, UnitType } from "./types.ts";

export interface UnitDef {
  id: string;
  name: string;
  type: UnitType;
  mv: number;
  hp: number;
  df: number;
  arm: Armor;
  large?: boolean;
  art: string;
  traits: { name: string; text: string }[];
  acts: Ability[];
  souls?: Ability[];
  upgrades?: { name: string; text: string }[];
}

export interface FactionDef {
  id: string;
  name: string;
  blurb: string;
  playstyle: string;
  accent: string;
  specialMechanic: { name: string; text: string };
  specialTags: Record<string, string>;
  necromancer: UnitDef;
  units: UnitDef[];
}

export const RULES = rules as typeof rules;

const FACTION_LIST = [
  carcass, goregrinders, gargamox, deadsouls, abhorrers, igorri,
] as unknown as FactionDef[];

export const FACTIONS: Record<string, FactionDef> = Object.fromEntries(
  FACTION_LIST.map((f) => [f.id, f]),
);

export function faction(id: string): FactionDef {
  const f = FACTIONS[id];
  if (!f) throw new Error(`unknown faction: ${id}`);
  return f;
}

// Every unit (necromancer + roster) a House can field, in roster order.
export function allUnitDefs(factionId: string): UnitDef[] {
  const f = faction(factionId);
  return [f.necromancer, ...f.units];
}

export function unitDef(factionId: string, defId: string): UnitDef {
  const d = allUnitDefs(factionId).find((u) => u.id === defId);
  if (!d) throw new Error(`unknown unit ${defId} in ${factionId}`);
  return d;
}

export const PLAYER_PALETTE: string[] = RULES.playerPalette16;
export const MAP_SIZE: number = RULES.mode.mapSize;
export const MAX_ROUNDS: number = RULES.mode.maxRounds;
export const UNIT_SLOTS: number = RULES.mode.unitSlots;
