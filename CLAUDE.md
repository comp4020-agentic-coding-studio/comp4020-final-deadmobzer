# Harness — rules for working in this repo

These are the standards the agent's work must meet. They come from what "good"
means for this app (see `README.md`): a fair, legible, live, faithful 1v1 duel.
When something here and the README disagree, the README wins and this file is
wrong — fix it.

## Invariants the app must never break

- **The server is the only authority.** All game state lives in `GameState` and is
  mutated only by the pure engine in `src/game/engine.ts`. Dice are rolled
  server-side from a seeded PRNG stored in the state (`src/game/prng.ts`); the
  client only ever *animates* results the server already decided. Never let a client
  report an outcome. (`spec/rules.test.ts`.)
- **Access is checked on the server.** Only a game's two participants may act, only
  on **their own** units, and only **on their turn**. Everyone else is a read-only
  spectator. This is enforced in `src/games.ts` (`act`/`roleOf`), not in the UI.
  (`spec/access.test.ts` — the crit-10 contract.)
- **Who-did-what is logged, server-side, by name.** Every sign-in and state change
  emits one `audit …` line naming the actor (`src/audit.ts`); a whole match is
  followable from `flyctl logs` alone. The logging outlives the crit.
- **No script injection.** User text (chat, names) is only ever rendered as text —
  escaped on output (`escapeHtml`), never `dangerouslySetInnerHTML`, with a strict
  CSP on every response (scripts `'self'`, no inline). Store raw, escape on output.
  (`spec/security.test.ts`.)
- **It persists.** The full `GameState` is serialized to SQLite under `/data` on
  every action (`src/games.ts`), so a game survives a restart/redeploy. Nothing else
  survives; don't rely on in-memory state except live sockets. (`spec/persistence.test.ts`.)
- **Faithful to the rulebook.** Stats and abilities come from `data/factions/*.json`
  and the rules from `data/rules.json`, extracted from the rulebook corpus in
  `data/raw/`. Don't invent numbers; change the data, not the engine, to re-balance.

## Fixed by the template — don't change

- `fly.toml`, the `Dockerfile` shape (one machine, one `/data` volume, HTTP on
  `$PORT`), and the two shipped checks in `spec/invariants.test.ts` (`/` answers
  200; `/readme/` publishes `README.md`'s headings). Keep `invariants.test.ts`.
- `README.md` is published in full at `/readme/`; keep them in sync.
- Schema changes are additive and idempotent (`CREATE TABLE IF NOT EXISTS` /
  guarded `ALTER` via `ensureColumn`), because the app boots from an empty volume.

## Keep the server light (the lesson already paid for)

Server-rendering a heavy UI graph crash-looped the 256 MB machine once already.
So: Three.js, anime.js, cannon-es, React and fonts are **client-only**, bundled
into `public/app.js`; the server emits a plain-HTML contract and never imports
them. `scripts/build.mjs` has a purity assertion that fails the build if they leak
into `dist/server.js`. Keep the client bundle lean.

## Visual design follows the rulebook

The look is derived from the rulebook, not a generic UI kit (MUI was removed). Type
and colour tokens live in `data/style.json` (fonts via `pdffonts`, palette sampled
from the PDF); the UI and the 3D scene read from there so the whole app shares one
source of truth. See `docs/style-guide.md` and
`docs/adr-004-rulebook-design-system.md`.

## How changes land

- Every check stays reachable through `pnpm check`, run against the running app.
  Add new promises as `spec/*.test.ts`, not prose.
- When the agent gets it wrong, put the correction in the harness — a new `spec/`
  check, a rule here, or a thrown-away attempt recorded in `PROCESS.md`. A fix with
  no trace in the harness or the commits didn't really happen.
