import { expect, it } from "vitest";
import { isRevealed } from "../src/reveal.ts";

// The reveal rule is the heart of the app's "good": a note you write is sealed
// until the next day, so the exchange is reciprocal and unhurried rather than a
// live feed. This locks that rule down. (The full write→seal→reveal path over
// HTTP is exercised by hand against two days; here we pin the rule itself.)

it("seals a note on the day it is written", () => {
  expect(isRevealed("2026-10-06", "2026-10-06")).toBe(false);
});

it("unseals a note once the viewer's day has moved on", () => {
  expect(isRevealed("2026-10-06", "2026-10-07")).toBe(true);
  expect(isRevealed("2026-10-06", "2026-12-25")).toBe(true);
});

it("never reveals a note dated in the viewer's future", () => {
  expect(isRevealed("2026-10-08", "2026-10-07")).toBe(false);
});
