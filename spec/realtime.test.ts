import { WebSocket } from "ws";
import { expect, inject, it } from "vitest";
import { api, signup, startGame } from "./helpers.ts";

// The real-time contract: a change one person makes reaches every other open
// session within about a second, with no reload. For the game that means both
// game-state changes and chat reach everyone in the game room (players AND a
// spectator), so we test a chat message landing on a spectator's socket.
const baseUrl = inject("baseUrl");

function wsUrl(game?: string): URL {
  const u = new URL(game ? `/ws?game=${game}` : "/ws", baseUrl);
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

it("a chat message reaches a spectator's game-room socket within a second", async () => {
  const { a, gameId } = await startGame(baseUrl);
  const spectator = await signup(baseUrl);

  const ws = new WebSocket(wsUrl(gameId), { headers: { cookie: "sid=" + spectator.sid } });
  await new Promise<void>((resolve, reject) => {
    ws.on("open", () => resolve());
    ws.on("error", reject);
  });

  const event = new Promise<{ type: string; channel?: string }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("no chat event within 1s")), 1000);
    ws.on("message", (data) => {
      const ev = JSON.parse(data.toString());
      if (ev.type === "chat") { clearTimeout(timer); resolve(ev); }
    });
  });

  const res = await api(baseUrl, a.sid, `/api/game/${gameId}/chat`, { channel: "player", body: "en garde" });
  expect(res.status).toBe(200);

  const ev = await event;
  expect(ev.type).toBe("chat");
  expect(ev.channel).toBe("player");
  ws.close();
});
