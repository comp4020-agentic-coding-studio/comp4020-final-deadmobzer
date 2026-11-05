# Maleghast Online

A real-time, two-player recreation of the tabletop skirmish wargame
*MAGNAGOTHICA Maleghast* (by Tom Parkinson-Morgan). Two necromancers raise their
Black Mass on an 8×8 grid and fight until one necromancer falls. Everything each
side does — every die, every move, every curse — is resolved on the server and
read back live by both players in their own browsers.

## Who it's for

Two people who want a real opponent across a shared board, not a bot and not a
solo puzzle. It's built for a pod, a group chat, a pair of friends on a call:
share a lobby code or quick-join, pick a House, and play a full match in a sitting.
Anyone else can watch and heckle from the stands.

## What "good" means here

Good, for this app, is **a fair, legible, live duel against a real person, true to
the game it recreates.** Four things make it good, and each is something you can
check at the table:

- **Live.** A move one player makes appears in the other's browser within about a
  second, with no reload — and spectators see it too. Co-presence is the point: the
  app is only interesting because someone else is acting at the same time.
- **Fair.** The server is the only authority. It rolls the dice, resolves combat,
  and decides what's legal. A client can ask to do something; it can never decide
  the outcome, move a piece that isn't its own, or act out of turn. A versioned
  write guard means two actions racing on the same game never silently stomp one
  another — the loser gets a conflict, not a corrupted board
  ([`docs/adr-005-concurrent-actions.md`](docs/adr-005-concurrent-actions.md)).
- **Legible.** You can always tell *who did what and why.* The battle log shows
  every roll and its result, and the server logs name the two players so an
  observer can follow a whole match from the logs alone.
- **Faithful.** The stats, dice math (hit vs graze on DF, take-highest pools),
  damage types, armour, pierce, devil damage, tokens, SOUL and the six canonical
  Houses are taken from the rulebook, not invented.

## What's enforced, and what's judged

Some of "good" is checked by `spec/` (run by `pnpm check` against the running app);
some can only be felt over a match.

- **Enforced:** server-side access control (only a game's two players may act, only
  on their own units, only on their turn; spectators are read-only); no script
  injection (user text is escaped, a strict CSP is set); the combat rules
  (`spec/rules.test.ts`); real-time delivery (`spec/realtime.test.ts`); persistence
  across restarts; a versioned write guard against concurrent actions on the same
  game (`spec/concurrency.test.ts`); and fair ratings (`spec/elo.test.ts`).
- **Judged:** whether a match *feels* tense and readable, whether the faithfulness
  lands for someone who knows the tabletop game, and whether the table reads as the
  rulebook's world rather than a generic grid.

## What shaped it

The tabletop rulebook is the source of truth for rules and look. The online
experience borrows from virtual tabletops: **Tabletop Simulator** (a 3D table and
dice you roll), **Owlbear Rodeo** (share a link and play), **Roll20** (tokens on a
grid and a visible roll log), **Foundry VTT** (data-driven stat blocks you can
inspect), and **Fantasy Grounds** (the system, not the players, enforces the rules).

The decision to keep all authority and logging on the server is written up in
[`docs/adr-001-server-authoritative-state.md`](docs/adr-001-server-authoritative-state.md).
