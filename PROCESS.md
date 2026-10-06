# Process overview

<!-- First draft from the author's own answers. The brief wants ~900–1100 words
     at submission; the <!-- EXPAND --> notes mark where to go deeper. Cite
     commits as links whose text is the short hash. -->

## From the brief to the idea

The brief asked for a multi-user, real-time website that's good, and warned
against the median answer — a chat room with the nouns swapped. I didn't want to
build that. A chat room asks for a lot of your attention and gives you a stream
you have to keep up with. I wanted the opposite: something that takes only a tiny
bit of time out of your day, that's easy to fit into your life, and that leaves
you feeling more connected rather than more online.

So I landed on a daily reflection diary. Each person answers one prompt about
their own day and one about a friend, and reads what a friend wrote about them the
next morning. The idea came from my own work journal — a habit I keep so that each
week I feel I've done something that matters — and from the "snapshot in time"
format of Snapchat and Instagram stories. I wanted that ritual, aimed at the
people I care about.

## What good means, and how it shaped the build

I decided good here means gratitude and connection, which is hard to measure in a
single sitting — you'd need a week or two of living with it. That pushed me away
from features that chase engagement (notifications, feeds, counts, streaks) and
toward a calm, once-a-day ritual.

## The stack

I built it on Node with WebSockets and SQLite. Node gave me straightforward
package management and a simple way to add WebSockets for the real-time part. I
wanted to avoid front-end JavaScript as much as possible, so the app is
server-rendered — plain HTML from the server, with only a little client-side
script for the live parts — rather than a single-page app or something built on
jQuery. I used SQLite for storage because it suits a small, single-machine app
with one volume and needs no separate database service.

The trade-off I accepted is that this runs on one small machine (256 MB) with a
single `/data` volume, no separate database, and no front-end build. That doesn't
feel right for a real release — ideally each "circle", or net of people, would get
its own container rather than everyone sharing one machine and one database — but
it's good enough for a prototype I can stand up in a week and keep iterating on.
For now, the simplicity is worth more than the headroom.

Part of the stack choice, honestly, was trusting the recommended default so I
could get to a working MVP quickly and spend the week iterating on the idea rather
than the plumbing.

## Decisions I made

Two decisions were mine to make and defend.

**Guaranteed reciprocity.** When the app matches people for the day's "friend"
prompt, I chose a model where everyone is written about, rather than a purely
random one where some people might get nothing. Everyone deserves to feel wanted
and noticed, and an app about connection shouldn't leave someone unseen.

**What's live and what waits.** Friendships happen in real time — a request
reaches you right away — but the reflections are sealed until the next day. I
wanted it to work like that: the daily reveal is what brings people back each
morning. Real-time was part of the assignment spec rather than something the app
needed everywhere, so I used it where it genuinely helps (connecting with people)
and kept it away from the writing, which is meant to be unhurried. This is written
up as an architecture decision record in
[`docs/adr-001-realtime-scope.md`](docs/adr-001-realtime-scope.md).

## Working with the agent

This week, working with the agent felt like an act of trust. Because I came in with
a plan and a clear idea of what I wanted — the concept, the feeling, and the
decisions above — I didn't need to redirect it much. The thinking was front-loaded
into the plan, so most of the week's work was the agent turning that plan into a
working MVP while I steered its shape, rather than me catching it going the wrong
way. My goal throughout was something I could prototype and then iterate on across
the rest of the week.

One concrete correction: a bug where the daily prompts were being stored keyed by
the user's id instead of the date. We caught it by reading the database directly
rather than trusting that the happy path worked, and fixed it. The privacy, seal,
and real-time promises are now pinned by checks in `spec/` so they can't quietly
break later.

## What's next

<!-- EXPAND for the final submission: what you'd change before the deadline. -->

Before the deadline I want to put the README fully in my own voice, add crit 10's
server-side logging, and act on whatever the crit surfaces. Longer term, I'd like
to develop this into a mobile app.
