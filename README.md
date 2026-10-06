# a small daily

> **This is a scaffold, not finished writing.** The brief marks `README.md` on
> *your* argument for what good means here (400–600 words, with sources), and
> warns that an agent-written version reads like the median and marks down.
> Replace the bracketed prompts with your own words and real citations, then
> delete this blockquote. It is published verbatim at `/readme/`.

A quiet place to reflect on your day — and to be seen by a friend. Each day you
answer one prompt for yourself and one about a friend. You read what a friend
wrote about you the next morning.

## What good means here

[Your thesis in a sentence or two. The draft position the app is built around:
good here is *private, unhurried, and reciprocal* — being thought about by a
friend, once a day, without the performance or the metrics of social media. Say
it in your own words, and say what "good" rules out.]

## Who it's for, and what it does

[Who is this for — a few friends? a pod? Name the circle. Then the core loop in
two or three sentences: sign up, get a self prompt and a friend prompt, write,
and read yesterday's note about you. Keep it to what matters.]

## What I chose not to build

[The brief says most of the work is in what you *don't* build. Name a few: no
public feed, no likes or counts, no streaks, no editing the past, no seeing a
note the instant it's written. Say why each absence serves the definition above.]

## What's enforced, and what's judged

Some of "good" is checked; some can only be felt.

- **Enforced** (in `spec/`, run by `pnpm check` against the live app):
  - privacy — no one reads another person's reflection (`spec/privacy.test.ts`)
  - the seal — a note stays hidden until the next day (`spec/reveal.test.ts`)
  - real-time — a friend request reaches an open session within ~1s
    (`spec/realtime.test.ts`)
- **Judged** (you decide at the crit whether it's true): whether the daily rhythm
  feels calm rather than demanding, whether being written about lands as warmth,
  whether the diary reads as a place you'd return to. [Add your own.]

The one multi-user behaviour decision this week — what travels live and what
waits — is written up in [`docs/adr-001-realtime-scope.md`](docs/adr-001-realtime-scope.md).

## Sources

[Cite what you actually read while deciding what good means — the brief points at
the small web, games made for a handful of friends, tools built for one workshop.
Add gratitude-/reflection-writing and "calm/slow" technology writing if you drew
on it. Real links, in your own framing.]
