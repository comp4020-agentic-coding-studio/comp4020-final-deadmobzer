import { WebSocket } from "ws";
import { expect, inject, it } from "vitest";
import { form, signup } from "./helpers.ts";

// The crit-9 contract: a change one person makes reaches every other open
// session within about a second, with no reload. Relationship events are the
// app's live surface (reflection content is deliberately sealed until the next
// day — see docs/adr-001-realtime-scope.md), so we test a friend request.
const baseUrl = inject("baseUrl");

function wsUrl(): URL {
  const u = new URL("/ws", baseUrl);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  return u;
}

it("rejects an unauthenticated WebSocket", async () => {
  const ws = new WebSocket(wsUrl());
  const code = await new Promise<number>((resolve) => {
    ws.on("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
    ws.on("open", () => resolve(200));
    ws.on("error", () => resolve(-1));
  });
  ws.close();
  expect(code).toBe(401);
});

it("delivers a friend request to an open session within a second", async () => {
  const sender = await signup(baseUrl);
  const recipient = await signup(baseUrl);

  const ws = new WebSocket(wsUrl(), { headers: { cookie: "sid=" + recipient.sid } });
  await new Promise<void>((resolve, reject) => {
    ws.on("open", () => resolve());
    ws.on("error", reject);
  });

  const event = new Promise<{ type: string; from: string }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("no event within 1s")), 1000);
    ws.on("message", (data) => {
      clearTimeout(timer);
      resolve(JSON.parse(data.toString()));
    });
  });

  const res = await fetch(new URL("/friends/request", baseUrl), form(sender.sid, {
    username: recipient.username,
  }));
  expect(res.status).toBe(303);

  const ev = await event;
  expect(ev.type).toBe("friend_request");
  expect(ev.from).toBe(sender.display_name);
  ws.close();
});
