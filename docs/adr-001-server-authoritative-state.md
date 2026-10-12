# ADR 001 — The server is the only authority

## Status
Accepted.

## Context
Maleghast is a competitive 1v1 with hidden-information-free but
outcome-sensitive mechanics: dice rolls, legal moves, combat resolution. The crit
and the final-project brief both test that *what each person may see and change is
checked on the server*, with two players in separate browsers who share no storage.

## Decision
All game state lives in one serializable `GameState`, mutated only by the pure
engine (`src/game/engine.ts`). The server rolls every die from a seeded PRNG kept
in the state, resolves combat, and validates every action (`src/games.ts act`).
The client sends *intents* (`{kind:"move",…}`) and renders results; it never
decides an outcome, never moves a piece it doesn't own, never acts out of turn.

## Consequences
- Cheating by a modified client is structurally impossible — the server recomputes
  everything.
- The same engine the server runs is what the unit tests check, and it serializes
  straight to SQLite, so persistence and authority fall out of one design.
- The client can be "dumb" presentation (the coming 3D table), which keeps it off
  the critical path for correctness.
