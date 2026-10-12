import type { AppProps, PageData, SelfEntry } from "./ui/types.ts";

// The server stays deliberately light: it renders plain HTML (no React, no MUI,
// no Emotion on the server — that whole module graph needs ~200 MB resident,
// which doesn't fit the 256 MB machine). This HTML carries the published
// contract the spec checks, works with JavaScript off, and is replaced by the
// full Material UI app once src/client mounts in the browser (see src/ui/App).

export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function titleFor(page: PageData): string {
  switch (page.route) {
    case "today":
      return "Today — a small daily";
    case "calendar":
      return "Calendar — a small daily";
    case "day":
      return `${page.day} — a small daily`;
    case "friends":
      return "Friends — a small daily";
    case "about":
      return "About — a small daily";
    case "landing":
      return "a small daily";
  }
}

function promptForm(kind: "self" | "friend", prompt: string, existing: SelfEntry | undefined): string {
  return `<form method="post" action="/entry" class="card">
    <input type="hidden" name="kind" value="${kind}" />
    <p class="prompt">${esc(prompt)}</p>
    <textarea name="body" rows="4" placeholder="Write freely…">${existing ? esc(existing.body) : ""}</textarea>
    <div class="row"><span>${existing ? "saved — you can refine it until midnight" : ""}</span>
      <button type="submit">${existing ? "Update" : "Save"}</button></div>
  </form>`;
}

function bodyFor(page: PageData): string {
  switch (page.route) {
    case "landing":
      return `<section class="col">
        <h1>a small daily</h1>
        <p class="muted">A quiet place to reflect on your day — and to be seen by a friend.
        Each day you answer one prompt for yourself and one about a friend. You read what a
        friend wrote about you the next morning.</p>
        ${page.error ? `<p class="flash">${esc(page.error)}</p>` : ""}
        <form method="post" action="/login" class="card">
          <h2>Sign in</h2>
          <label>Username <input name="username" autocomplete="username" required /></label>
          <label>Password <input name="password" type="password" autocomplete="current-password" required /></label>
          <button type="submit">Sign in</button>
        </form>
        <form method="post" action="/signup" class="card">
          <h2>New here</h2>
          <label>Username <input name="username" autocomplete="username" required /></label>
          <label>Display name <input name="display_name" /></label>
          <label>Password <input name="password" type="password" autocomplete="new-password" required /></label>
          <button type="submit">Create account</button>
        </form>
      </section>`;

    case "today": {
      const reveal = page.yesterday.length
        ? page.yesterday
            .map(
              (n) =>
                `<blockquote><p class="prompt">${esc(n.prompt_text)}</p><p>${esc(n.body)}</p>
                 <cite>— ${esc(n.author_name)}, yesterday</cite></blockquote>`,
            )
            .join("")
        : `<p class="muted">Nothing from yesterday yet. Notes you've written appear here the next morning.</p>`;
      const friendPrompt =
        page.task.friend_target_id !== null && page.task.friend_prompt_text
          ? promptForm("friend", page.task.friend_prompt_text, page.mine.friend)
          : `<div class="card"><p class="muted">No friend prompt today — add a friend and one arrives tomorrow.</p></div>`;
      return `<section class="col">
        <p class="date">${esc(page.todayLabel)}</p>
        ${page.flash ? `<p class="flash">${esc(page.flash)}</p>` : ""}
        <section class="card reveal"><h2>What a friend wrote about you</h2>${reveal}</section>
        <h3>For yourself</h3>${promptForm("self", page.task.self_prompt_text, page.mine.self)}
        <h3>For a friend</h3>${friendPrompt}
      </section>`;
    }

    case "calendar": {
      const items = page.days.length
        ? page.days
            .map(
              (d) =>
                `<li><a href="/day?d=${encodeURIComponent(d.day)}">${esc(d.day)}</a>${
                  d.has_note ? ` <span class="pill">a note for you</span>` : ""
                }</li>`,
            )
            .join("")
        : `<li class="muted">No entries yet — your reflections will gather here.</li>`;
      return `<section class="col"><h1>Your calendar</h1>
        <p class="muted">Every day you've written, newest first.</p>
        <ul class="list">${items}</ul></section>`;
    }

    case "day": {
      const self = page.self
        ? `<section class="card"><h2>Your reflection</h2>
           <p class="prompt">${esc(page.self.prompt_text)}</p><p>${esc(page.self.body)}</p></section>`
        : `<p class="muted">You didn't write a reflection this day.</p>`;
      const notes = page.notes
        .map(
          (n) =>
            `<section class="card reveal"><h2>From ${esc(n.author_name)}</h2>
             <p class="prompt">${esc(n.prompt_text)}</p><p>${esc(n.body)}</p></section>`,
        )
        .join("");
      return `<section class="col"><p><a href="/calendar">← calendar</a></p>
        <p class="date">${esc(page.day)}</p>${self}${notes}</section>`;
    }

    case "friends": {
      const reqs = page.incoming
        .map(
          (r) =>
            `<li><span>${esc(r.display_name)} <span class="muted">@${esc(r.username)}</span></span>
             <span class="actions">
               <form method="post" action="/friends/accept"><input type="hidden" name="friendship_id" value="${r.friendship_id}" /><button>accept</button></form>
               <form method="post" action="/friends/decline"><input type="hidden" name="friendship_id" value="${r.friendship_id}" /><button class="link">decline</button></form>
             </span></li>`,
        )
        .join("");
      const fr = page.friends
        .map(
          (f) =>
            `<li><span class="dot ${f.online ? "on" : ""}"></span> ${esc(f.display_name)} <span class="muted">@${esc(f.username)}</span></li>`,
        )
        .join("");
      return `<section class="col"><h1>Friends</h1>
        ${page.flash ? `<p class="flash">${esc(page.flash)}</p>` : ""}
        ${page.incoming.length ? `<h3>Friend requests</h3><ul class="list">${reqs}</ul>` : ""}
        <h3>Friends</h3>
        ${page.friends.length ? `<ul class="list">${fr}</ul>` : `<p class="muted">No friends yet. Add one below — your friend prompt starts once they accept.</p>`}
        <form method="post" action="/friends/request" class="card">
          <label>Add a friend <input name="username" placeholder="their username" required /></label>
          <button type="submit">Send request</button>
        </form></section>`;
    }

    case "about":
      return `<article class="readme col">${page.html}</article>`;
  }
}

