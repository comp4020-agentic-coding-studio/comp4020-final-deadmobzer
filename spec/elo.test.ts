// Pure Elo-core unit tests (no HTTP, no DB): the rating math the UI can't see.
import { describe, it, expect } from "vitest";
import { expectedScore, nextRating, K, SEED_RATING } from "../src/elo-core.ts";

describe("elo core", () => {
  it("equal ratings expect a draw", () => {
    expect(expectedScore(1200, 1200)).toBeCloseTo(0.5, 10);
  });
  it("expected scores are symmetric and sum to 1", () => {
    expect(expectedScore(1400, 1200) + expectedScore(1200, 1400)).toBeCloseTo(1, 10);
  });
  it("the winner gains and the loser loses, zero-sum", () => {
    const w = nextRating(1200, 1200, 1) - 1200;
    const l = nextRating(1200, 1200, 0) - 1200;
    expect(w).toBeGreaterThan(0);
    expect(l).toBeLessThan(0);
    expect(w + l).toBe(0);
  });
  it("beating a much stronger player gains more than beating a peer", () => {
    const vsStronger = nextRating(1200, 1600, 1) - 1200;
    const vsPeer = nextRating(1200, 1200, 1) - 1200;
    expect(vsStronger).toBeGreaterThan(vsPeer);
  });
  it("a draw between equals changes nothing", () => {
    expect(nextRating(1200, 1200, 0.5)).toBe(1200);
  });
  it("the swing never exceeds K", () => {
    expect(Math.abs(nextRating(1200, 3000, 1) - 1200)).toBeLessThanOrEqual(K);
    expect(SEED_RATING).toBe(1200);
  });
});
