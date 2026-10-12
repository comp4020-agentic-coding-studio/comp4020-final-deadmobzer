import { db } from "./db.ts";
import { nextRating, SEED_RATING } from "./elo-core.ts";

// Standard Elo. Pure core (expectedScore/nextRating) lives in elo-core.ts and is
// unit-tested; the DB update derives the result from the authoritative game
// outcome, never a client-reported one. Only ranked games change ratings.

export { expectedScore, nextRating, K, SEED_RATING } from "./elo-core.ts";

export function ratingOf(userId: number): number {
  const row = db.prepare("SELECT elo FROM users WHERE id = ?").get(userId) as { elo: number } | undefined;
  return row?.elo ?? SEED_RATING;
}

// Apply a ranked result. winner is the winning userId, or null for a draw.
// Returns the deltas so callers can log/audit them.
export function applyRankedResult(
  p0: number, p1: number, winner: number | null,
): { p0: number; p1: number; d0: number; d1: number } {
  const r0 = ratingOf(p0);
  const r1 = ratingOf(p1);
  const s0 = winner === null ? 0.5 : winner === p0 ? 1 : 0;
  const s1 = winner === null ? 0.5 : winner === p1 ? 1 : 0;
  const n0 = nextRating(r0, r1, s0);
  const n1 = nextRating(r1, r0, s1);
  const tx = db.transaction(() => {
    db.prepare("UPDATE users SET elo = ? WHERE id = ?").run(n0, p0);
    db.prepare("UPDATE users SET elo = ? WHERE id = ?").run(n1, p1);
  });
  tx();
  return { p0: n0, p1: n1, d0: n0 - r0, d1: n1 - r1 };
}
