// Deterministic PRNG so dice are server-authoritative, persistable, and
// replayable: the seed + call count live in the GameState, the client only ever
// animates results the server already rolled. mulberry32 — small and good enough
// for dice.

export interface Rng {
  seed: number;
  count: number;
}

export function makeRng(seed: number): Rng {
  return { seed: seed >>> 0, count: 0 };
}

// Advance the rng in place and return a float in [0,1).
function next(rng: Rng): number {
  rng.count = (rng.count + 1) >>> 0;
  let t = (rng.seed + rng.count * 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// One d6.
export function rollD6(rng: Rng): number {
  return 1 + Math.floor(next(rng) * 6);
}

// A dice pool: roll `max(count,2)` dice; take the highest, or the lowest when
// the pool was reduced to 0 or less (rulebook: "roll two dice and pick the
// lowest"). Returns the chosen value and every die rolled (for the battle log).
export function rollPool(rng: Rng, count: number): { value: number; dice: number[] } {
  const takeLowest = count <= 0;
  const n = takeLowest ? 2 : count;
  const dice: number[] = [];
  for (let i = 0; i < n; i++) dice.push(rollD6(rng));
  const value = takeLowest ? Math.min(...dice) : Math.max(...dice);
  return { value, dice };
}
