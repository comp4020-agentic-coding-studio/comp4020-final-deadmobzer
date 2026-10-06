import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { db } from "./db.ts";
import {
  AuthError,
  createSession,
  destroySession,
  login,
  signup,
  userForToken,
  type User,
} from "./auth.ts";
import {
  acceptRequest,
  declineRequest,
  FriendError,
  friendsOf,
  incomingRequests,
  sendRequest,
} from "./friends.ts";
import { taskFor } from "./daily.ts";
import {
  calendar,
  dayDetail,
  EntryError,
  myEntriesToday,
  notesFromYesterday,
  writeEntry,
} from "./entries.ts";
import { renderReadme } from "./readme.ts";
import { handleUpgrade, isOnline, sendTo } from "./realtime.ts";
import {
  clearSessionCookie,
  html,
  readCookie,
  readFormBody,
  redirect,
  setSessionCookie,
} from "./http.ts";
import {
  calendarPage,
  dayPage,
  homePage,
  landingPage,
} from "./views.ts";
import { TZ, today } from "./time.ts";

const PORT = Number(process.env.PORT ?? 8080);

function currentUser(req: { headers: { cookie?: string } }): User | null {
  return userForToken(readCookie(req.headers.cookie, "sid"));
}

function friendsWithPresence(userId: number) {
  return friendsOf(userId).map((f) => ({ ...f, online: isOnline(f.id) }));
}

function todayLabel(): string {
  const [y, m, d] = today().split("-").map(Number);
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: TZ,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(Date.UTC(y, m - 1, d, 2)));
}

const MIME: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const path = url.pathname;
    const method = req.method ?? "GET";

    // --- static assets ---
    if (method === "GET" && path.startsWith("/static/")) {
      const name = path.slice("/static/".length);
      if (name.includes("..")) return void res.writeHead(404).end();
      try {
        const file = await readFile(new URL(`../public/${name}`, import.meta.url));
        res.writeHead(200, { "Content-Type": MIME[extname(name)] ?? "application/octet-stream" });
        return void res.end(file);
      } catch {
        return void res.writeHead(404).end("not found");
      }
    }

    // --- README, published in full (required by the brief/spec) ---
    if (method === "GET" && (path === "/readme" || path === "/readme/")) {
      return void html(res, renderReadme());
    }

    const user = currentUser(req);

    // --- auth routes (open) ---
    if (path === "/login" && method === "POST") {
      const form = await readFormBody(req);
      try {
        const u = login(form.get("username") ?? "", form.get("password") ?? "");
        setSessionCookie(res, createSession(u.id));
        return void redirect(res, "/");
      } catch (e) {
        return void html(res, landingPage(e instanceof AuthError ? e.message : "Sign in failed."), 401);
      }
    }
    if (path === "/signup" && method === "POST") {
      const form = await readFormBody(req);
      try {
        const u = signup(
          form.get("username") ?? "",
          form.get("password") ?? "",
          form.get("display_name") ?? "",
        );
        setSessionCookie(res, createSession(u.id));
        return void redirect(res, "/");
      } catch (e) {
        return void html(res, landingPage(e instanceof AuthError ? e.message : "Sign up failed."), 400);
      }
    }
    if (path === "/logout" && method === "POST") {
      destroySession(readCookie(req.headers.cookie, "sid"));
      clearSessionCookie(res);
      return void redirect(res, "/");
    }

    // --- everything below needs a session ---
    if (!user) {
      if (path === "/" && method === "GET") return void html(res, landingPage());
      return void redirect(res, "/");
    }

    if (path === "/" && method === "GET") {
      const task = taskFor(user.id);
      return void html(
        res,
        homePage({
          user,
          task,
          mine: myEntriesToday(user.id),
          yesterday: notesFromYesterday(user.id),
          friends: friendsWithPresence(user.id),
          incoming: incomingRequests(user.id),
          todayLabel: todayLabel(),
          flash: url.searchParams.get("msg") ?? undefined,
        }),
      );
    }

    if (path === "/api/state" && method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return void res.end(
        JSON.stringify({
          friends: friendsWithPresence(user.id),
          incoming: incomingRequests(user.id),
        }),
      );
    }

    if (path === "/entry" && method === "POST") {
      const form = await readFormBody(req);
      const kind = form.get("kind") === "friend" ? "friend" : "self";
      try {
        writeEntry(user.id, kind, form.get("body") ?? "");
        return void redirect(res, "/?msg=" + encodeURIComponent("Saved."));
      } catch (e) {
        return void redirect(res, "/?msg=" + encodeURIComponent(e instanceof EntryError ? e.message : "Could not save."));
      }
    }

    if (path === "/friends/request" && method === "POST") {
      const form = await readFormBody(req);
      try {
        const to = sendRequest(user, form.get("username") ?? "");
        sendTo(to.id, { type: "friend_request", from: user.display_name });
        return void redirect(res, "/?msg=" + encodeURIComponent("Request sent."));
      } catch (e) {
        return void redirect(res, "/?msg=" + encodeURIComponent(e instanceof FriendError ? e.message : "Could not send."));
      }
    }
    if (path === "/friends/accept" && method === "POST") {
      const form = await readFormBody(req);
      try {
        const other = acceptRequest(user.id, Number(form.get("friendship_id")));
        sendTo(other.id, { type: "friend_accepted", by: user.display_name });
        return void redirect(res, "/?msg=" + encodeURIComponent("You're now friends."));
      } catch (e) {
        return void redirect(res, "/?msg=" + encodeURIComponent(e instanceof FriendError ? e.message : "Could not accept."));
      }
    }
    if (path === "/friends/decline" && method === "POST") {
      const form = await readFormBody(req);
      try {
        declineRequest(user.id, Number(form.get("friendship_id")));
      } catch {
        // ignore — the request was already gone
      }
      return void redirect(res, "/");
    }

    if (path === "/calendar" && method === "GET") {
      return void html(res, calendarPage(user, calendar(user.id)));
    }
    if (path === "/day" && method === "GET") {
      const day = url.searchParams.get("d") ?? "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return void redirect(res, "/calendar");
      return void html(res, dayPage(user, day, dayDetail(user.id, day)));
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("something went wrong");
  }
});

server.on("upgrade", (req, socket, head) => {
  if (new URL(req.url ?? "/", "http://localhost").pathname === "/ws") {
    handleUpgrade(req, socket, head);
  } else {
    socket.destroy();
  }
});

server.on("error", (e) => console.error("server error:", e));
server.listen(PORT, "0.0.0.0", () => {
  console.log(`a small daily listening on 0.0.0.0:${PORT} (day ${today()} ${TZ})`);
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
