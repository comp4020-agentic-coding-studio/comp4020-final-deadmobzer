# Faction data schema

One JSON file per House (`<house>.json`). Shape:

```jsonc
{
  "id": "carcass",
  "name": "C.A.R.C.A.S.S.",
  "blurb": "…",            // flavour, from the rulebook lore page
  "playstyle": "…",
  "accent": "#f000a8",      // House accent (from style sweep / art)
  "specialMechanic": { "name": "Formation", "text": "While adjacent to an ally, gain +1D on attacks." },
  "specialTags": { "Reload": "…", "Headshot": "…" },   // House tag glossary
  "necromancer": <Unit>,
  "units": [ <Unit>, … ]    // the 5 roster units
}
```

A `Unit`:

```jsonc
{
  "id": "gunwight",
  "name": "Gunwight",
  "type": "thrall",         // thrall|freak|scion|horror|hunter|tyrant|necromancer
  "mv": 2, "hp": 2, "df": 4, "arm": null,   // arm: null|"PHYS"|"MAG"|"SUPER"
  "large": false,            // 2x2 footprint (tyrants)
  "art": "units/carcass/gunwight.png",      // path under public/art/ (filled when art lands)
  "traits": [ { "name": "Formation", "text": "…" } ],
  "acts": [ <Ability> ],     // ACT abilities (one usable per turn)
  "souls": [ <Ability> ],    // necromancer SOUL abilities (cost in `soul`)
  "upgrades": [ { "name": "Brace", "text": "…" } ]   // 3 exclusive upgrades (faithful mode)
}
```

An `Ability` — `effect[]` is the engine-readable part; `text` is the faithful
rulebook wording shown in the hover inspector. The engine runs what it understands
and ignores the rest, so partial encodings are safe.

```jsonc
{
  "name": "OL45",
  "tags": ["attack", "ranged", "reload"],   // attack|curse|melee|ranged|self|line|splash|push|pull|reload|charge
  "range": [2, 3],          // [min,max]; omit for self; "melee" tag ⇒ adjacent only
  "text": "On hit: 1 piercing damage. Headshot: inflict 1 vulnerable",
  "effect": [               // ordered; applied on resolve
    { "op": "attack", "damage": 1, "damageType": "physical", "pierce": true },
    { "op": "onHeadshot", "then": [ { "op": "token", "token": "vulnerable", "n": 1, "target": "hit" } ] }
  ]
}
```

### `effect` op vocabulary (engine `src/game/engine.ts`)

- `attack` `{damage,damageType,pierce?,diceMod?}` — roll vs DF; hit ⇒ damage+onHit; graze ⇒ 1.
- `damage` `{damage,damageType,pierce?,target}` — direct, no roll.
- `token` `{token,n,target}` — apply strength|weak|vitality|vulnerable|slow|speed.
- `push`/`pull` `{n,target}` · `step` `{n,free?}` · `move`.
- `splash` `{center:"target"|"self", then:[…]}` · `line` `{len, then:[…]}`.
- `effectDie` `{threshold, then:[…]}` · `onHit` `{then:[…]}` · `onHeadshot` `{then:[…]}`.
- `reload` · `obliterateSelf` · `becomeCover` · `selfEffect` `{text}` (display-only flag).
- `target`: `"hit"` (the attacked unit), `"self"`, `"adjacentAlly"`, `"choose"` (in range).

Anything the engine doesn't recognise is carried for display and resolved as a
no-op with a battle-log note, so the faithful text always shows even when the
mechffect isn't simulated yet.
