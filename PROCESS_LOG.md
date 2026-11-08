# Process overview

> This is the full running log kept during the build — the complete record,
> kept in order, of everything done and why, preserved verbatim here once it
> outgrew the course's ~900–1100 word submission cap. The condensed narrative
> written for submission lives in `PROCESS.md`; nothing below was trimmed or
> rewritten to make room for it.

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

## Making SOUL real, and the targeting bug it surfaced

A pass through the data layer found SOUL was dead code: `Action` had always
defined `{ kind: "soul" }`, every necromancer accrued the resource, but
`applyAction`'s switch never handled it, so any soul action fell through to
"unknown action." I implemented 10 of the 12 SOUL abilities with real
engine-readable `effect[]` entries, wired a new `case "soul"` into
`applyAction` (bypassing the normal turn gate, since the rulebook says a
necromancer can use SOUL on either side's turn), and tracked "one SOUL
ability per unit-turn" per side rather than as one shared flag. Will of God
and Sample Genome are disclosed as structural gaps rather than silently
dropped — see the header comment at the top of `engine.ts`'s SOUL section,
same pattern as the existing Doom/Mutation/Stance disclosures.

While building this I checked `legalTargets`/`pickTarget` for how ability
targeting worked and found every faction's abilities ignored ownership
entirely — a curse could land on your own unit, a support buff on the
opponent's, because `pickTarget` only ever excluded the caster, not the
wrong side. I fixed this with a `wantsAlly()` helper that reads an ability's
own effect data to decide ally-vs-foe, used consistently in
`legalTargets`, `pickTarget` and the raw-POST re-validation path so a client
can't bypass the UI's filtering by posting coordinates directly. Fixing it
surfaced a second, quieter bug: an existing Stance test in
`spec/rules.test.ts` had been passing by accident — the "foe" it hit was
actually a friendly unit that happened to occupy the adjacent tile, and the
old no-ownership-check code hit it anyway. Six new ownership tests went into
`spec/rules.test.ts` alongside the fix for both.

## Converting to a single-page app

Once Friends, Profile and Home existed as separate server-rendered pages
next to the React lobby/table, the app had two navigation models running at
once: most links did a full page reload, two pages kept client state. I
wanted this fixed specifically because a split model like that is how a
user ends up somewhere they didn't mean to go — a stale reload losing
in-progress state, a form submission bouncing through a page no one asked
for, a "back" button behaving differently depending on which half of the
app you were just in. I converted Home, Play, the game room, Friends and
Profile into one client-routed app (`src/client/App.tsx`, a small router
using `wouter`) with a persistent nav rendered once outside the router, so
a click always goes exactly where it says, with no second network
round-trip in between. How to Play and the README stay plain server
pages on purpose: they're pure static content with no interactivity to
gain from client routing, and `/readme/`'s exact rendering is part of the
spec's fixed contract, so I left it alone rather than risk it for no
benefit. This needed one new JSON endpoint (`GET /api/friends`, since the
friends list previously only existed as server-rendered HTML) and reused
the per-user WebSocket that was already pushing friend-request events
server-side but had no client listener.

## Spending the identity work the extraction pipeline already paid for

I compared the live app against the actual rulebook — a loud red zine
cover, halftone horror-comic art, six vivid per-House colours — and the UI
looked like a generic dark dashboard by comparison. The accent colours in
`data/style.json` were computed during the original extraction phase but
never rendered anywhere in the 2D UI; only the 3D table's pawn tinting used
colour at all, and that's a separate, intentional 16-colour palette, not
these brand colours. I wired the House accents into one reusable `--house`
CSS variable, consumed by a handful of shared classes (`.house-accent-rule`,
`.house-glow`, `.house-portrait`) across the House picker, the avatar
picker, and Home, and gave the landing page a featured necromancer portrait
(rotating daily, deterministic) instead of two identical login boxes.

This pass caught two real bugs hiding behind the generic first-draft look,
not just missing decoration: the persistent nav's CSS selector
(`.app-body > header`) could never match, because React mounts into a `#app`
div nested inside `.app-body`, not as its direct child — so the nav had
been unstyled (default blue links, no layout) since the SPA conversion,
and I'd missed it because the dark background alone made the page look
plausible at a glance. I fixed the selector to a descendant match. Second,
every necromancer avatar/portrait reference 404'd, because
`scripts/extract-art.py` always names that one file `necromancer.png`
regardless of the necromancer's own data id (Carcass's is `operator`, for
instance) — I added a shared `portraitPath()` helper in `src/client/api.ts`
that special-cases this everywhere a portrait path gets built, instead of
leaving each call site to construct the path by hand and get it wrong.

Finally I extended the same avatar/House-colour treatment to the Friends
page, the one surface the design pass hadn't reached — `friendsOf`,
`incomingRequests` and `recentOpponents` now return each person's avatar
fields, and the Friends list shows a small portrait + House-coloured name
for every friend, incoming request and recent opponent, the same identity
treatment already on Home/Play/Profile.

## Floating HUD, a textured board, and a houses wiki

The game room still looked like the rest of the app's first draft: a fixed
340px sidebar next to the 3D board, and flat untextured tile colours with no
texture mapping anywhere except unit portraits. I replaced the sidebar with a
floating HUD — the board now renders full-bleed, with the status strip,
ability/SOUL panels, the deploy bench, End Turn, and the battle log/chat all
anchored over it at fixed positions (`position: fixed`, not draggable) instead
of boxed into a side column. None of the underlying content markup changed —
`.statusline`, `.panel`, `.acts`, `.bench`, `.tabs`, `.feed` are all the exact
same elements, just regrouped under new anchor wrappers — so the existing
Playwright e2e suite's selectors and `window.__testHooks` kept working
unmodified; I reran `pnpm test:e2e` after the change to confirm rather than
assume it.

For the board itself, I stayed consistent with this project's rule that
visual design comes from the rulebook's own art, not stock textures or a
generic UI kit. I wrote a one-off script (`scripts/extract-board-texture.py`,
the same Pillow-based convention as the existing `extract-art.py`) that crops
two small patches out of the rulebook's own MISC art dump: a halftone
dot-screen from the "Six Lower Houses" splash page for the light tiles, and a
scuffed dark background from the "Rot in Hell" banner for the dark tiles —
both hand-picked to avoid any stray linework or text bleeding into the crop.
`table.ts`'s `buildBoard()` now loads these as `map` textures (the same
`THREE.TextureLoader` pattern already used for unit portraits) with a `color`
tint layered on top so the light/dark checkerboard contrast survives, plus a
small additive fill light since a textured surface read too flat in shadow
under the single warm key light. The raycast-picking structure
(`tileMeshes`/`userData`) didn't need to change at all — only the tile
materials did.

Finally, a new read-only `/wiki` page (`src/client/Wiki.tsx`) gives every
House's full build info in one browsable place: necromancer stats, traits,
and the complete SOUL ability list (otherwise only visible in-game, never
browsable outside a live match), plus every unit's full upgrade text for
planning a custom Black Mass loadout — something the in-lobby builder can't
show at once since it only has room for the upgrade you're currently
picking. It reuses `/api/factions` (no new backend data) and the existing
`portraitPath()`/`houseStyle()` helpers rather than inventing new mechanisms.
I registered `/wiki` as an open route, before the session-required gate —
the same tier as `/readme/` and `/how-to-play/` — since it's pure reference
content with no personalization, and without that a hard refresh or a shared
link would 404 even though client-side routing handles it fine on a soft
navigation.
