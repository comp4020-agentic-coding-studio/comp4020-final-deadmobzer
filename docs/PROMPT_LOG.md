# Prompt log

`PROCESS.md` is the polished, word-capped (900–1100 words) narrative for
submission. This file is the uncapped trace of what was actually asked for and
what landed in response — the raw material `PROCESS.md` is distilled from.
Newest entries at the bottom.

---

**Prompt:** Continue through `PROCESS.md`'s "What's next" plan (plague,
Miracle, mutation, stance subsystems) and add manual deployment placement so
players choose unit starting positions before a match begins.
**Response:** Dispatched as a background agent (engine subsystems + manual
deploy backend). In progress — see task #4/#5 in the session task list.

**Prompt:** Remake the Black Mass builder to enforce limits client-side.
**Response:** `src/client/Lobby.tsx` now mirrors `src/loadouts.ts`'s
`validateLoadout()` slot-budget math client-side (slot costs, per-type limits,
Malice/upgrade budget), fed by a new `unitTypes`/`unitSlots` block on
`GET /api/factions` (`src/server.ts`). Covered by `spec/loadout.test.ts`.

**Prompt:** Add a "how to play" section and dice collision.
**Response:** Added a server-rendered `/how-to-play/` primer (`src/serverview.ts`,
linked from the navbar and the lobby), an in-game "?" quick-reference modal
(`src/client/Game.tsx`, `public/app.css`), and pairwise sphere-sphere collision
+ soft velocity swap for simultaneously-rolled dice (`src/three/table.ts`).

**Prompt:** Smoother UI/animation buffers to prevent flickering; develop an
automated testing suite to test all possible scenarios.
**Response:** Added a hover debounce (120ms clear-delay) in `src/client/Game.tsx`
so sweeping the cursor across standees doesn't flicker the hover panel. Expanded
`spec/` with `auth.test.ts`, `friends.test.ts`, `gameplay.test.ts`,
`howtoplay.test.ts`, `lobbies.test.ts`, `profile.test.ts` (56 new tests).
Diagnosed and fixed a better-sqlite3/Node native teardown race that crashed the
dev server under concurrent vitest load, by serializing spec-file execution
(`fileParallelism: false` in `vitest.config.ts`). Full suite: 110/110 passing.

**Prompt:** "fan out subagenents to look into creating an automated testing
suite that opens 2 browser windows and records a mock game with mocked user
intereaction"
**Response:** Fanned out two parallel research agents: (1) approach research —
recommended Playwright with a gated `window.__testHooks` client hook (so
Three.js-canvas clicks are deterministic instead of fragile pixel-raycasting),
a new top-level `e2e/` directory with its own `playwright.config.ts`, and a
`test:e2e` npm script kept deliberately out of `pnpm check`; (2) feasibility
spike — confirmed Playwright installs and runs cleanly in this environment
(headless Chromium, multi-context isolation, `.webm` video recording all
verified), added as a devDependency. Implementation not yet started — see
task #10.

**Prompt:** "remember to note all prompts into process, and add relevant
commits when changes are made. ask for reasoning if it is appropriate"
**Response:** Saved as a standing instruction (memory: this file's own
creation, plus a `feedback` memory). Asked the user how to reconcile this with
`PROCESS.md`'s 900–1100 word cap, since it was already over; they chose a
separate uncapped log file — this file. Going forward: every explicit user
prompt gets an entry here, and changes land in their own commits as they're
made rather than batched.

**Prompt:** Continue through `PROCESS.md`'s "What's next" plan (plague,
Miracle, mutation, stance subsystems) and add manual deployment placement so
players choose unit starting positions before a match begins.
**Response:** Background agent (`ae89765f625277b9e`) implemented all four
subsystems in `src/game/engine.ts`/`upgrades.ts`/`types.ts` (Plague, Miracle,
Mutation, Stance — see commit `a1ae3e6`) plus the manual-deploy backend
(`src/games.ts` no longer auto-deploys; `applyAction`'s `"deploy"` branch
validates placements atomically against the edge-band/occupancy rules). Its
own verification only ran `spec/rules.test.ts` (pure engine); integrating it
surfaced that the full `pnpm check` suite failed with `deploy failed (403)` —
not a bug in the agent's code, but because the local dev server had been
started as a plain `node src/server.ts` (no `--watch`) at some point earlier in
the session and so was silently serving pre-agent code the whole time. Killed
and restarted it as `pnpm dev` (`node --watch`) with `DATA_DIR=/tmp/maleghast-data`
so it live-reloads going forward; full suite then passed 121/121. Committed as
`a1ae3e6`. Manual-deployment client UI (task #5) is next — the client
(`Game.tsx`) has no "deploy" phase UI yet, so a freshly created game currently
has no way to place units from the browser.

Follow-up (same prompt, client half): dispatched a second background agent
(`ade8ab5d849e43623`) for the client UI. It added a "deploy" phase to
`Game.tsx` (a bench of not-yet-placed units; click one, then a highlighted
edge-band tile, to POST a `deploy` action), gave `table.ts`'s `highlightTiles`
a `"deploy"` (green) kind reusing the existing move/target mechanism, rendered
unplaced units off-board on a per-side bench instead of overlapping at the
unplaced sentinel, and found + fixed a real raycast-priority bug the bench
exposed (click/hover now compare actual ray-intersection distances instead of
always preferring a unit hit over a tile hit — bench standees could otherwise
sit nearer the camera than a tile the player meant to click).
`src/server.ts`'s `/api/factions` now also returns `deployFromEdgeSpaces` so
the client mirrors the engine's edge-band rule instead of duplicating the
number. Verified: `pnpm typecheck` clean, full `pnpm check` 121/121, `pnpm
build`'s purity assertion holds, and a throwaway two-browser-context
Playwright smoke test (real mouse clicks only, no test hooks, deleted after)
drove both sides through deployment to `"playing"`. Committed as `8311ec0`.
Both halves of this prompt (engine subsystems + manual deployment, backend and
client) are now fully landed.
