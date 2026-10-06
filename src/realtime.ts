import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import { userForToken } from "./auth.ts";
import { readCookie } from "./http.ts";

// The real-time layer. Relationship events (friend requests and acceptances)
// and presence travel live; reflection content deliberately does not — a note
// stays sealed until the next day (see docs/adr-001-realtime-scope.md).
export type LiveEvent =
  | { type: "friend_request"; from: string }
  | { type: "friend_accepted"; by: string }
  | { type: "presence"; online: string[] };

const wss = new WebSocketServer({ noServer: true });

// userId -> open sockets for that user (a person may have several tabs/devices).
const sockets = new Map<number, Set<WebSocket>>();

export function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
  const user = userForToken(readCookie(req.headers.cookie, "sid"));
  if (!user) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    const set = sockets.get(user.id) ?? new Set<WebSocket>();
    set.add(ws);
    sockets.set(user.id, set);
    broadcastPresenceToFriends(user.id);

    ws.on("close", () => {
      set.delete(ws);
      if (set.size === 0) sockets.delete(user.id);
      broadcastPresenceToFriends(user.id);
    });
    // The client never needs to send anything; ignore inbound frames.
  });
}

export function sendTo(userId: number, event: LiveEvent): void {
  const set = sockets.get(userId);
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
