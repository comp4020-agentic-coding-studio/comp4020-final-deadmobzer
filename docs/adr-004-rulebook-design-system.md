# ADR 004 — A bespoke design system from the rulebook (no MUI)

## Status
Accepted.

## Context
The earlier app leaned on Material UI. For a faithful recreation, a generic design
kit fights the source material's gothic, blood-and-bone identity.

## Decision
Drop MUI/emotion. Derive the design language from the rulebook itself: fonts
(`pdffonts`: Metal Blackletter display, Impact stat labels, Georgia body) and a
palette sampled from rendered pages (bone `#f0f0f0`, ink, blood-red `#f00000`,
per-House accents), captured once into `data/style.json` + `docs/style-guide.md`.
The UI and the 3D scene both read those tokens.

## Consequences
- One source of truth for type and colour across the 2D UI and the 3D table.
- Smaller dependency surface and client bundle.
- The look is the game's own, which is part of what "faithful" means here.
