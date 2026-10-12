import { db } from "./db.ts";
import { PLAYER_PALETTE, FACTIONS, allUnitDefs } from "./game/data.ts";

export class ProfileError extends Error {}

export interface Profile {
  id: number;
  username: string;
  display_name: string;
  elo: number;
  avatarHouse: string | null;
  avatarUnit: string | null;
  colour: string | null;
}

export function getProfile(userId: number): Profile | null {
  const row = db.prepare(
    "SELECT id, username, display_name, elo, avatar_house, avatar_unit, colour FROM users WHERE id = ?",
  ).get(userId) as
    | { id: number; username: string; display_name: string; elo: number; avatar_house: string | null; avatar_unit: string | null; colour: string | null }
    | undefined;
  if (!row) return null;
  return {
    id: row.id, username: row.username, display_name: row.display_name, elo: row.elo,
    avatarHouse: row.avatar_house, avatarUnit: row.avatar_unit, colour: row.colour,
  };
}

// Avatar = a portrait from the game art (house + unit id) tinted by a palette
// colour (the same 16 colours as the on-board pawns). Validated server-side.
export function setAvatar(userId: number, house: string, unitId: string, colour: string): void {
  if (!FACTIONS[house]) throw new ProfileError("Unknown House.");
  if (!allUnitDefs(house).some((u) => u.id === unitId)) throw new ProfileError("Unknown unit.");
  if (!PLAYER_PALETTE.includes(colour)) throw new ProfileError("Pick a colour from the palette.");
  db.prepare("UPDATE users SET avatar_house = ?, avatar_unit = ?, colour = ? WHERE id = ?")
    .run(house, unitId, colour, userId);
}
