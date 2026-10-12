# Harness — rules for working in this repo

These are the standards the agent's work must meet. They come from what "good"
means for this app (see `README.md`): a private, unhurried, reciprocal diary.
When something here and the README disagree, the README wins and this file is
wrong — fix it.

## Invariants the app must never break

- **Privacy.** A person can only ever read their own self-reflections. A
  friend-note can be read by its author and, once revealed, its target — no one
  else, ever. There is no endpoint that returns another user's reflection.
  (`spec/privacy.test.ts`.)
- **The seal.** A note written on a day is invisible to its target until the
  viewer's day has moved past it. The reveal rule lives in one place,
  `src/reveal.ts`; never inline a date comparison that bypasses it.
  (`spec/reveal.test.ts`.)
- **Real-time scope.** Relationship/presence events are live; reflection content
  is not. Don't push note contents over the WebSocket. See
  `docs/adr-001-realtime-scope.md`.
- **You write about the friend you were matched with.** Friend-note targets come
  from the day's assignment (`src/daily.ts`), never from client input.

## Fixed by the template — don't change

- `fly.toml`, `Dockerfile` shape (one machine, one `/data` volume, HTTP on
  `$PORT`), and the two shipped checks in `spec/invariants.test.ts` (`/` answers
  200; `/readme/` publishes `README.md`'s headings). Keep `invariants.test.ts`.
- `README.md` is published verbatim at `/readme/`; keep them in sync.

## How changes land

- Every check must stay reachable through `pnpm check`, run against the running
  app. Add new promises as `spec/*.test.ts` rather than asserting them in prose.
- Persisted state lives only under `/data` (SQLite). Nothing else survives a
  redeploy; don't rely on in-memory state across restarts except live sockets.
- Schema changes are additive and idempotent (`CREATE TABLE IF NOT EXISTS` /
  `ALTER` guards), because the app must boot from an empty volume (CI runs it
  with a throwaway `/data`).
- The view layer is **React + Material UI, server-rendered** (`src/ui`, hydrated
  by `src/client`). This is a deliberate reversal of the earlier "no frontend
  framework" rule, made for crit 10's redesign (Material UI, a floating bottom
  nav, full-screen light/dark). Two hard constraints make it safe rather than
  reckless, and must hold:
  - **Every GET route server-renders its full HTML.** The spec checks the raw
    HTML the server sends (it runs no JS), so a client-only SPA would break the
    shipped privacy/invariants checks. SSR lives in `src/ui/render.tsx`; the
    client only hydrates and enhances (instant nav, live social, theme toggle).
  - It must still **compile in the `Dockerfile` and fit the 256 MB machine**. No
    second service beside the app. The client bundle is built by
    `scripts/build.mjs` into `public/app.js` (gitignored); keep it lean (no
    `@mui/icons-material`).

## When the agent gets it wrong

Put the correction in the harness, not just a retry: a new `spec/` check, a rule
here, or a thrown-away attempt recorded in `PROCESS.md`. A fix with no trace in
the harness or the commits didn't really happen.
