import { db } from "./db.ts";
import { nowISO } from "./time.ts";
import { faction, FACTIONS, PLAYER_PALETTE, UNIT_SLOTS, RULES } from "./game/data.ts";
import type { Loadout } from "./game/engine.ts";

export class LoadoutError extends Error {}

export type Mode = "faithful" | "fixed";

export interface SavedLoadout {
  mode: Mode;
  house: string;
  colour: string;
  units: { defId: string }[];
  malice?: string;                       // Malice level name (faithful mode)
  upgrades?: Record<string, string>;     // unit defId -> chosen upgrade name
}

interface MaliceLevel { name: string; darkPower: number }
const MALICE: MaliceLevel[] = (RULES.malice.levels as MaliceLevel[]);
export function maliceLevels(): MaliceLevel[] { return MALICE; }

// Validate a chosen Black Mass against the rules: a known House, a palette
// colour, and a legal roster. In 'fixed' mode the roster is the House's five
// units. In 'faithful' mode the player fills unit slots (thralls are 2-per-slot,
// tyrant max 1) within the slot budget.
export function validateLoadout(
  mode: Mode, house: string, colour: string, units: { defId: string }[],
  malice?: string, upgrades?: Record<string, string>,
): SavedLoadout {
  if (!FACTIONS[house]) throw new LoadoutError("Unknown House.");
  if (!PLAYER_PALETTE.includes(colour)) throw new LoadoutError("Pick a colour from the palette.");
  const f = faction(house);
  const roster = new Map(f.units.map((u) => [u.id, u]));

  if (mode === "fixed") {
    // The House's five units, one each, in order.
    return { mode, house, colour, units: f.units.map((u) => ({ defId: u.id })) };
  }

  // faithful: validate slot budget + unit limits.
  if (units.length === 0) throw new LoadoutError("Pick at least one unit.");
  let slots = 0;
  const counts = new Map<string, number>();
  for (const { defId } of units) {
    const def = roster.get(defId);
    if (!def) throw new LoadoutError(`Unknown unit: ${defId}`);
    counts.set(defId, (counts.get(defId) ?? 0) + 1);
    const typeInfo = (RULES.unitTypes as Record<string, { slotCost: number; limit: number | null }>)[def.type];
    slots += typeInfo?.slotCost ?? 1;
  }
  for (const [defId, n] of counts) {
    const def = roster.get(defId)!;
    const limit = (RULES.unitTypes as Record<string, { limit: number | null }>)[def.type]?.limit;
    if (limit != null && n > limit) throw new LoadoutError(`Too many ${def.name} (max ${limit}).`);
  }
  if (slots > UNIT_SLOTS) throw new LoadoutError(`Over the slot budget (${slots} > ${UNIT_SLOTS}).`);

  // Malice + dark-power upgrades (optional). Spend 1 dark power per upgrade; one
  // upgrade per unit type, except Ultrahell which allows two.
  let level = MALICE[0];
  let cleanUpgrades: Record<string, string> | undefined;
  if (malice) {
    const lvl = MALICE.find((m) => m.name === malice);
    if (!lvl) throw new LoadoutError("Unknown Malice level.");
    level = lvl;
  }
  if (upgrades && Object.keys(upgrades).length) {
    const spent = Object.keys(upgrades).length;
    if (spent > level.darkPower) throw new LoadoutError(`Over the dark-power budget (${spent} > ${level.darkPower}).`);
    cleanUpgrades = {};
    for (const [defId, upName] of Object.entries(upgrades)) {
      const def = roster.get(defId);
      if (!def || !counts.has(defId)) throw new LoadoutError(`Upgrade for a unit not in your roster: ${defId}`);
      if (!def.upgrades?.some((u) => u.name === upName)) throw new LoadoutError(`Unknown upgrade: ${upName}`);
      cleanUpgrades[defId] = upName;
    }
  }
  return { mode, house, colour, units, malice: level.name, upgrades: cleanUpgrades };
}

export function saveLoadout(userId: number, l: SavedLoadout): void {
  // units_json holds the whole Black Mass (units + malice + upgrades).
  const blob = JSON.stringify({ units: l.units, malice: l.malice, upgrades: l.upgrades });
  db.prepare(
    `INSERT INTO loadouts (user_id, mode, house, colour, units_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, mode) DO UPDATE SET
       house = excluded.house, colour = excluded.colour,
       units_json = excluded.units_json, updated_at = excluded.updated_at`,
  ).run(userId, l.mode, l.house, l.colour, blob, nowISO());
}

export function getLoadout(userId: number, mode: Mode): SavedLoadout | null {
  const row = db.prepare("SELECT mode, house, colour, units_json FROM loadouts WHERE user_id = ? AND mode = ?")
    .get(userId, mode) as { mode: Mode; house: string; colour: string; units_json: string } | undefined;
  if (!row) return null;
  const parsed = JSON.parse(row.units_json);
  // back-compat: older rows stored a bare units array
  const extra = Array.isArray(parsed) ? { units: parsed } : parsed;
  return { mode: row.mode, house: row.house, colour: row.colour, units: extra.units ?? [], malice: extra.malice, upgrades: extra.upgrades };
}

// Turn a saved loadout into the engine Loadout for a given user.
export function toEngineLoadout(userId: number, l: SavedLoadout): Loadout {
  return { userId, house: l.house, colour: l.colour, units: l.units, upgrades: l.upgrades };
}
