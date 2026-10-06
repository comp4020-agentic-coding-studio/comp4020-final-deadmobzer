import type { User } from "./auth.ts";
import type { Friend, PendingRequest } from "./friends.ts";
import type { CalendarDay, ReceivedNote, SelfEntry } from "./entries.ts";
import type { DailyTask } from "./daily.ts";

export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function layout(title: string, body: string, user: User | null): string {
  return `<!doctype html>
<html lang="en-AU">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(title)}</title>
    <link rel="stylesheet" href="/static/style.css" />
  </head>
  <body>
    <header class="topbar">
      <a class="mark" href="/">a small daily</a>
      <nav>
        ${
          user
            ? `<a href="/calendar">calendar</a>
               <a href="/readme/">about</a>
               <span class="me">${esc(user.display_name)}</span>
               <form method="post" action="/logout"><button class="link">sign out</button></form>`
            : `<a href="/readme/">about</a>`
        }
      </nav>
    </header>
    <main>${body}</main>
    ${user ? `<script type="module" src="/static/app.js"></script>` : ""}
  </body>
</html>`;
}

function flashBanner(flash?: string): string {
  return flash ? `<p class="flash">${esc(flash)}</p>` : "";
}

export function landingPage(error?: string): string {
  const body = `
    <section class="paper narrow">
      <h1>a small daily</h1>
      <p class="lede">A quiet place to reflect on your day — and to be seen by a
      friend. Each day you answer one prompt for yourself and one about a friend.
      You read what a friend wrote about you the next morning.</p>
      ${error ? `<p class="flash error">${esc(error)}</p>` : ""}
      <div class="two-up">
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
      </div>
    </section>`;
  return layout("a small daily", body, null);
}

function promptBlock(
  kind: "self" | "friend",
  prompt: string,
  existing: SelfEntry | undefined,
): string {
  return `
    <form method="post" action="/entry" class="prompt">
      <input type="hidden" name="kind" value="${kind}" />
      <p class="prompt-text">${esc(prompt)}</p>
      <textarea name="body" rows="4" placeholder="Write freely…">${existing ? esc(existing.body) : ""}</textarea>
      <div class="prompt-foot">
        ${existing ? `<span class="saved">saved — you can refine it until midnight</span>` : "<span></span>"}
        <button type="submit">${existing ? "Update" : "Save"}</button>
      </div>
    </form>`;
}

export function socialPanel(friends: Friend[], incoming: PendingRequest[]): string {
  const reqs = incoming
    .map(
      (r) => `
      <li>
        <span>${esc(r.display_name)} <span class="muted">@${esc(r.username)}</span></span>
        <span class="row-actions">
          <form method="post" action="/friends/accept"><input type="hidden" name="friendship_id" value="${r.friendship_id}" /><button>accept</button></form>
          <form method="post" action="/friends/decline"><input type="hidden" name="friendship_id" value="${r.friendship_id}" /><button class="link">decline</button></form>
        </span>
      </li>`,
    )
    .join("");
  const fr = friends
    .map(
      (f) => `
      <li><span class="dot ${f.online ? "on" : ""}" title="${f.online ? "here now" : "away"}"></span>
        ${esc(f.display_name)} <span class="muted">@${esc(f.username)}</span></li>`,
    )
    .join("");
  return `
    ${incoming.length ? `<h3>Friend requests</h3><ul class="requests">${reqs}</ul>` : ""}
    <h3>Friends</h3>
    ${friends.length ? `<ul class="friends">${fr}</ul>` : `<p class="muted">No friends yet. Add one below — your friend prompt starts once they accept.</p>`}
    <form method="post" action="/friends/request" class="add-friend">
      <label>Add a friend <input name="username" placeholder="their username" required /></label>
      <button type="submit">Send request</button>
    </form>`;
}

export function homePage(args: {
  user: User;
  task: DailyTask;
  mine: Record<string, SelfEntry>;
  yesterday: ReceivedNote[];
  friends: Friend[];
  incoming: PendingRequest[];
  todayLabel: string;
  flash?: string;
}): string {
  const { user, task, mine, yesterday, friends, incoming, todayLabel, flash } = args;

  const reveal = yesterday.length
    ? `<section class="paper reveal">
         <h2>What a friend wrote about you</h2>
         ${yesterday
           .map(
             (n) => `<blockquote><p class="prompt-text">${esc(n.prompt_text)}</p>
                     <p>${esc(n.body)}</p><cite>— ${esc(n.author_name)}, yesterday</cite></blockquote>`,
           )
           .join("")}
       </section>`
    : `<section class="paper reveal quiet">
         <h2>What a friend wrote about you</h2>
         <p class="muted">Nothing from yesterday yet. Notes you're written appear here the next morning.</p>
       </section>`;

  const friendPrompt =
    task.friend_target_id !== null && task.friend_prompt_text
      ? promptBlock("friend", task.friend_prompt_text, mine["friend"])
      : `<div class="prompt"><p class="muted">No friend prompt today — add a friend and one arrives tomorrow.</p></div>`;

  const body = `
    <div class="diary">
      <section class="today">
        <p class="date">${esc(todayLabel)}</p>
        ${flashBanner(flash)}
        ${reveal}
        <section class="paper">
          <h2>For yourself</h2>
          ${promptBlock("self", task.self_prompt_text, mine["self"])}
        </section>
        <section class="paper">
          <h2>For a friend</h2>
          ${friendPrompt}
        </section>
      </section>
      <aside class="social" id="social">
        ${socialPanel(friends, incoming)}
      </aside>
    </div>`;
  return layout("Today — a small daily", body, user);
}

export function calendarPage(user: User, days: CalendarDay[]): string {
  const items = days.length
    ? days
        .map(
          (d) =>
            `<li><a href="/day?d=${encodeURIComponent(d.day)}">${esc(d.day)}</a>${
              d.has_note ? ` <span class="pill">a note for you</span>` : ""
            }</li>`,
        )
        .join("")
    : `<li class="muted">No entries yet — your reflections will gather here.</li>`;
  const body = `
    <section class="paper narrow">
      <h1>Your calendar</h1>
      <p class="muted">Every day you've written, newest first.</p>
      <ul class="calendar">${items}</ul>
    </section>`;
  return layout("Calendar — a small daily", body, user);
}

export function dayPage(
  user: User,
  day: string,
  detail: { self: SelfEntry | null; notes: ReceivedNote[] },
): string {
  const self = detail.self
    ? `<section class="paper"><h2>Your reflection</h2>
         <p class="prompt-text">${esc(detail.self.prompt_text)}</p><p>${esc(detail.self.body)}</p></section>`
    : `<section class="paper quiet"><p class="muted">You didn't write a reflection this day.</p></section>`;
  const notes = detail.notes.length
    ? detail.notes
        .map(
          (n) => `<section class="paper reveal"><h2>From ${esc(n.author_name)}</h2>
             <p class="prompt-text">${esc(n.prompt_text)}</p><p>${esc(n.body)}</p></section>`,
        )
        .join("")
    : "";
  const body = `
    <div class="diary single">
      <p><a href="/calendar">← calendar</a></p>
      <p class="date">${esc(day)}</p>
      ${self}
      ${notes}
    </div>`;
  return layout(`${day} — a small daily`, body, user);
}
