import { createServer, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { db } from "./db.ts";
import {
  AuthError, createSession, destroySession, login, signup, userForToken, type User,
} from "./auth.ts";
import {
  acceptRequest, declineRequest, FriendError, friendsOf, incomingRequests, sendRequest,
} from "./friends.ts";
import { readmeBodyHtml } from "./readme.ts";
import { handleUpgrade, isOnline, sendTo, broadcastGame, audienceCount } from "./realtime.ts";
import {
  clearSessionCookie, escapeHtml, html, json, readCookie, readFormBody, readJsonBody,
  redirect, setSessionCookie,
} from "./http.ts";
import { landing, page, aboutPage, appShell } from "./serverview.ts";
import { audit } from "./audit.ts";
import { today, TZ } from "./time.ts";
import { FACTIONS, PLAYER_PALETTE, allUnitDefs } from "./game/data.ts";
import { validateLoadout, saveLoadout, getLoadout, maliceLevels, LoadoutError, type Mode } from "./loadouts.ts";
import { createLobby, joinLobby, quickJoin, openLobbies, lobbyGameId, LobbyError } from "./lobbies.ts";
import { gameView, act, recentOpponents, activeGames, GameError } from "./games.ts";
import { postMessage, messagesFor, ChatError, type Channel } from "./chat.ts";
import { getProfile, setAvatar, ProfileError } from "./profile.ts";
import type { Action } from "./game/types.ts";

const PORT = Number(process.env.PORT ?? 8080);

function currentUser(req: { headers: { cookie?: string } }): User | null {
  return userForToken(readCookie(req.headers.cookie, "sid"));
}

// A strict CSP on every response: scripts only from our own origin, never inline,
// so even a missed escape can't execute injected script (see CLAUDE.md).
function securityHeaders(res: ServerResponse): void {
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",
  );
  res.setHeader("X-Content-Type-Options", "nosniff");
}

const MIME: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".json": "application/json",
};

async function serveStatic(res: ServerResponse, rel: string): Promise<void> {
  if (rel.includes("..")) return void res.writeHead(404).end();
  try {
    const file = await readFile(new URL(`../public/${rel}`, import.meta.url));
    res.writeHead(200, { "Content-Type": MIME[extname(rel)] ?? "application/octet-stream" });
    res.end(file);
  } catch {
    res.writeHead(404).end("not found");
  }
}

// Resolve a saved-or-inline loadout for an action, validating server-side. If the
// request carries a House, it's validated and saved as the default for that mode.
function resolveLoadout(userId: number, body: Record<string, unknown>) {
  const mode = (body.mode === "faithful" ? "faithful" : "fixed") as Mode;
  if (body.house) {
    const l = validateLoadout(mode, String(body.house), String(body.colour ?? ""),
      Array.isArray(body.units) ? (body.units as { defId: string }[]) : [],
      body.malice ? String(body.malice) : undefined,
      (body.upgrades && typeof body.upgrades === "object") ? (body.upgrades as Record<string, string>) : undefined);
    saveLoadout(userId, l);
    return l;
  }
  const saved = getLoadout(userId, mode);
  if (!saved) throw new LoadoutError("No saved loadout for this mode — build one first.");
  return saved;
}

function msg(e: unknown): string {
  if (e instanceof LoadoutError || e instanceof LobbyError || e instanceof GameError) return e.message;
  return "failed";
}

// Chat messages with bodies + names HTML-escaped for safe client rendering.
function messagesForEscaped(id: string, channel: Channel) {
  return messagesFor(id, channel).map((m) => ({
    ...m, displayName: escapeHtml(m.displayName), body: escapeHtml(m.body),
  }));
}

