import { escapeHtml } from "./http.ts";

// Minimal, server-rendered HTML shell in the rulebook's design language (bone
// paper, blood-red, blackletter display). This backend-first build has no 3D
// client yet — the game is driven by the JSON API (and these pages). The real
// Three.js client replaces the app body in a later phase; this shell keeps the
// spec contract (/, /readme) and lets a human drive the API.
//
// No user content is ever interpolated without escapeHtml (no script injection).

const STYLE = `
  :root{--paper:#f0f0f0;--ink:#111;--blood:#f00000;--line:#000;}
  *{box-sizing:border-box}
  body{margin:0;background:var(--paper);color:var(--ink);
    font-family:Georgia,'Times New Roman',serif;line-height:1.5}
  header{background:var(--ink);color:var(--paper);padding:14px 20px;
    display:flex;align-items:center;gap:16px;flex-wrap:wrap}
  header .brand{font-weight:bold;letter-spacing:.06em;text-transform:uppercase;color:var(--blood)}
  header a{color:var(--paper);text-decoration:none;margin-right:12px}
  main{max-width:860px;margin:0 auto;padding:24px 20px}
  h1,h2,h3{font-family:Georgia,serif;letter-spacing:.02em}
  h1{border-bottom:3px solid var(--blood);padding-bottom:.2em}
  a{color:var(--blood)}
  .card{border:2px solid var(--line);padding:16px;margin:14px 0;background:#fff}
  label{display:block;margin:.5em 0 .2em;font-weight:bold}
  input,select,button,textarea{font:inherit;padding:.5em;border:1px solid var(--line)}
  button{background:var(--ink);color:var(--paper);cursor:pointer;border:none;padding:.6em 1em}
  button:hover{background:var(--blood)}
  .err{color:var(--blood);font-weight:bold}
  code{background:#eee;padding:.1em .3em}
`;

export function page(title: string, innerHtml: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} — Maleghast Online</title>
<style>${STYLE}</style></head>
<body>
<header><span class="brand">Maleghast Online</span>
  <a href="/">Home</a><a href="/play">Play</a><a href="/friends">Friends</a>
  <a href="/profile">Profile</a><a href="/readme/">About</a></header>
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