// A small fallback stylesheet: makes the no-JS page and the brief pre-mount paint
// legible, on the right background for the theme. The real UI is Material UI,
// rendered by the client once app.js loads.
const fallbackCss = `
  *{box-sizing:border-box} body{margin:0}
  .col{max-width:620px;margin:0 auto;padding:2rem 1.25rem 6rem}
  .card{border-radius:14px;padding:1.25rem 1.4rem;margin:0 0 1.25rem}
  h1{font-size:1.9rem;margin:.2rem 0 .6rem} h2{font-size:1.2rem;margin:0 0 .6rem}
  h3{font-size:.78rem;text-transform:uppercase;letter-spacing:.09em;opacity:.7;margin:1.4rem 0 .5rem}
  .muted{opacity:.7} .prompt{font-style:italic} .date{opacity:.7;text-transform:uppercase;letter-spacing:.04em}
  textarea,input{width:100%;font:inherit;padding:.6rem .7rem;border-radius:10px;border:1px solid rgba(128,128,128,.35);background:transparent;color:inherit}
  label{display:block;margin:0 0 .7rem;opacity:.8} .row{display:flex;justify-content:space-between;align-items:center;margin-top:.6rem}
  button{font:inherit;cursor:pointer;border:0;border-radius:10px;padding:.5rem .9rem;background:#8a6d4b;color:#fff}
  button.link{background:none;color:inherit;text-decoration:underline}
  a{color:#8a6d4b} ul.list{list-style:none;padding:0} ul.list li{padding:.4rem 0}
  .dot{display:inline-block;width:.55rem;height:.55rem;border-radius:50%;background:#888} .dot.on{background:#6fae6f}
  .reveal{outline:1px dashed rgba(128,128,128,.4)} .pill{font-size:.75rem;opacity:.7}
  .actions{display:inline-flex;gap:.4rem} .actions form{display:inline}
  .readme pre{overflow-x:auto}
`;

export function renderDocument(props: AppProps): string {
  const dark = props.mode === "dark";
  const bg = dark ? "#000000" : "#ffffff";
  const fg = dark ? "#ece7df" : "#2b2622";
  const data = JSON.stringify({ user: props.user, mode: props.mode, page: props.page }).replace(
    /</g,
    "\\u003c",
  );

  return `<!doctype html>
<html lang="en-AU" style="color-scheme:${props.mode}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(titleFor(props.page))}</title>
    <style>${fallbackCss}</style>
  </head>
  <body style="margin:0;background:${bg};color:${fg};font-family:'Iowan Old Style','Palatino Linotype',Palatino,Georgia,serif;line-height:1.6">
    <div id="root">${bodyFor(props.page)}</div>
    <script>window.__DATA__=${data}</script>
    <script type="module" src="/static/app.js"></script>
  </body>
</html>`;
}