const server = createServer(async (req, res) => {
  try {
    securityHeaders(res);
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const path = url.pathname;
    const method = req.method ?? "GET";

    // --- static roots ---
    for (const prefix of ["/static/", "/art/", "/fonts/", "/models/"]) {
      if (method === "GET" && path.startsWith(prefix)) {
        const root = prefix === "/static/" ? "" : prefix.slice(1);
        return void (await serveStatic(res, root + path.slice(prefix.length)));
      }
    }

    const user = currentUser(req);

    // --- README, published in full (required by the spec), open to all ---
    if (method === "GET" && (path === "/readme" || path === "/readme/")) {
      return void html(res, aboutPage(readmeBodyHtml()));
    }

    // --- auth (open) ---
    if (path === "/login" && method === "POST") {
      const f = await readFormBody(req);
      try {
        const u = login(f.get("username") ?? "", f.get("password") ?? "");
        setSessionCookie(res, createSession(u.id));
        audit(u.username, "login");
        return void redirect(res, "/");
      } catch (e) {
        return void html(res, landing(e instanceof AuthError ? e.message : "Sign in failed."), 401);
      }
    }
    if (path === "/signup" && method === "POST") {
      const f = await readFormBody(req);
      try {
        const u = signup(f.get("username") ?? "", f.get("password") ?? "", f.get("display_name") ?? "");
        setSessionCookie(res, createSession(u.id));
        audit(u.username, "signup");
        return void redirect(res, "/");
      } catch (e) {
        return void html(res, landing(e instanceof AuthError ? e.message : "Sign up failed."), 400);
      }
    }
    if (path === "/logout" && method === "POST") {
      destroySession(readCookie(req.headers.cookie, "sid"));
      clearSessionCookie(res);
      if (user) audit(user.username, "logout");
      return void redirect(res, "/");
    }

    // --- open API: faction data (for the loadout builder / hover inspector) ---
    if (path === "/api/factions" && method === "GET") {
      return void json(res, {
        palette: PLAYER_PALETTE,
        malice: maliceLevels(),
        factions: Object.values(FACTIONS).map((f) => ({
          id: f.id, name: f.name, blurb: f.blurb, playstyle: f.playstyle, accent: f.accent,
          necromancer: f.necromancer, units: f.units,
        })),
      });
    }

    // --- everything below needs a session ---
    if (!user) {
      if (path === "/" && method === "GET") return void html(res, landing());
      if (path.startsWith("/api/")) return void json(res, { error: "sign in" }, 401);
      return void redirect(res, "/");
    }

    // ---- HTML pages (minimal shell; the 3D client comes later) ----
    if (path === "/" && method === "GET") {
      const p = getProfile(user.id)!;
      return void html(res, page("Home", `
        <h1>Welcome, ${escapeHtml(user.display_name)}</h1>
        <div class="card"><p>Rating (ELO): <strong>${p.elo}</strong></p>
          <p><a href="/play">Find a match</a> · <a href="/profile">Profile</a> ·
             <a href="/friends">Friends</a></p>
          <form method="post" action="/logout"><button>Sign out</button></form></div>`));
    }
    // The interactive app (React + Three.js): lobby + the 3D table.
    if (path === "/play" && method === "GET") return void html(res, appShell("Play"));
    if (path.startsWith("/g/") && method === "GET") return void html(res, appShell("Table"));
    if (path === "/profile" && method === "GET") {
      return void html(res, profilePage(user));
    }
    if (path === "/profile/avatar" && method === "POST") {
      const f = await readFormBody(req);
      const [house, unit] = (f.get("avatar") ?? ":").split(":");
      try { setAvatar(user.id, house, unit, f.get("colour") ?? ""); } catch { /* ignore invalid */ }
      return void redirect(res, "/profile");
    }
    if (path === "/friends" && method === "GET") {
      return void html(res, friendsPage(user, url.searchParams.get("msg") ?? undefined));
    }
    if (path === "/friends/request" && method === "POST") {
      const f = await readFormBody(req);
      try {
        const to = sendRequest(user, f.get("username") ?? "");
        sendTo(to.id, { type: "friend_request", from: user.display_name });
        audit(user.username, "friend.request", { to: to.username });
        return void redirect(res, "/friends?msg=" + encodeURIComponent("Request sent."));
      } catch (e) { return void redirect(res, "/friends?msg=" + encodeURIComponent(e instanceof FriendError ? e.message : "Could not send.")); }
    }
    if (path === "/friends/accept" && method === "POST") {
      const f = await readFormBody(req);
      try {
        const o = acceptRequest(user.id, Number(f.get("friendship_id")));
        sendTo(o.id, { type: "friend_accepted", by: user.display_name });
        audit(user.username, "friend.accept", { with: o.username });
      } catch { /* ignore */ }
      return void redirect(res, "/friends");
    }
    if (path === "/friends/decline" && method === "POST") {
      const f = await readFormBody(req);
      try { declineRequest(user.id, Number(f.get("friendship_id"))); } catch { /* ignore */ }
      return void redirect(res, "/friends");
    }

    // ---- JSON API ----
    if (path === "/api/profile" && method === "GET") return void json(res, getProfile(user.id));
    if (path === "/api/profile/avatar" && method === "POST") {
      const b = await readJsonBody(req);
      try { setAvatar(user.id, String(b.house), String(b.unit), String(b.colour)); return void json(res, { ok: true }); }
      catch (e) { return void json(res, { error: e instanceof ProfileError ? e.message : "bad avatar" }, 400); }
    }
    if (path === "/api/loadout" && method === "GET") {
      const mode = (url.searchParams.get("mode") === "faithful" ? "faithful" : "fixed") as Mode;
      return void json(res, getLoadout(user.id, mode));
    }
    if (path === "/api/loadout" && method === "POST") {
      const b = await readJsonBody(req);
      try {
        const l = validateLoadout((b.mode === "faithful" ? "faithful" : "fixed") as Mode,
          String(b.house), String(b.colour ?? ""), Array.isArray(b.units) ? (b.units as { defId: string }[]) : [],
          b.malice ? String(b.malice) : undefined,
          (b.upgrades && typeof b.upgrades === "object") ? (b.upgrades as Record<string, string>) : undefined);
        saveLoadout(user.id, l);
        return void json(res, { ok: true, loadout: l });
      } catch (e) { return void json(res, { error: e instanceof LoadoutError ? e.message : "bad loadout" }, 400); }
    }

    if (path === "/api/lobby/create" && method === "POST") {
      const b = await readJsonBody(req);
      try {
        const l = resolveLoadout(user.id, b);
        const code = createLobby(user.id, l.mode, b.visibility === "private" ? "private" : "public", l);
        return void json(res, { code });
      } catch (e) { return void json(res, { error: msg(e) }, 400); }
    }
    if (path === "/api/lobby/join" && method === "POST") {
      const b = await readJsonBody(req);
      try {
        const l = resolveLoadout(user.id, b);
        return void json(res, joinLobby(String(b.code ?? ""), user.id, l));
      } catch (e) { return void json(res, { error: msg(e) }, 400); }
    }
    if (path === "/api/quickjoin" && method === "POST") {
      const b = await readJsonBody(req);
      try {
        const l = resolveLoadout(user.id, b);
        return void json(res, quickJoin(user.id, l.mode, l));
      } catch (e) { return void json(res, { error: msg(e) }, 400); }
    }
    if (path === "/api/lobbies" && method === "GET") {
      const m = url.searchParams.get("mode");
      return void json(res, { lobbies: openLobbies(m === "faithful" || m === "fixed" ? m : undefined) });
    }
    const lobbyMatch = /^\/api\/lobby\/([A-Za-z0-9]+)$/.exec(path);
    if (lobbyMatch && method === "GET") {
      return void json(res, { gameId: lobbyGameId(lobbyMatch[1]) });
    }

    // friends (JSON)
    if (path === "/api/friends/request" && method === "POST") {
      const b = await readJsonBody(req);
      try {
        const to = sendRequest(user, String(b.username ?? ""));
        sendTo(to.id, { type: "friend_request", from: user.display_name });
        audit(user.username, "friend.request", { to: to.username });
        return void json(res, { ok: true });
      } catch (e) { return void json(res, { error: e instanceof FriendError ? e.message : "failed" }, 400); }
    }
    if (path === "/api/friends/accept" && method === "POST") {
      const b = await readJsonBody(req);
      try {
        const o = acceptRequest(user.id, Number(b.friendship_id));
        sendTo(o.id, { type: "friend_accepted", by: user.display_name });
        audit(user.username, "friend.accept", { with: o.username });
        return void json(res, { ok: true });
      } catch (e) { return void json(res, { error: e instanceof FriendError ? e.message : "failed" }, 400); }
    }
    if (path === "/api/friends/decline" && method === "POST") {
      const b = await readJsonBody(req);
      try { declineRequest(user.id, Number(b.friendship_id)); } catch { /* already gone */ }
      return void json(res, { ok: true });
    }
    if (path === "/api/recent-opponents" && method === "GET") {
      return void json(res, { opponents: recentOpponents(user.id) });
    }
    if (path === "/api/games/active" && method === "GET") {
      return void json(res, { games: activeGames() });
    }

    // games: /api/game/<id>, /api/game/<id>/action, /api/game/<id>/chat
    const gameMatch = /^\/api\/game\/([A-Za-z0-9_-]+)(\/action|\/chat)?$/.exec(path);
    if (gameMatch) {
      const id = gameMatch[1];
      const sub = gameMatch[2];
      if (!sub && method === "GET") {
        const v = gameView(id, user.id);
        if (!v) return void json(res, { error: "no such game" }, 404);
        return void json(res, {
          role: v.role, state: v.state, audience: audienceCount(id),
          chat: { player: messagesForEscaped(id, "player"), audience: messagesForEscaped(id, "audience") },
        });
      }
      if (sub === "/action" && method === "POST") {
        const b = await readJsonBody(req);
        const r = act(id, user.id, b.action as Action);
        if (!r.ok) return void json(res, { error: r.error }, 403);
        broadcastGame(id, { type: "game", gameId: id });
        return void json(res, { ok: true });
      }
      if (sub === "/chat" && method === "POST") {
        const b = await readJsonBody(req);
        const channel: Channel = b.channel === "player" ? "player" : "audience";
        try {
          postMessage(id, user, channel, String(b.body ?? ""));
          broadcastGame(id, { type: "chat", gameId: id, channel });
          return void json(res, { ok: true });
        } catch (e) {
          return void json(res, { error: e instanceof ChatError || e instanceof GameError ? e.message : "failed" }, 400);
        }
      }
    }

    if (path.startsWith("/api/")) return void json(res, { error: "not found" }, 404);
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("something went wrong");
  }
});

