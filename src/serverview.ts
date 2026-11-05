import { escapeHtml } from "./http.ts";

// Minimal, server-rendered HTML shell in the rulebook's design language (bone
// paper, blood-red, blackletter display). This backend-first build has no 3D
// client yet — the game is driven by the JSON API (and these pages). The real
// Three.js client replaces the app body in a later phase; this shell keeps the
// spec contract (/, /readme) and lets a human drive the API.
//
// No user content is ever interpolated without escapeHtml (no script injection).

// Dark, gothic design language for the three pages still server-rendered
// (landing/login/signup, How to Play, the README/About page — everything
// else, once signed in, is the React SPA and reads from public/app.css
// instead; see that file's header comment). Tokens match data/style.json:
// ink_soft #181818 for the dark theme, #303030 as the sampled neutral used
// for borders/lines. Pirata One display, Oswald labels, Georgia body.
const STYLE = `
  :root{--paper:#f0f0f0;--ink:#181818;--panel:#15151a;--blood:#f00000;--line:#303030;
    --display:'Pirata One','UnifrakturMaguntia',serif;
    --label:'Oswald','Arial Narrow',sans-serif;
    --body:Georgia,'Times New Roman',serif;}
  *{box-sizing:border-box}
  body{margin:0;background:var(--ink);color:var(--paper);font-family:var(--body);line-height:1.5}
  header{background:#000;color:var(--paper);padding:14px 20px;
    display:flex;align-items:center;gap:16px;flex-wrap:wrap;border-bottom:2px solid var(--blood)}
  header .brand{font-family:var(--display);font-size:1.4rem;letter-spacing:.04em;color:var(--blood)}
  header a{color:var(--paper);text-decoration:none;margin-right:12px;
    font-family:var(--label);text-transform:uppercase;font-size:.9rem;letter-spacing:.05em}
  header a:hover{color:var(--blood)}
  main{max-width:860px;margin:0 auto;padding:24px 20px}
  h1,h2,h3{font-family:var(--display);letter-spacing:.02em;font-weight:400}
  h1{border-bottom:3px solid var(--blood);padding-bottom:.2em}
  a{color:var(--blood)}
  .card{border:1px solid var(--line);padding:16px;margin:14px 0;background:var(--panel);border-radius:4px}
  label{display:block;margin:.5em 0 .2em;font-family:var(--label);text-transform:uppercase;
    font-size:.85rem;letter-spacing:.04em;color:#bbb}
  input,select,textarea{font:inherit;padding:.5em;background:#1c1c22;color:var(--paper);
    border:1px solid var(--line);border-radius:3px}
  button{font-family:var(--label);text-transform:uppercase;letter-spacing:.04em;
    background:var(--panel);color:var(--paper);cursor:pointer;border:1px solid var(--line);
    padding:.6em 1em;border-radius:3px}
  button:hover{background:var(--blood);border-color:var(--blood)}
  .err{color:#ff6b6b;font-weight:bold}
  code{background:#000;padding:.1em .3em;border-radius:2px}
  form{margin:.3em 0}
`;

// Shown only on the one remaining fully server-rendered page (landing/login/
// signup) and linked to from the SPA's own persistent nav (src/client/App.tsx)
// on How to Play / About — a navbar inside a page those two land on from a
// hard link would otherwise look like a dead end without one.
const HEADER = `<header><span class="brand">Maleghast Online</span>
  <a href="/">Home</a><a href="/play">Play</a><a href="/how-to-play/">How to Play</a>
  <a href="/friends">Friends</a><a href="/profile">Profile</a><a href="/readme/">About</a></header>`;

