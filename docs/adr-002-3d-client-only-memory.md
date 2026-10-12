# ADR 002 — Heavy UI and 3D stay client-only (256 MB)

## Status
Accepted.

## Context
The app runs on one 256 MB Fly machine. A previous iteration server-rendered a
heavy UI graph and crash-looped under memory pressure. The new app adds a 3D table
(Three.js, physics dice), which is far heavier still.

## Decision
Three.js, anime.js, cannon-es, React and fonts are **client-only**, bundled into
`public/app.js`. The server emits a plain-HTML contract and imports none of them.
`scripts/build.mjs` carries a purity assertion that fails the build if any of them
resolve into `dist/server.js`.

## Consequences
- The server process stays small (~75–90 MB) and well under the limit.
- The 3D cost is paid in the browser, where there's room for it.
- A regression that accidentally imports a client lib on the server fails CI rather
  than crash-looping in production.
