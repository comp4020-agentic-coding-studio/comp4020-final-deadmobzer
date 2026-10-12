# Visual style guide — faithful to the Maleghast rulebook

Machine-readable tokens live in `data/style.json`; the UI (`src/ui/tokens.css`)
and the 3D scene both read from there. This doc is the human summary.

## Type

| Role | Rulebook font | Web face (self-hosted, `public/fonts/`) |
|------|---------------|------------------------------------------|
| Display / gothic (title, House & unit names) | Metal Blackletter | UnifrakturMaguntia / Pirata One |
| Stat labels (MV HP DF ARM) | Impact | Oswald / Anton |
| Body | Georgia (+ Bold/Italic) | Georgia (web-safe) |
| Incidental | Arial | system sans |

## Colour

- **Paper / bone:** `#f0f0f0` · **Ink:** `#000000` / soft `#181818`
- **Primary (blood red):** `#f00000`
- **Neutrals:** `#a8a8a8 #c0c0c0 #303030`
- **Accents present in the book:** `#f000a8 #9000f0 #f0c030 #f07818 #90f0d8 #00d848 #18f030`
- Some pages are inverted (dark) → the app supports a **dark theme**.

## Per-House accent

Carcass `#f000a8` · Deadsouls `#00a8a8` · Abhorrers `#f0c030` · Goregrinders,
Gargamox, Igorri sampled from their art during extraction.

> Note: the 16-colour **player** palette (pawn/avatar tint) is a separate, evenly
> spread set chosen for on-table legibility — distinct from these brand colours.
