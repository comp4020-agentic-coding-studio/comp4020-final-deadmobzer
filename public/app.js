// Keeps the social panel live. Relationship events arrive over the WebSocket;
// on each one we re-fetch authoritative state and re-render. Reflection content
// is never pushed here — it unseals the next day, by design.
const panel = document.getElementById("social");
if (panel) {
  const esc = (s) =>
    String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  function render(state) {
    const reqs = state.incoming
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
    const fr = state.friends
      .map(
        (f) => `
        <li><span class="dot ${f.online ? "on" : ""}" title="${f.online ? "here now" : "away"}"></span>
          ${esc(f.display_name)} <span class="muted">@${esc(f.username)}</span></li>`,
      )
      .join("");
    panel.innerHTML = `
      ${state.incoming.length ? `<h3>Friend requests</h3><ul class="requests">${reqs}</ul>` : ""}
      <h3>Friends</h3>
      ${state.friends.length ? `<ul class="friends">${fr}</ul>` : `<p class="muted">No friends yet. Add one below — your friend prompt starts once they accept.</p>`}
      <form method="post" action="/friends/request" class="add-friend">
        <label>Add a friend <input name="username" placeholder="their username" required /></label>
        <button type="submit">Send request</button>
      </form>`;
  }

  async function refresh() {
    try {
      const res = await fetch("/api/state", { headers: { accept: "application/json" } });
      if (res.ok) render(await res.json());
    } catch {
      /* offline; the server-rendered panel stays */
    }
  }

  function toast(text) {
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 4000);
  }

  function connect() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.addEventListener("message", (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.type === "friend_request") toast(`${msg.from} sent you a friend request`);
      if (msg.type === "friend_accepted") toast(`${msg.by} accepted your friend request`);
      refresh();
    });
    // Reconnect if the connection drops (e.g. the idle machine slept).
    ws.addEventListener("close", () => setTimeout(connect, 3000));
  }

  refresh();
  connect();
}