// ---- server-rendered social pages (CSP-safe: plain form POSTs, no inline JS) ----

function profilePage(user: User): string {
  const p = getProfile(user.id)!;
  const avatarOptions = Object.values(FACTIONS).flatMap((f) =>
    allUnitDefs(f.id).map((u) => {
      const val = `${f.id}:${u.id}`;
      const sel = p.avatarHouse === f.id && p.avatarUnit === u.id ? " selected" : "";
      return `<option value="${val}"${sel}>${escapeHtml(f.name)} — ${escapeHtml(u.name)}</option>`;
    })).join("");
  const swatches = PLAYER_PALETTE.map((c, i) => {
    const checked = p.colour === c || (!p.colour && i === 0) ? " checked" : "";
    return `<label class="sw"><input type="radio" name="colour" value="${c}"${checked}>` +
      `<span style="background:${escapeHtml(c)}"></span></label>`;
  }).join("");
  const current = p.avatarHouse && p.avatarUnit
    ? `<img class="avatar" src="/art/portraits/${escapeHtml(p.avatarHouse)}/${escapeHtml(p.avatarUnit)}.png" alt="avatar"` +
      (p.colour ? ` style="box-shadow:0 0 0 4px ${escapeHtml(p.colour)}"` : "") + ">"
    : "<p>No avatar set yet.</p>";
  return page("Profile", `
    <h1>${escapeHtml(p.display_name)}</h1>
    <div class="card">
      <p>Username: <code>${escapeHtml(p.username)}</code> · Rating (ELO): <strong>${p.elo}</strong></p>
      ${current}
    </div>
    <div class="card">
      <h2>Choose your avatar</h2>
      <form method="post" action="/profile/avatar">
        <label>Portrait</label>
        <select name="avatar">${avatarOptions}</select>
        <label>Colour (also tints your pawns)</label>
        <div class="swatches">${swatches}</div>
        <p><button type="submit">Save</button></p>
      </form>
    </div>`);
}

