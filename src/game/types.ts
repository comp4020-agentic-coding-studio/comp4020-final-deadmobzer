// Shared game types. GameState is the single server-authoritative object; it is
// serialized to JSON and stored in SQLite (so a game survives restart/redeploy)
// and filtered per-viewer before going to a client.

import type { Rng } from "./prng.ts";

export type DamageType = "physical" | "fire" | "toxic" | "curse" | "holy" | "devil";
export type Armor = "PHYS" | "MAG" | "SUPER" | null;
export type TokenType =
  | "strength" | "weak" | "vitality" | "vulnerable" | "slow" | "speed" | "berserk" | "doom";
export type UnitType =
  | "thrall" | "freak" | "scion" | "horror" | "hunter" | "tyrant" | "necromancer";

export interface Pos { x: number; y: number }

// A battlefield cell's special terrain (rulebook pg. 19). Types stack.
export interface TerrainCell {
  wall?: { hp: number };   // blocks LoS + movement, gives cover, 2 HP
  elevated?: boolean;      // +1 to enter from ground, gives cover, +/-1D
  hazard?: boolean;        // 1 damage (ignores armor) on entering / starting there
  adverse?: boolean;       // +1 movement to exit
  stairs?: boolean;        // skips the elevation entry cost
}

export type Tokens = Partial<Record<TokenType, number>>;

// A single effect op (see data/factions/SCHEMA.md). Loosely typed on purpose —
// the engine interprets what it knows and logs the rest.
export interface EffectOp {
  op: string;
  [k: string]: unknown;
}

export interface Ability {
  name: string;
  tags: string[];
  range?: [number, number] | "melee" | "self";
  text: string;
  effect?: EffectOp[];
  soul?: number;
}

// A deployed unit instance on the board.
export interface Unit {
  iid: string;          // instance id, unique within the game
  owner: 0 | 1;         // which side
  house: string;
  defId: string;        // unit id in the faction data
  name: string;
  type: UnitType;
  art: string;
  mv: number;
  hp: number;
  maxHp: number;
  df: number;
  arm: Armor;
  large: boolean;
  pos: Pos;
  tokens: Tokens;
  acts: Ability[];
  reloaded: Record<string, boolean>;  // ability name -> ready to fire (reload tag)
  activatedThisRound: boolean;
  alive: boolean;
  isNecromancer: boolean;
  upgrade?: string;                 // chosen upgrade name (faithful mode), for display
  flags?: UnitFlags;                // mechanical effects applied by the upgrade
}

// Passive mechanical effects an upgrade can grant; the engine checks these.
export interface UnitFlags {
  immunePush?: boolean;             // can't be pushed or pulled
  obliterateOnSlay?: boolean;       // this unit's kills obliterate
  superArmorAtLowHp?: boolean;      // gains super armor at <=1 HP
  pierceAtLowHp?: boolean;          // its damage pierces at <=1 HP
  curseproof?: boolean;             // immune to enemy curses (flagged)
  coverAttackBonus?: boolean;       // +1D on attacks while in cover
}

export type Phase = "deploy" | "playing" | "over";

export interface SidePlayer {
  userId: number;
  house: string;
  colour: string;       // one of the 16 player palette colours
  soul: number;
  deployed: boolean;
  firstSlainTaken: boolean;  // SOUL Harvest only fires on the first unit slain
}

export interface LogEntry {
  round: number;
  side: 0 | 1 | null;
  actor: string;        // unit name or system
  text: string;
  dice?: number[];      // dice rolled, for the 3D dice + battle log
}

export interface GameState {
  version: 1;
  mapSize: number;
  phase: Phase;
  round: number;
  activeSide: 0 | 1;    // whose turn it is to activate a unit
  firstSide: 0 | 1;     // who won initiative / acts first each round
  players: [SidePlayer, SidePlayer];
  units: Unit[];
  terrain: Record<string, TerrainCell>;   // keyed "x,y"
  corpses: Pos[];                          // markers left by slain (not obliterated) units
  rng: Rng;
  log: LogEntry[];
  winner: 0 | 1 | null;
  soulUsedThisTurn: boolean;
}

// A player action, validated + applied server-side.
export type Action =
  | { kind: "deploy"; placements: { iid: string; pos: Pos }[] }
  | { kind: "move"; iid: string; to: Pos }
  | { kind: "act"; iid: string; ability: string; target?: Pos | string }
  | { kind: "soul"; ability: string; target?: Pos | string }
  | { kind: "endTurn" };
