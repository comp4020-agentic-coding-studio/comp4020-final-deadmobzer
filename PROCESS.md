# Process

> The full running log this was condensed from — every phase, every
> correction, in the order it happened — is kept verbatim in
> [`PROCESS_LOG.md`](./PROCESS_LOG.md).

## The pivot

My first project was a daily reflection diary. It was calm, personal, and
almost entirely the wrong shape for this brief. The brief asks for something
genuinely multi-user and real-time, by a definition I have to defend myself —
and when I talked it through with my tutor, Ushini, it was clear the diary's
"real-time" element was an afterthought bolted onto an app where two people
almost never touch the same state at once. It also sat badly against
something I actually believe: journalling is reflective and mindful, not
something that benefits from being live. Forcing it to be "more real-time"
for the brief would have fought the thing itself.

So I dropped it (`26d506e`) and went looking for a problem that was
multi-user by construction. I had a tabletop wargame's rulebook and full art
archive sitting around — *MAGNAGOTHICA Maleghast*, a 1v1 skirmish where two
necromancers raise a warband on an 8×8 grid and fight to the death — and I
was curious about something adjacent to the brief: how much could an agent
do if handed a large, messy pile of real source material and told "make
this"? Recreating a whole ruleset online is unavoidably a live duel against a
real opponent, so the pivot solved the brief's problem and let me run that
experiment at once. `a716ace`, extracting the rulebook corpus, is the first
commit of the new project — everything else builds on what it produced.

I define *good* here as a duel that is **fair, legible, live, and faithful**:
the server alone is authoritative over dice and combat, a full battle log
and named server logs make a match followable after the fact, moves reach
the other player in about a second with no reload, and every stat comes
from the rulebook, not from me.

## How I worked with the agent

The diary project I'd directed turn-by-turn, writing most of the structure
myself and keeping the agent's context thin. Rebuilding a whole ruleset in a
week called for the opposite approach on both counts.

First, I handed over everything up front rather than feeding it in
piecemeal: the 58 MB rulebook PDF, the full unit-art archive, and the
designer's own balance notes. The agent extracted all of it to text and
images once, into `data/`, as its own first phase — not something re-read
from mid-build, which would have been slow and made every later answer a
little less precise.

Second, I used Plan Mode for the first time this project: I had the agent
read the extracted rules and propose a full phased build order before it
wrote any application code. It went mostly smoothly. I pushed back on the
ordering twice, the agent adjusted both times without a fight, and only once
the plan held together end to end did I let it start building. The
phase-numbered commits — `d4ff663` (engine), `9d48317` (backend),
`5ddd04e` (3D client), through `4172635` (docs) — are that approved plan,
executed and reviewed one step at a time rather than checked once at the end.

That same approach carried into later feature work: I'd write one
instruction and let a background agent run with it. For the E2E suite, the
actual prompt I gave was: *"fan out subagenents to look into creating an
automated testing suite that opens 2 browser windows and records a mock
game with mocked user intereaction."* The agent fanned out two research
agents on its own initiative — approach, then feasibility — before building
anything (`docs/PROMPT_LOG.md` has the full exchange). That log exists
because I later asked it to record every prompt verbatim next to the commit
it produced, so I could audit what I actually asked for against what landed.

## Testing whether "good" was actually met

A green test suite isn't the same as a good game, so I didn't stop at
"`pnpm check` passes." I sat down and played a full match against myself —
badly, by my own admission, since playing both sides of a tactical skirmish
solo is not easy — specifically to find out whether *legible* actually felt
legible from inside a browser, not just on paper: whether the battle log
explained what just happened, whether a selected unit's actions were
obvious, whether deploy made sense with no external instructions.

The catch I'm most glad I found came from the server side, not the client.
While wiring up SOUL — a necromancer resource whose abilities had been
defined since early in the build but never actually implemented, so every
SOUL action silently failed — I checked how ability targeting worked more
broadly and found a real fairness bug: nothing checked ownership. A curse
could be cast on your own unit; a support buff could land on the enemy's.
That's a direct violation of *fair*, the first word in my own definition of
good, sitting there because no existing test exercised it. I fixed it with
an explicit ally-vs-foe check used by both the UI's targeting and the
server's re-validation, so a client can't route around it. Chasing it down
also turned up a second bug: an existing combat test had been passing by
accident, hitting what looked like an enemy but was actually a friendly unit
on an adjacent tile. Both went into `spec/rules.test.ts` as six new tests,
not just a silent fix (`b5de9c5`), because a correction with no trace in the
harness didn't really happen.

The same instinct — don't trust the green checkmark alone — is why access
control has its own dedicated spec (`spec/access.test.ts`, written before
the feature existed) asserting the server rejects a spectator or the wrong
player; why a build-time purity assertion fails the bundle if Three.js or
React leak into the server (`c3b73e2`, after the server-rendered UI had
already crash-looped the 256 MB machine once); and why, late in the build, I
still reran the full Playwright e2e suite after restructuring the game
screen's layout (`95fa9d2`), rather than assuming a pure CSS change
couldn't break anything.

## Where it landed

The result is a deployed, playable game: a textured 3D table, a faithful
Black Mass deck builder, spectating, friends, ELO, terrain the engine
honours, and a server-authoritative core backed by 40+ tests — green not
because nothing was tested, but because everything that could quietly break
*fair*, *legible*, *live*, or *faithful* now has a test, a log line, or a
documented gap holding it to account.
