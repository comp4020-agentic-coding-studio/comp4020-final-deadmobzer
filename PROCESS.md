# Process overview

> Rewritten (not appended) at the final submission; the brief wants ~900–1100
> words. Describes the project **as it stands now**.

## From the brief to the idea

The brief asks for a deployed, multi-user, real-time app that is *good* by a
definition I make and defend, and warns against the median answer — a chat
room with the nouns swapped. My first project, a daily reflection diary,
drifted toward that failure from the other side: the multi-user, real-time
requirement was bolted on, not load-bearing — two people almost never
touched the same state at once.

So I made a complete shift: **read the ruleset of a tabletop wargame and
recreate it online.** The game is *MAGNAGOTHICA Maleghast*, a 1v1 skirmish
where two necromancers fight on an 8×8 grid until one falls — multi-user by
construction, since the whole point is a live opponent across a shared
board.

The pivot changed how I briefed the agent, too. I handed it a large, messy
asset corpus up front — the rulebook PDF, the unit-art archive, the
designer's balance notes — betting that a faithful recreation needed the
real source material in the loop, not my paraphrase. Extraction became its
own first phase ([`a716ace`](../../commit/a716ace)) rather than something
reached for mid-build. I also worked in **Plan Mode** for the first time:
the agent proposed a phased build order before writing any code, and I
pushed back on the ordering twice before letting it start — the
phase-numbered commits are that plan, executed one step at a time.

## What good means, and how it shaped the build

I define good here as **a fair, legible, live duel against a real person,
faithful to the game it recreates.** Each word pushed a concrete decision:
*fair* → the server is the only authority, a client can ask but never decide;
*live* → a move reaches the other player within about a second, no reload;
*legible* → a visible battle log, and server logs that name both players;
*faithful* → stats, dice math and the six Houses come from the rulebook, not
from me. README states this and which claims `spec/` enforces; CLAUDE.md
turns the enforced ones into invariants.

## The stack, and why

One 256 MB Fly machine, one SQLite volume, a hand-rolled Node server with no
framework — the logic is small and I wanted no magic between a request and
the database. The game is a **pure engine over one serializable
`GameState`**: the server rolls from a seeded PRNG stored in the state, so
dice are deterministic and replayable, and the same code the server runs is
what the unit tests check. I dropped Material UI and derived the look from
the rulebook's own fonts and palette — a generic kit fought the source
material's identity.

The work landed in committed phases, each read before the next:
**extraction** ([`a716ace`](../../commit/a716ace), the rulebook swept to
text once, never re-read), **data as the source of truth**
([`1ad41a1`](../../commit/1ad41a1), [`1b1d77e`](../../commit/1b1d77e), all
six Houses and 36 units in JSON, each ability carrying an engine-readable
`effect[]` *and* the rulebook text), **a tested engine**
([`d4ff663`](../../commit/d4ff663), pure-function tests for rules the UI
can't see), and **the whole backend playable via API**
([`9d48317`](../../commit/9d48317): lobbies, games, chat, ELO, real-time
rooms, a strict CSP).

## Corrections that landed in the harness

A fix with no trace in the harness didn't really happen. Three moments
shaped the build that way: the **256 MB limit** (an earlier app had already
crash-looped from a heavy server-rendered UI, so a **build-time purity
assertion** now fails the build if Three.js or React leak into the server
bundle); **access control** (the brief wants it checked on the server, not
hidden in the UI — `spec/access.test.ts` talks to the server directly, so a
spectator acting or a player moving the opponent's unit fails with 403
regardless of what the UI allows); and **ownership-respecting targeting** (a
review pass found every ability's target picker ignored ally/foe entirely —
a curse could land on your own unit. Fixing it exposed a second, quieter
bug: an existing Stance test had been silently passing against the wrong
unit because two units happened to occupy adjacent tiles. Both are fixed;
`spec/rules.test.ts` grew six new ownership cases, not just the feature).

## From multi-page to single-page

Once Friends, Profile and Home existed as separate server-rendered pages
alongside the React lobby/table, the app had two navigation models at once:
a full-page reload for most links, client-side state for two. That split is
exactly the kind of inconsistency that lands someone somewhere they didn't
mean to go — a stale reload mid-navigation, a form bounce through a page no
one asked for. I converted Home, Play, the game room, Friends and Profile
into one client-routed app with a persistent nav, so a click always goes
exactly where it says. How to Play and the README stay plain server pages —
pure static content gains nothing from client routing, and `/readme/`'s
rendering is a fixed part of the spec contract I didn't want to touch.

## Spending the identity work already paid for

A late design pass compared the live app against the actual rulebook (a loud
red zine cover, halftone horror-comic art, six vivid per-House colours) and
found the UI looked like a generic dark dashboard instead — the accent
colours in `data/style.json` were computed during extraction but never
rendered. I wired them into one `--house` CSS variable used across the House
picker, the avatar picker and Home, and gave the landing page a featured
necromancer portrait instead of two identical login boxes. The pass also
caught two real bugs behind the first-draft look: the nav's CSS selector
could never match React's actual DOM nesting (unstyled since the SPA
conversion), and every necromancer avatar 404'd because the art pipeline
always names that file `necromancer.png` regardless of the unit's data id.

## What's next

The game is playable end to end and deployed: a Three.js table, both lobby
modes with a faithful Black Mass builder, spectating, friends, avatars, ELO,
terrain the engine honours, and upgrades via a flag/patch system — over a
server-authoritative core, green across 145 tests. SOUL abilities (10 of 12;
Will of God and Sample Genome are disclosed gaps, not silently dropped — see
`engine.ts`'s header) now spend the resource they accrue, instead of being
dead code. Doom only clears via the round-4 check, not early by slaying
another unit; Mutation's token-substitution needs a player-choice prompt the
engine has no hook for yet. A permanent two-browser Playwright suite
(`e2e/`) covers sign-up through combat against a real browser. The
avatar/House-colour treatment now reaches Friends too, the last surface the
design pass hadn't touched. Next: terrain *models*.
