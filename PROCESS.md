# Process overview

> First full draft in my own voice; the brief wants ~900–1100 words at submission.
> It describes the project **as it stands now**, after the pivot.

## From the brief to the idea

The brief asks for a deployed, multi-user, real-time app that is *good* by a
definition I make and defend, and it warns against the median answer — a chat room
with the nouns swapped. My first project, a daily reflection diary, drifted toward
exactly that failure from the other side: it was calm and personal, but it barely
used the thing the brief is really testing. Two people almost never touched the same
state at the same time; the only live event was a friend request. When I was honest
about it, the multi-user, real-time requirement was bolted on, not load-bearing.

So I made a complete shift. I handed the agent a harder, less familiar problem than
another CRUD app: **read the ruleset of a tabletop wargame and recreate it online.**
The game is *MAGNAGOTHICA Maleghast*, a 1v1 skirmish where two necromancers raise a
warband on an 8×8 grid and fight until a necromancer falls. This is multi-user by
construction — the whole point is a live opponent across a shared board — and it let
me push on what the agent could do with an unusual, rules-dense task.

The pivot changed how I briefed the agent, not just what I asked it to build. For
the diary I'd kept context thin and written most of the structure myself; here I
went the other way and handed the agent a **large, messy asset corpus up front** —
the 58 MB rulebook PDF, the full unit-art archive, and the designer's own balance
and patch-note text files — on the bet that a faithful recreation needed the real
source material in the loop, not my paraphrase of it. That bet is also why
extraction became its own first phase ([`a716ace`](../../commit/a716ace)) rather
than something the agent reached for mid-build: dumping that much raw material into
context on every turn would have been slow and imprecise, so the assets existed to
be swept once into `data/`, then set aside.

Rebuilding this much of an app from scratch in one week is also not something I
wanted to direct turn-by-turn, so for the first time this project I worked in
**Plan Mode**: I had the agent read the extracted rules and propose the phased
build order (engine → backend → UI → 3D → docs) before it wrote any application
code, pushed back on the ordering twice, and only let it start once the plan held
together end to end. The phase-numbered commits in the log are that plan, executed
one approved step at a time.

## What good means, and how it shaped the build

I define good here as **a fair, legible, live duel against a real person, faithful
to the game it recreates.** Each word is something I can check at the table, and
each pushed a concrete decision:

- *Fair* → the server is the only authority. It rolls the dice, resolves combat, and
  validates every move. A client can ask; it can never decide.
- *Live* → one player's move reaches the other (and spectators) within about a
  second over WebSockets, no reload.
- *Legible* → a visible battle log of every roll, and server logs that name the two
  players so a whole match is followable from the logs alone.
- *Faithful* → stats, dice math, damage types, tokens and the six Houses come from
  the rulebook, not from me.

The README states this and says which claims are enforced by `spec/` and which are
left to judgement; CLAUDE.md turns the enforced ones into invariants; `spec/` is the
checks. The three agree on purpose.

## The stack, and why

I kept the course platform — one 256 MB Fly machine, one SQLite volume, HTTP on
`$PORT` — and a hand-rolled Node server with no web framework, because the app's
logic is small and I wanted no magic between a request and the database. The game
itself is a **pure engine over one serializable `GameState`** (`src/game/`): the
server rolls from a seeded PRNG stored in the state, so dice are deterministic,
persistable and replayable, and the exact same code the server runs is what the
unit tests check. State serializes straight to SQLite, so persistence and authority
fall out of one design rather than two.

The biggest stack decision was to **drop Material UI** and derive the look from the
rulebook — its fonts and palette, extracted once into `data/style.json`. A generic
component kit fought the source material's gothic, blood-and-bone identity, and
removing it also shrank the dependency surface.

## How I worked with the agent

I front-loaded the thinking into a plan and had the agent build in committed phases,
reading each result before starting the next. The work grew in legible steps:

- **Extract before build** ([`a716ace`](../../commit/a716ace)): the stats live only
  in a 58 MB, art-heavy PDF, so I had the agent sweep the whole rulebook to text
  once and work from `data/raw/` afterward — never re-reading the PDF. The same step
  pulled the fonts and palette into a reusable style file.
- **Data as the source of truth** ([`1ad41a1`](../../commit/1ad41a1),
  [`1b1d77e`](../../commit/1b1d77e)): all six Houses — 36 units — are encoded as JSON
  with real MV/HP/DF/ARM, abilities and upgrades. Abilities carry an engine-readable
  `effect[]` *and* the faithful rulebook text, so re-balancing is a data edit and the
  exact wording is always available to the inspector.
- **A tested engine** ([`d4ff663`](../../commit/d4ff663)): the combat core with
  pure-function tests for the rules the UI can't see — armour by type, pierce,
  devil/obliterate, token math, legal moves, acting out of turn, victory.
- **The whole backend, playable via API** ([`9d48317`](../../commit/9d48317)):
  lobbies (codes, quick-join, per-mode queues), games (validated actions,
  persistence, roles), two-channel chat, ELO, profiles, real-time game rooms, and a
  strict CSP.

## Corrections that landed in the harness

The course's rule is that a fix with no trace in the harness didn't really happen,
and two moments shaped the build that way. First, the **256 MB limit**: the earlier
app had already crash-looped once from a heavy server-rendered UI, and the new app
adds a 3D table that is heavier still. Rather than trust myself to remember, I had
the agent add a **build-time purity assertion** that fails if Three.js, React or
friends ever leak into the server bundle. Second, **access control**: the easy
version hides buttons in the UI; the brief wants it checked on the server. I wrote
`spec/access.test.ts` first, so a spectator acting, the wrong side acting, or a
player moving the opponent's unit all fail with 403, and the server — not the UI —
is what the test talks to.

## What's next

The game is playable end to end and deployed: a Three.js table (faction art as
standees, orbit camera, lighting and reflections, dice that roll on the board, a
battle log + player/audience chat, a hover stat inspector), both lobby modes with a
faithful Black Mass builder (Malice + dark-power upgrades), spectating, friends,
avatars and ELO, terrain the engine honours (walls, an elevated plateau with
stairs, hazards, adverse ground — cost-aware movement, cover, high-ground dice),
and upgrades that apply mechanically via a flag/patch system — over the
server-authoritative core, green across 40+ tests. The client is pure
presentation, exactly as planned.

Corpses, berserk, Doom's end-of-round-4 devil damage, and now Plague, Miracle,
Mutation and Stance have all landed mechanically (`spec/rules.test.ts`), and
games no longer auto-deploy — each side places its own units via a validated
server-side "deploy" action, with a client "deploy" phase (a bench of
unplaced units, click-to-select then click a highlighted edge-band tile) so a
fresh game is playable start to finish from the browser. Doom itself is still
partial: a unit can only clear it today by the round-4 check firing, since
clearing it early by slaying another unit needs attacker-tracking the engine
doesn't have yet. Mutation's token-substitution rule (discard in place of, or
stand in as a copy of, another token) needs a player-choice prompt the engine
has no hook for, so mutation tokens accumulate but aren't auto-substituted.
Stance's per-ability "special numbered round" overrides apply unconditionally
rather than gated to their stated round. None of this is silently dropped —
see `upgrades.ts`'s header. A permanent two-browser Playwright suite now
covers the full sign-up → lobby → deploy → combat loop against a real
browser (`e2e/`, kept outside `pnpm check` on purpose — see CLAUDE.md). The
next push is terrain *models* (the engine already honours terrain
mechanically) and a voice pass on these documents.
