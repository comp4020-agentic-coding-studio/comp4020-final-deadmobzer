import { createServer, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { randomBytes } from "node:crypto";
import { db } from "./db.ts";
import {
  AuthError, createSession, destroySession, login, signup, userForToken, type User,
} from "./auth.ts";
import {
  acceptRequest, declineRequest, removeFriend, FriendError, friendsOf, incomingRequests, sendRequest,
} from "./friends.ts";
import { readmeBodyHtml } from "./readme.ts";
import { handleUpgrade, isOnline, sendTo, broadcastGame, audienceCount } from "./realtime.ts";
import {
  clearSessionCookie, escapeHtml, html, json, readCookie, readFormBody, readJsonBody,
  redirect, setSessionCookie,
} from "./http.ts";
import { landing, aboutPage, appShell, howToPlay } from "./serverview.ts";
import { audit, withRequestId } from "./audit.ts";
import { today, TZ } from "./time.ts";
import { FACTIONS, PLAYER_PALETTE, UNIT_SLOTS, RULES } from "./game/data.ts";
import { validateLoadout, saveLoadout, getLoadout, maliceLevels, LoadoutError, type Mode } from "./loadouts.ts";
import { createLobby, joinLobby, quickJoin, openLobbies, previewLobby, lobbyGameId, LobbyError } from "./lobbies.ts";
import { gameView, act, movesFor, targetsFor, soulTargetsFor, leaveGame, recentOpponents, activeGames, GameError } from "./games.ts";
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

// Every log line produced while handling a request — the entry line below and
// any audit() calls made anywhere on the call path — carries this same short
// id (see src/audit.ts), so `flyctl logs | grep req=<id>` replays one request's
// whole trace, which is what week 10's lecture asks a production app to support.
function newRequestId(): string {
  return randomBytes(4).toString("hex");
}

const server = createServer((req, res) => withRequestId(newRequestId(), async () => {
  try {
    securityHeaders(res);
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const path = url.pathname;
    const method = req.method ?? "GET";

    // --- static roots (not logged: high-volume, never an audit-worthy event) ---
    for (const prefix of ["/static/", "/art/", "/fonts/", "/models/"]) {
      if (method === "GET" && path.startsWith(prefix)) {
        const root = prefix === "/static/" ? "" : prefix.slice(1);
        return void (await serveStatic(res, root + path.slice(prefix.length)));
      }
    }

    console.log(`req ${method} ${path}`);
    res.once("finish", () => console.log(`req ${method} ${path} -> ${res.statusCode}`));
    const user = currentUser(req);

    // --- README, published in full (required by the spec), open to all ---
    if (method === "GET" && (path === "/readme" || path === "/readme/")) {
      return void html(res, aboutPage(readmeBodyHtml()));
    }

    // --- How to Play: a concise rules primer, open to all (no auth needed) ---
    if (method === "GET" && (path === "/how-to-play" || path === "/how-to-play/")) {
      return void html(res, howToPlay());
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
        // Slot-cost/limit table + overall budget, so a client-side faithful-mode
        // builder can replicate validateLoadout()'s math without hardcoding numbers.
        unitTypes: RULES.unitTypes,
        unitSlots: UNIT_SLOTS,
        // How many rows from a side's own board edge the "deploy" action's
        // edge-band check (src/game/engine.ts) allows placement into — the client
        // reads this to highlight legal deploy tiles rather than hardcoding the
        // number, so the UI guidance can't drift from the rule it mirrors.
        deployFromEdgeSpaces: RULES.mode.deployFromEdgeSpaces,
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

    // ---- The SPA (React + Three.js): every authenticated page past this point
    // is the same shell — App.tsx (wouter) renders the matching page client-side
    // from here, with its own persistent nav, so none of these are a second
    // network round-trip once the bundle is loaded. Each keeps its own server
    // route so a bookmark, shared link, or hard refresh still resolves. The
    // server-rendered profilePage()/friendsPage() + their /profile/avatar and
    // /friends/* form-POST routes stay in place below, unused by the SPA but
    // still a protected contract (spec/profile.test.ts's "server-rendered
    // form" describe block) — don't remove them.
    if (path === "/" && method === "GET") return void html(res, appShell("Home"));
    if (path === "/play" && method === "GET") return void html(res, appShell("Play"));
    if (path.startsWith("/g/") && method === "GET") return void html(res, appShell("Table"));
    if (path === "/profile" && method === "GET") return void html(res, appShell("Profile"));
    if (path === "/profile/avatar" && method === "POST") {
      const f = await readFormBody(req);
      const [house, unit] = (f.get("avatar") ?? ":").split(":");
      try { setAvatar(user.id, house, unit, f.get("colour") ?? ""); } catch { /* ignore invalid */ }
      return void redirect(res, "/profile");
    }
    if (path === "/friends" && method === "GET") return void html(res, appShell("Friends"));
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
    const lobbyPreviewMatch = /^\/api\/lobby\/([A-Za-z0-9]+)\/preview$/.exec(path);
    if (lobbyPreviewMatch && method === "GET") {
      const preview = previewLobby(lobbyPreviewMatch[1]);
      if (!preview) return void json(res, { error: "no open lobby with that code" }, 404);
      return void json(res, preview);
    }
    const lobbyMatch = /^\/api\/lobby\/([A-Za-z0-9]+)$/.exec(path);
    if (lobbyMatch && method === "GET") {
      return void json(res, { gameId: lobbyGameId(lobbyMatch[1]) });
    }

    // friends (JSON)
    if (path === "/api/friends" && method === "GET") {
      return void json(res, {
        friends: friendsOf(user.id).map((f) => ({ ...f, online: isOnline(f.id) })),
        incoming: incomingRequests(user.id),
        recent: recentOpponents(user.id),
      });
    }
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
    if (path === "/api/friends/remove" && method === "POST") {
      const b = await readJsonBody(req);
      try {
        removeFriend(user.id, Number(b.user_id));
        audit(user.username, "friend.remove", { with: String(b.user_id) });
        return void json(res, { ok: true });
      } catch (e) { return void json(res, { error: e instanceof FriendError ? e.message : "failed" }, 400); }
    }
    if (path === "/api/recent-opponents" && method === "GET") {
      return void json(res, { opponents: recentOpponents(user.id) });
    }
    if (path === "/api/games/active" && method === "GET") {
      // only show games someone is actually in (an empty game isn't worth watching)
      return void json(res, { games: activeGames().filter((g) => audienceCount(g.id) > 0) });
    }

    // games: /api/game/<id>, /action, /chat, /moves, /targets, /soul-targets, /leave
    const gameMatch = /^\/api\/game\/([A-Za-z0-9_-]+)(\/action|\/chat|\/moves|\/targets|\/soul-targets|\/leave)?$/.exec(path);
    if (gameMatch) {
      const id = gameMatch[1];
      const sub = gameMatch[2];
      if (sub === "/moves" && method === "GET") {
        const iid = url.searchParams.get("iid") ?? "";
        return void json(res, { tiles: movesFor(id, user.id, iid) });
      }
      if (sub === "/targets" && method === "GET") {
        const iid = url.searchParams.get("iid") ?? "";
        const ability = url.searchParams.get("ability") ?? "";
        return void json(res, { targets: targetsFor(id, user.id, iid, ability) });
      }
      if (sub === "/soul-targets" && method === "GET") {
        const ability = url.searchParams.get("ability") ?? "";
        return void json(res, { targets: soulTargetsFor(id, user.id, ability) });
      }
      if (sub === "/leave" && method === "POST") {
        const ended = leaveGame(id, user.id);
        if (ended) broadcastGame(id, { type: "game", gameId: id });
        return void json(res, { ok: true });
      }
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
        if (!r.ok) return void json(res, { error: r.error }, r.conflict ? 409 : 403);
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
}));

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
