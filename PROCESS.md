# Process

> The full running log this was condensed from, every phase and correction
> in the order it happened, is kept verbatim in
> [`PROCESS_LOG.md`](./PROCESS_LOG.md).

## The pivot

My first project was a daily reflection diary. It was calm and personal,
but it did not fit the brief's requirement for something genuinely
multi-user and real-time, a definition I have to justify myself. When I
talked it through with my tutor, Ushini, it became clear the diary's
real-time element was not load-bearing: two people almost never touched
the same state at the same time, and the only live event was a friend
request. Because journalling works best as something reflective rather
than something lived in real time, forcing the diary to be more
real-time to satisfy the brief would have conflicted with that belief.

So I dropped it (`26d506e`) and looked for a problem that was multi-user
by construction. I had the rulebook and full art archive for a tabletop
wargame on hand, *MAGNAGOTHICA Maleghast*, a 1v1 skirmish where two
necromancers raise a warband on an 8x8 grid and fight to the death. I was
also curious about a question adjacent to the brief: how much an agent
could do if handed a large, messy pile of real source material and told
to build from it. Recreating a full ruleset online is unavoidably a live
duel against a real opponent, so the pivot solved the brief and let me
test that question at once. `a716ace`, extracting the rulebook corpus, is
the first commit of the new project; everything after builds on it.

I define good here as a duel that is fair, legible, live, and faithful:
the server alone is authoritative over dice and combat, a full battle log
and named server logs make a match followable afterward, moves reach the
other player in about a second with no reload, and every stat comes from
the rulebook rather than from me.

## How I worked with the agent

On the diary project I directed the agent turn by turn, writing most of
the structure myself and keeping its context thin. Rebuilding a full
ruleset in a week called for the opposite on both counts.

I handed over the entire rulebook corpus up front, rather than feeding it
in piecemeal: the 58 MB PDF and the full unit-art archive. I also gave it
the designer's own balance notes. The agent's first phase was to extract
all of it to text and images once, into `data/`, rather than re-reading
it mid-build, which would have been slower and made every later answer
less precise.

I also used Plan Mode for the first time on this project. I had the agent
read the extracted rules and propose a full phased build order before
writing any application code. This went mostly smoothly. I pushed back on
the ordering twice and the agent adjusted both times without objection.
Only once the plan held together end to end did I let it start building.
These phase-numbered commits are that approved plan, executed one step at
a time rather than checked once at the end: `d4ff663` (engine), `9d48317`
(backend), `5ddd04e` (3D client), through to `4172635` (docs).

The same approach carried into later feature work. I would write one
instruction and let a background agent run with it. For the E2E suite,
the prompt I actually gave was: *"fan out subagenents to look into
creating an automated testing suite that opens 2 browser windows and
records a mock game with mocked user intereaction."* The agent fanned out
two research agents on its own initiative, one on approach and one on
feasibility, before building anything (the full exchange is in
`docs/PROMPT_LOG.md`). That log exists because I later asked the agent to
record every prompt verbatim next to the commit it produced, so I could
check what I actually asked for against what landed.

## Testing whether "good" was actually met

Because a green test suite doesn't guarantee a good game, I didn't stop
once `pnpm check` passed. I played a full match against myself, badly:
playing both sides of a tactical skirmish alone is difficult. Because a
browser is a different test of legible than paper, I checked whether the
battle log explained what had just happened, and whether deploying and
selecting units felt obvious without external instructions.

The bug I am most glad I found came from the server side rather than the
client. SOUL is a necromancer resource whose abilities had been defined
since early in the build but never actually wired up, so every SOUL
action silently failed. While implementing it, I checked how ability
targeting worked more generally and found a real fairness bug: nothing
checked unit ownership. A curse could be cast on your own unit, and a
support buff could land on the opponent's. This is a direct violation of
fair, the first word in my own definition of good, and it existed because
no test exercised it. I fixed it with an explicit ally-or-foe check used
by both the client's targeting UI and the server's re-validation, so a
client cannot route around it. Tracking this down also surfaced a second
bug: an existing combat test had been passing by accident, hitting what
looked like an enemy but was actually a friendly unit on an adjacent
tile. Because a correction with no trace in the harness hasn't really
happened, both went into `spec/rules.test.ts` as six new tests, not a
silent fix (`b5de9c5`).

The same reasoning, that a green checkmark should never be trusted alone,
is why access control has its own dedicated spec
(`spec/access.test.ts`, written before the feature existed) asserting the
server rejects a spectator or the wrong player, and why a build-time
check fails the bundle if Three.js or React leak into the server
(`c3b73e2`, added after the server-rendered UI had already crash-looped
the 256 MB machine once). Because a CSS-only change to the game screen's
layout could still break real interactions, I reran the full Playwright
e2e suite after restructuring it (`95fa9d2`) rather than assume it was
safe.

## Where it landed

The result is a deployed, playable game: a textured 3D table, a faithful
Black Mass deck builder, spectating, friends, ELO, terrain the engine
honours, and a server-authoritative core backed by over 40 tests. The
suite is green because everything that could quietly break fair, legible,
live, or faithful now has a test or a documented gap recording it.