export function page(title: string, innerHtml: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} — Maleghast Online</title>
<link rel="stylesheet" href="/fonts/fonts.css">
<style>${STYLE}</style></head>
<body>
${HEADER}
<main>${innerHtml}</main>
</body></html>`;
}

export function landing(error?: string): string {
  return page("Sign in", `
    <h1>Maleghast Online</h1>
    <p>A faithful, real-time 1v1 recreation of the tabletop skirmish wargame
       <em>Magnagothica Maleghast</em>. Sign in to raise your Black Mass.</p>
    ${error ? `<p class="err">${escapeHtml(error)}</p>` : ""}
    <div class="card">
      <h2>Sign in</h2>
      <form method="post" action="/login">
        <label>Username</label><input name="username" autocomplete="username">
        <label>Password</label><input name="password" type="password" autocomplete="current-password">
        <p><button type="submit">Sign in</button></p>
      </form>
    </div>
    <div class="card">
      <h2>Create an account</h2>
      <form method="post" action="/signup">
        <label>Username</label><input name="username">
        <label>Display name</label><input name="display_name">
        <label>Password</label><input name="password" type="password" autocomplete="new-password">
        <p><button type="submit">Create account</button></p>
      </form>
    </div>`);
}

export function aboutPage(readmeHtml: string): string {
  return page("About", readmeHtml);
}

// A concise, server-rendered rules primer distilled from data/rules.json and the
// rulebook corpus (data/raw/) — not a dump of either. Terms match what's printed
// on unit cards (DF, ARM, MV, HP) so a new player can map this page straight onto
// the table.
export function howToPlay(): string {
  return page("How to Play", `
    <h1>How to Play</h1>
    <p>Two necromancers raise a Black Mass and fight on an 8×8 grid until one
       necromancer falls. The server rolls every die and enforces every rule —
       this page is the short version of what it's enforcing.</p>

    <h2>Setup &amp; the Black Mass</h2>
    <ul>
      <li>Pick a House (one of six). Each House has a necromancer plus a roster of
          units you build into a <strong>Black Mass</strong>.</li>
      <li>In faithful mode your roster fills a budget of <strong>5 unit slots</strong>:
          thralls cost 0.5 slots (2 per slot), tyrants are capped at 1, and the other
          types each cost 1 slot with their own per-House limits.</li>
      <li>Spend <strong>Malice</strong> (a dark-power budget from 0 up to 12) on
          upgrades — one per unit type, except at Ultrahell, which allows two.</li>
    </ul>

    <h2>Deployment</h2>
    <p>Winner of the initiative roll (1d6, re-roll ties) chooses who acts and
       deploys first. Each side deploys on opposite edges of the board, placing
       units up to 2 spaces in from their edge.</p>

    <h2>Turn Structure</h2>
    <p>Units activate one at a time, alternating sides, until every unit on the
       board has gone once — that's a round. On its turn a unit may MOVE then ACT
       (in either order), or forgo ACT to MOVE twice. The next round starts with
       whichever side didn't act last.</p>

    <h2>Combat &amp; Dice</h2>
    <ul>
      <li>Attacks roll a <strong>dice pool</strong>: start with 1d6, add or
          subtract dice for bonuses/penalties, roll them all and take the
          <strong>highest</strong>. If the pool would drop to 0 or below, roll 2
          dice and take the <strong>lowest</strong> instead.</li>
      <li>Meeting or beating the target's <strong>DF</strong> is a hit (full
          damage plus on-hit effects); falling short is a <strong>graze</strong>
          — 1 damage of the attack's type, no armor-ignore, no effect die.</li>
      <li>Armor (<strong>ARM</strong>) comes in three flavours: PHYS reduces
          physical damage, MAG reduces magical damage (toxic/fire/curse/holy),
          and SUPER reduces both — armor doesn't stack. <strong>Pierce</strong>
          ignores armor entirely. <strong>Devil</strong> damage ignores armor,
          can't be boosted or reduced, and obliterates a unit it reduces to 0 HP
          (no corpse, no SOUL, no on-slain triggers).</li>
    </ul>

    <h2>Tokens</h2>
    <ul>
      <li><strong>Strength</strong> — +1 damage dealt, then discard one.</li>
      <li><strong>Weak</strong> — -1 damage dealt, then discard one.</li>
      <li><strong>Vitality</strong> — -1 damage taken, then discard one.</li>
      <li><strong>Vulnerable</strong> — +1 damage taken, then discard one.</li>
      <li><strong>Slow</strong> — MOVE at most 1 space, then discard one.</li>
      <li><strong>Speed</strong> — MOVE +2 spaces, then discard one.</li>
      <li><strong>Berserk</strong> — fuels House-specific rage effects (see your
          unit's traits/acts).</li>
      <li><strong>Doom</strong> — 4 devil damage at the end of round 4 unless
          cleared first by slaying another unit.</li>
    </ul>

    <h2>Terrain</h2>
    <ul>
      <li><strong>Wall</strong> — blocks movement and line of sight, gives cover;
          2 HP, auto-hit when attacked.</li>
      <li><strong>Elevated</strong> — costs +1 MOVE to enter from the ground;
          attacks from elevated ground gain +1D, attacks against it suffer -1D.</li>
      <li><strong>Hazard</strong> — 1 damage, ignoring armor, on entering or
          starting a turn there.</li>
      <li><strong>Adverse</strong> — costs +1 MOVE to exit.</li>
      <li><strong>Stairs</strong> — skips the elevation entry cost.</li>
    </ul>

    <h2>SOUL</h2>
    <p>Necromancers gather +1 SOUL at the start of each round from round 2 (max
       6), plus +1 the first time one of their units is slain (not obliterated).
       Spend SOUL on SOUL abilities — they don't use your ACT, and a unit may use
       at most one SOUL ability per turn.</p>

    <h2>Victory</h2>
    <p>A side loses the instant its necromancer is slain. If both necromancers
       are still standing when round 6 ends, the match is a draw.</p>
  `);
}

// The SPA shell: a full-viewport mount for the client bundle (React + Three.js).
// Every authenticated page serves this same shell now (src/client/App.tsx's
// wouter router renders the right page and its own persistent nav
// client-side) — the one exception is the 3D game room, which App.tsx itself
// keeps full-bleed (no nav) by route, not by a server-side flag here anymore.
export function appShell(title: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} — Maleghast Online</title>
<link rel="stylesheet" href="/fonts/fonts.css">
<link rel="stylesheet" href="/static/app.css">
</head><body class="app-body">
<div id="app">Loading…</div>
<script type="module" src="/static/app.js"></script>
</body></html>`;
}
