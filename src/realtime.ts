import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import { userForToken } from "./auth.ts";
import { readCookie } from "./http.ts";

// The real-time layer. Two kinds of subscription travel over /ws:
//  - per-user events: friend requests/acceptances and presence.
//  - game rooms: everyone viewing a game (players + spectators) gets live state
//    updates and chat within ~1s, so no one has to reload.
// Connect to /ws for user events, or /ws?game=<id> to also join that game room.

export type LiveEvent =
  | { type: "friend_request"; from: string }
  | { type: "friend_accepted"; by: string }
  | { type: "presence"; online: string[] }
  | { type: "game"; gameId: string }                                  // state changed; refetch
  | { type: "chat"; gameId: string; channel: "player" | "audience" }  // new message; refetch
  | { type: "audience"; gameId: string; count: number };

const wss = new WebSocketServer({ noServer: true });

// userId -> open sockets (a person may have several tabs/devices).
const sockets = new Map<number, Set<WebSocket>>();
// gameId -> open sockets watching that game.
const rooms = new Map<string, Set<WebSocket>>();

export function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
  const user = userForToken(readCookie(req.headers.cookie, "sid"));
  if (!user) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }
  const gameId = new URL(req.url ?? "/", "http://localhost").searchParams.get("game");

  wss.handleUpgrade(req, socket, head, (ws) => {
    const set = sockets.get(user.id) ?? new Set<WebSocket>();
    set.add(ws);
    sockets.set(user.id, set);
    broadcastPresenceToFriends(user.id);

    let room: Set<WebSocket> | undefined;
    if (gameId) {
      room = rooms.get(gameId) ?? new Set<WebSocket>();
      room.add(ws);
      rooms.set(gameId, room);
      broadcastAudience(gameId);
    }

    ws.on("close", () => {
      set.delete(ws);
      if (set.size === 0) sockets.delete(user.id);
      broadcastPresenceToFriends(user.id);
      if (gameId && room) {
        room.delete(ws);
        if (room.size === 0) rooms.delete(gameId);
        else broadcastAudience(gameId);
      }
    });
    // The client never needs to send anything; ignore inbound frames.
  });
}

export function sendTo(userId: number, event: LiveEvent): void {
  send(sockets.get(userId), event);
}

// Broadcast to everyone watching a game (players + spectators).
export function broadcastGame(gameId: string, event: LiveEvent): void {
  send(rooms.get(gameId), event);
}

export function audienceCount(gameId: string): number {
  return rooms.get(gameId)?.size ?? 0;
}

function broadcastAudience(gameId: string): void {
  broadcastGame(gameId, { type: "audience", gameId, count: audienceCount(gameId) });
}

function send(set: Set<WebSocket> | undefined, event: LiveEvent): void {
  if (!set) return;
  const data = JSON.stringify(event);
  for (const ws of set) if (ws.readyState === WebSocket.OPEN) ws.send(data);
}

export function isOnline(userId: number): boolean {
  return sockets.has(userId);
}

// Presence is intentionally coarse: a friend either has a session open or not.
// Imported lazily to avoid a cycle with friends.ts.
function broadcastPresenceToFriends(userId: number): void {
  import("./friends.ts").then(({ friendsOf }) => {
    for (const friend of friendsOf(userId)) {
      if (!isOnline(friend.id)) continue;
      const onlineNames = friendsOf(friend.id)
        .filter((f) => isOnline(f.id))
        .map((f) => f.display_name);
      sendTo(friend.id, { type: "presence", online: onlineNames });
    }
  });
}
