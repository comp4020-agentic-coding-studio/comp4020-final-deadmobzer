# ADR 003 — Faithful stats via a one-time rulebook extraction

## Status
Accepted.

## Context
"Good" here includes faithfulness to the tabletop game. The stats and rules live
only inside a 58 MB, art-heavy rulebook PDF; the plain-text notes carry no numbers.

## Decision
Sweep the whole rulebook to text once (`scripts/extract-corpus.sh` → `data/raw/`)
and work from that, never re-reading the PDF. Structure it into `data/rules.json`
(the combat system) and `data/factions/*.json` (per-unit MV/HP/DF/ARM, abilities,
upgrades). The engine is a small interpreter over this data: abilities carry an
engine-readable `effect[]` plus the faithful rulebook `text`, so re-balancing means
editing data, not code, and the exact wording is always available to the inspector.

## Consequences
- All six canonical Houses (36 units) are encoded from the source.
- Where a mechanic isn't simulated yet, the faithful text still shows and the engine
  logs it rather than silently dropping it.
- The PDF is read exactly once; everything downstream is fast and cacheable.
