// Pure Elo math — no imports, so it's unit-testable without opening the DB.

export const K = 32;
export const SEED_RATING = 1200;

export function expectedScore(a: number, b: number): number {
  return 1 / (1 + 10 ** ((b - a) / 400));
}

// New rating for a player rated `rating` vs `opponent`, scoring `score`
// (1 win, 0 loss, 0.5 draw).
export function nextRating(rating: number, opponent: number, score: number): number {
  return Math.round(rating + K * (score - expectedScore(rating, opponent)));
}