function friendsPage(user: User, msg?: string): string {
  const friends = friendsOf(user.id)
    .map((f) => `<li>${escapeHtml(f.display_name)} ${isOnline(f.id) ? "· <em>online</em>" : ""}</li>`).join("");
  const incoming = incomingRequests(user.id).map((r) =>
    `<li>${escapeHtml(r.display_name)}
      <form method="post" action="/friends/accept" style="display:inline">
        <input type="hidden" name="friendship_id" value="${r.friendship_id}"><button>Accept</button></form>
      <form method="post" action="/friends/decline" style="display:inline">
        <input type="hidden" name="friendship_id" value="${r.friendship_id}"><button>Decline</button></form>
    </li>`).join("");
  const recent = recentOpponents(user.id).map((o) =>
    `<li>${escapeHtml(o.display_name)} <code>${escapeHtml(o.username)}</code>
      <form method="post" action="/friends/request" style="display:inline">
        <input type="hidden" name="username" value="${escapeHtml(o.username)}"><button>Add friend</button></form>
    </li>`).join("");
  return page("Friends", `
    <h1>Friends</h1>
    ${msg ? `<p class="err">${escapeHtml(msg)}</p>` : ""}
    <div class="card"><h2>Add a friend</h2>
      <form method="post" action="/friends/request">
        <input name="username" placeholder="their username"><button>Send request</button></form></div>
    <div class="card"><h2>Your friends</h2><ul>${friends || "<li>None yet.</li>"}</ul></div>
    <div class="card"><h2>Incoming requests</h2><ul>${incoming || "<li>None.</li>"}</ul></div>
    <div class="card"><h2>Recent opponents</h2><ul>${recent || "<li>No games yet.</li>"}</ul></div>`);
}

server.on("upgrade", (req, socket, head) => {
  if (new URL(req.url ?? "/", "http://localhost").pathname === "/ws") {
    handleUpgrade(req, socket, head);
  } else {
    socket.destroy();
  }
});

server.on("error", (e) => console.error("server error:", e));
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Maleghast Online listening on 0.0.0.0:${PORT} (day ${today()} ${TZ})`);
});

// Fly sends SIGTERM/SIGINT on every redeploy and when the idle machine stops.
// Close the database first so better-sqlite3 doesn't abort in its teardown.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    server.close();
    db.close();
    process.exit(0);
  });
}
