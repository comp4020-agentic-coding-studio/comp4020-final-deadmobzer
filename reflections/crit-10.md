# Crit 10 — Fly by instruments

> Draft in my own voice before I submit — this is an accurate account of the week
> to build on, not the final wording.

This week the brief was to make the final project genuinely multi-user and prove
it from the logs: two of my pod open the app from its URL alone, in separate Chrome
profiles, and I narrate who did what without touching the app myself.

The bigger story is that I made a **complete shift**. My earlier project, a
reflection diary, never really earned the multi-user, real-time brief — its only
live moment was a friend request, and the two people in it barely touched the same
state at once. So I handed the agent a harder, different problem: read the ruleset
for a tabletop wargame (*Magnagothica Maleghast*) and recreate it online, two
necromancers acting on one shared board in real time. That is multi-user by
construction — the game is *nothing* without a live opponent.

## What I built toward the crit's three asks

**Tell people apart, server-side.** Identity is the existing account system; what
each person may do is decided in `src/games.ts`, not the UI. Only a game's two
participants can act, only on their own units, only on their turn; everyone else is
a read-only spectator. I pinned this in `spec/access.test.ts` so a regression shows
up red: a spectator acting, the wrong side acting, or a player trying to move the
opponent's unit all return 403.

**Log who did what.** Every sign-in and every state change emits one `audit` line
that names the actor — `audit user=alice action=game.action game=… kind=move`. I
made a point of logging *names, not ids*, so when I narrate from `flyctl logs` at
the crit, Alice and Bob are legible without a decoder ring.

**It has to work.** The whole game is playable over the API and covered by tests:
34 passing across access, security, persistence, real-time and the engine rules.

## How I directed, grounded, and corrected the agent

I front-loaded the thinking into a plan and let the agent build in committed phases,
reading each result before the next. The grounding that kept it honest:

- **Extract before build.** The stats live in a 58 MB PDF, so I had the agent sweep
  it to text once and work from `data/` after that — faithful numbers, and never
  re-reading the PDF.
- **Tests as backpressure.** The access and security promises are checks, not prose,
  so "the server decides" and "no script injection" can't quietly rot.
- **A correction that landed in the harness.** When I worried the 3D plan could
  repeat the old out-of-memory crash, I didn't just hope — I wrote a build-time
  purity assertion that fails if a heavy client library leaks into the server
  bundle. The fix lives in the harness, not in my memory.

## Where it stands, honestly

The server-side game — rules engine, all six Houses, lobbies, chat, ELO,
persistence, real-time — is in and green. The 3D table is the remaining piece; for
this crit the match is driven and narrated through the API and the logs, which is
exactly what "fly by instruments" asks for. What I'd want next is the table itself,
so the pod plays by clicking, not curling.
