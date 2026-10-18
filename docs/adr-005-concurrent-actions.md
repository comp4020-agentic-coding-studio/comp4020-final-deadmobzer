# ADR 005 — Concurrent actions on one game: deliberate, not assumed

## Status
Accepted.

## Context
Week 10's lecture frames concurrent writes to shared state as a decision the
author has to be able to name, not a bug to quietly avoid: "what happens when two
users save conflicting changes simultaneously" is one of the week's own self-study
questions, and it was fair game for the crit even though it isn't in the written
spec checklist.

So the actual question for this app: can two actions on the *same game* race?
`act()` (`src/games.ts`) reads `state_json`, validates, and writes back with no
`await` in between, and `better-sqlite3` is a synchronous driver. The whole
request runs on Node's single thread with nothing else able to interleave between
the read and the write, and the app is one Fly machine (`ha=false`, `fly.toml`).
So today: **no, it can't race** — each call to `act()` is already atomic, as a
consequence of the driver and the deployment shape, not because anything in
`games.ts` enforces it.

That "it can't race, but only because of two things outside this file" is exactly
the kind of claim that stops being true silently. Swap `better-sqlite3` for an
async driver, add a queue in front of writes, or scale past one machine, and the
read-then-write in `act()` would start racing with no warning and no test to catch
it — the two things holding the invariant up aren't things `games.ts` itself
guards.

## Decision
Make the atomicity structural instead of incidental. Every game carries a
`version` counter, and every write is conditioned on it:
`UPDATE games SET ..., version = version + 1 WHERE id = ? AND version = ?`. If the
row's version has moved since this call read it, the conditional update matches
zero rows and the caller gets a conflict instead of silently overwriting whatever
landed first:
- `act()` returns `{ conflict: true }`, surfaced over HTTP as `409`.
- `leaveGame()` re-reads and retries — a forfeit losing the race to a just-landed
  win should reconcile with what actually happened, not stomp it.

The client (`src/client/Game.tsx` `runAction`) treats a failed action, 409
included, the same way: show the error and refetch, so a stale local view gets
corrected from the server rather than retried blind against data that's already
moved. `spec/concurrency.test.ts` exercises the guard directly against the DB —
two writes against one read version, one succeeds, one gets the conflict — since
provoking a genuine HTTP race deterministically isn't possible from outside a
process that's already single-threaded.

## Consequences
- The invariant ("one game, one state, no lost updates") no longer depends on
  nobody changing the DB driver or the deployment topology later — it's checked
  on every write, for the lifetime of the schema.
- The cost today is one extra `WHERE` clause per write and a version bump; there's
  no behavioural change while the current driver/deployment holds.
- If the deployment ever does become concurrent (an async driver, multiple
  machines), the first real race fails loud as a `409`, not as a silently
  corrupted game.
