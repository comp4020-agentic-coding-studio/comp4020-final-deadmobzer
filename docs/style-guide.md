# Visual style guide — faithful to the Maleghast rulebook

Machine-readable tokens live in `data/style.json`. Two stylesheets read from
them: `public/app.css` (every page of the React SPA — Home, Play, a game
room, Friends, Profile) and `src/serverview.ts`'s inline `STYLE` constant (the
three pages that stay outside the SPA: landing/login/signup, How to Play, the
README/About page). They're deliberately kept separate rather than shared
across a server/client boundary, but should stay reconciled against the same
source tokens below — if they drift, fix the value against `data/style.json`,
not against whichever stylesheet looks "more current." This doc is the human
summary.

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

A House's accent is a real, visible variable in the 2D UI, not just data piped
into the 3D table's pawn tinting. Any page with a House in context (the Lobby
picker, Profile's avatar picker, Home once a House is set) sets a CSS custom
property, `--house`, inline from that faction's `accent` field
(`src/client/api.ts`'s `houseStyle()` helper), and a handful of shared rules in
`public/app.css` consume it:

- `.house-accent-rule` — border colour
- `.house-glow` — a soft box-shadow halo
- `.house-portrait` — the bordered portrait box itself
- `.sw.on` / `.avatar-sw input:checked + span` — the selected colour-swatch ring

Each falls back to the generic blood-red (`var(--house, var(--blood))`) when
no House is in context, so the same classes are safe to use on pages that
sometimes do and sometimes don't have one.

## Halftone texture

`.halftone` (`app.css`) and the inline `.hero::before` rule (`serverview.ts`'s
`STYLE`) lay a cheap, tileable dot-screen over a panel — two offset
`radial-gradient`s, no image asset — to echo the rulebook art's own print
texture (`public/art/portraits/*`, `public/art/units/*`: real halftone-printed
horror-comic art, not a generic gothic-fantasy illustration style). Used
deliberately on two hero surfaces (the landing page, Home's dossier) — not
globally. A texture on every panel stops reading as texture and starts
reading as wallpaper.

## Portrait paths

Every unit's portrait is `/art/portraits/<house>/<unit-id>.png` — **except**
the necromancer: `scripts/extract-art.py` always names that file
`necromancer.png`, regardless of the necromancer's own data id (Carcass's is
`operator`, for instance). Building a path straight from a unit id 404s for
every House's necromancer avatar. `src/client/api.ts`'s `portraitPath(house,
unitId, necromancerId)` is the one place that knows this — pass the faction's
`necromancer.id` (from `/api/factions`) as the third argument and it resolves
correctly either way. Don't construct `/art/portraits/...` paths by hand
elsewhere.

## Pressed-poster wordmark

Pirata One alone reads as a generic "gothic fantasy" web font choice. The
landing page's `<h1>` (`.poster-title`, `serverview.ts`'s `STYLE`) adds a
layered `text-shadow` (blood-red, then a darker red offset further) and a
slight `skewX`, so the display face reads closer to a pressed/printed
metal-poster wordmark — matching the actual rulebook cover's dripping
black-metal logo treatment — rather than a clean, generic web-font heading.
Reserved for the one hero headline; nav/section headings stay plain Pirata
One so the treatment doesn't dilute into decoration.
