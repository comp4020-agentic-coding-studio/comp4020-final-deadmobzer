import { db } from "./db.ts";
import type { User } from "./auth.ts";
import { nowISO } from "./time.ts";

export class FriendError extends Error {}

export interface Friend {
  id: number;
  username: string;
  display_name: string;
  online?: boolean;
}

export interface PendingRequest {
  friendship_id: number;
  id: number;
  username: string;
  display_name: string;
}

// Accepted friendship is symmetric: a row with status 'accepted' makes the two
// users friends regardless of who requested.
export function friendsOf(userId: number): Friend[] {
  return db
    .prepare(
      `SELECT u.id, u.username, u.display_name
         FROM friendships f
         JOIN users u ON u.id = CASE WHEN f.requester_id = ? THEN f.addressee_id ELSE f.requester_id END
        WHERE f.status = 'accepted' AND (f.requester_id = ? OR f.addressee_id = ?)
        ORDER BY u.display_name COLLATE NOCASE`,
    )
    .all(userId, userId, userId) as Friend[];
}

export function areFriends(a: number, b: number): boolean {
  const row = db
    .prepare(
      `SELECT 1 FROM friendships
        WHERE status = 'accepted'
          AND ((requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?))`,
    )
    .get(a, b, b, a);
  return !!row;
}

// Requests other people have sent me that I haven't answered yet.
export function incomingRequests(userId: number): PendingRequest[] {
  return db
    .prepare(
      `SELECT f.id AS friendship_id, u.id, u.username, u.display_name
         FROM friendships f JOIN users u ON u.id = f.requester_id
        WHERE f.addressee_id = ? AND f.status = 'pending'
        ORDER BY f.created_at`,
    )
    .all(userId) as PendingRequest[];
}

// Returns the addressee so the caller can push them a live notification.
export function sendRequest(from: User, toUsername: string): User {
  const u = toUsername.trim().toLowerCase();
  const to = db
    .prepare("SELECT id, username, display_name FROM users WHERE username = ?")
    .get(u) as User | undefined;
  if (!to) throw new FriendError("No one by that username.");
  if (to.id === from.id) throw new FriendError("You can't befriend yourself.");
  if (areFriends(from.id, to.id)) throw new FriendError("You're already friends.");

  // If they already requested me, sending back just accepts theirs.
  const reverse = db
    .prepare(
      "SELECT id FROM friendships WHERE requester_id = ? AND addressee_id = ? AND status = 'pending'",
    )
    .get(to.id, from.id) as { id: number } | undefined;
  if (reverse) {
    acceptRequest(from.id, reverse.id);
    return to;
  }

  try {
    db.prepare(
      "INSERT INTO friendships (requester_id, addressee_id, status, created_at) VALUES (?, ?, 'pending', ?)",
    ).run(from.id, to.id, nowISO());
  } catch {
    throw new FriendError("You've already sent them a request.");
  }
  return to;
}

// Returns the requester (the other party) so we can notify them it was accepted.
export function acceptRequest(userId: number, friendshipId: number): User {
  const row = db
    .prepare(
      "SELECT requester_id, addressee_id FROM friendships WHERE id = ? AND status = 'pending'",
    )
    .get(friendshipId) as { requester_id: number; addressee_id: number } | undefined;
  if (!row || row.addressee_id !== userId) {
    throw new FriendError("That request isn't yours to accept.");
  }
  db.prepare("UPDATE friendships SET status = 'accepted', responded_at = ? WHERE id = ?").run(
    nowISO(),
    friendshipId,
  );
  return db
    .prepare("SELECT id, username, display_name FROM users WHERE id = ?")
    .get(row.requester_id) as User;
}

export function declineRequest(userId: number, friendshipId: number): void {
  const info = db
    .prepare("DELETE FROM friendships WHERE id = ? AND addressee_id = ? AND status = 'pending'")
    .run(friendshipId, userId);
  if (info.changes === 0) throw new FriendError("That request isn't yours to decline.");
}
