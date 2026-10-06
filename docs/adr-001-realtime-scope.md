# ADR 001 — What is real-time, and what waits

Status: accepted (crit 9, "All at once")

## Context

The final project must be real-time: a change one person makes appears in every
other open session within about a second. Crit 9 asks for one decision, one level
up from the transport, about how the app behaves when several people use it at
once — and for the reasoning behind it.

This app ("a small daily") is a reflection diary. Each day you answer one prompt
for yourself and one about a friend, and you read what a friend wrote about you
**the next morning**. The exchange is meant to be unhurried: being thought about,
then waiting a day to read it, is the point.

That sits in tension with "real-time". If a friend's note about you popped up the
instant they saved it, the app would become a live feed — the thing it is trying
not to be.

## Decision

**Relationship and presence events travel live; reflection content does not.**

- Live over WebSocket, within ~1s, no reload:
  - a friend request appearing for the person who received it
  - a request being accepted, appearing for the person who sent it
  - coarse presence — whether a friend has a session open right now
- Deliberately **not** live: the note someone writes about you. It is sealed
  until the next day and only then revealed (`src/reveal.ts`, enforced in
  `src/entries.ts` and checked in `spec/reveal.test.ts`).

## Options considered

1. **Notes live the moment they're written.** Simplest "real-time" story, and
   what an agent builds unprompted. Rejected: it turns a slow, reciprocal ritual
   into a chat feed and removes the next-morning reveal that the whole app is
   built around.
2. **Reveal fires live at the midnight rollover.** Keeps the seal but pushes the
   unsealing in real time. Rejected for now: it rewards sitting in the app at
   midnight, the opposite of the once-a-day rhythm, and adds a scheduler the
   single machine doesn't otherwise need.
3. **Only relationship/presence events are live (chosen).** The parts of the app
   that *are* about the present moment — who wants to connect, who's around — move
   immediately; the part that is about reflection stays on its daily clock.

## Consequences

- The real-time requirement is met by a surface (friendship, presence) where
  immediacy genuinely helps, so the feature earns its place rather than being
  bolted on.
- Less instant gratification from the core writing loop — on purpose. The cost is
  that a first-time visitor doesn't see anything "live" happen until they add a
  friend; presence and the request flow are what demonstrate real-time at the
  crit.
- Two conflicting edits to the same thing barely arise: each person writes their
  own entries, and the one shared object — a friendship — is a simple
  request/accept state machine, so "who wins" never comes up.

## The counter-argument (for the pod)

The strongest case against this is that a reflection app being written *for*
other people should let you feel the connection as it happens — seeing "a friend
is writing about you right now" could be lovely, and the next-day reveal could
coexist with a live "someone's thinking of you" nudge. That's option 2's
territory, and it's a reasonable place to disagree.
