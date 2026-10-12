import { escapeHtml } from "./http.ts";

// Minimal, server-rendered HTML shell in the rulebook's design language (bone
// paper, blood-red, blackletter display). This backend-first build has no 3D
// client yet — the game is driven by the JSON API (and these pages). The real
// Three.js client replaces the app body in a later phase; this shell keeps the
// spec contract (/, /readme) and lets a human drive the API.
//
// No user content is ever interpolated without escapeHtml (no script injection).

// One dark, gothic design language shared by every page (server-rendered and the
// React SPA via app.css, which mirrors these tokens). Pirata One display, Oswald
// labels, Georgia body; bone text on near-black, blood-red accent.
const STYLE = `
  :root{--paper:#f0f0f0;--ink:#0b0b0d;--panel:#15151a;--blood:#f00000;--line:#2a2a30;
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
  .avatar{width:120px;height:120px;object-fit:cover;border-radius:50%;border:2px solid var(--line)}
  .swatches{display:flex;flex-wrap:wrap;gap:6px;margin:.3em 0}
  .sw{cursor:pointer}
  .sw input{position:absolute;opacity:0}
  .sw span{display:inline-block;width:26px;height:26px;border-radius:50%;border:2px solid #000}
  .sw input:checked + span{outline:3px solid var(--blood)}
  form{margin:.3em 0}
`;

// The one navbar, identical on every page.
const HEADER = `<header><span class="brand">Maleghast Online</span>
  <a href="/">Home</a><a href="/play">Play</a><a href="/friends">Friends</a>
  <a href="/profile">Profile</a><a href="/readme/">About</a></header>`;

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

// The app shell: a full-viewport mount for the client bundle (React + Three.js).
// `header` adds the shared navbar (lobby); the full-screen game omits it. Same
// dark theme as the server pages. CSP allows scripts only from 'self'.
export function appShell(title: string, opts: { header?: boolean } = {}): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} — Maleghast Online</title>
<link rel="stylesheet" href="/fonts/fonts.css">
<style>${STYLE}</style>
<link rel="stylesheet" href="/static/app.css">
</head><body class="app-body">
${opts.header ? HEADER : ""}
<div id="app">Loading…</div>
<script type="module" src="/static/app.js"></script>
</body></html>`;
}
