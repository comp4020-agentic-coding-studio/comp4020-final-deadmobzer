# a small daily

A quiet place to reflect on your day and to stay close to the people who matter.
Each day you answer one prompt for yourself and one about a friend, and the next
morning you read what a friend wrote about you.

## Who it's for

This is for close friends and family — the small circle of people you actually
want to stay connected to, not an audience. It isn't built to grow, go viral, or
collect strangers. It works best with the handful of people whose day you
genuinely care about.

## What good means here

Good, for this app, is about two feelings: gratitude and connection. It's good
if, over time, it helps people feel noticed and gives them a small, honest moment
of reflection in the day.

That's deliberately hard to measure from a single visit. You can't really tell
whether this app is good by clicking around for ten minutes — you'd have to live
with it for a week or two and see whether the daily rhythm actually makes you feel
more connected to your friends. So I treat most of "good" here as something judged
over time, not something proven in one session.

## What I chose not to build

I deliberately left out instant notifications and the big, buzzing real-time
features you'd expect from a social app. There are no likes, no counts, no feeds,
and no streaks pushing you to come back.

I did this on purpose, to protect the feeling of mindfulness and ritual. The app
is meant to be a snapshot in time — something you sit with once a day — not
another stream demanding your attention. The one thing that is immediate is
connecting with people (friend requests); everything you write is sealed and
revealed the next day, so there's a reason to come back tomorrow rather than
refresh now.

## What shaped it

The main inspiration is my own work journal — a habit I started so that, each
week, I feel like I've done something of significance. I wanted that same small,
grounding ritual, but pointed at the people around me instead of just my work.

The format also borrows from Snapchat and Instagram stories: the idea of a
snapshot in time, a moment that belongs to a single day rather than living forever
in a feed.

## What's enforced, and what's judged

Some of "good" is checked by tests; some can only be felt.

- **Enforced** (in `spec/`, run by `pnpm check` against the live app): privacy —
  no one reads another person's reflection; the seal — a note stays hidden until
  the next day; real-time — a friend request reaches an open session within about
  a second.
- **Judged** (the part that needs a week, not a click): whether the daily rhythm
  feels calm rather than demanding, and whether being written about actually lands
  as gratitude and connection.

The decision about what travels live and what waits is written up in
[`docs/adr-001-realtime-scope.md`](docs/adr-001-realtime-scope.md).
