import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { db } from "./db.ts";
import { nowISO } from "./time.ts";

export interface User {
  id: number;
  username: string;
  display_name: string;
}

// scrypt from node:crypto — no native hashing dependency. Stored as
// "salt:hash", both hex. timingSafeEqual guards the comparison.
function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

const SESSION_DAYS = 30;

export class AuthError extends Error {}

export function signup(username: string, password: string, displayName: string): User {
  const u = username.trim().toLowerCase();
  const name = displayName.trim() || username.trim();
  if (!/^[a-z0-9_]{3,20}$/.test(u)) {
    throw new AuthError("Username must be 3–20 characters: letters, numbers or underscore.");
  }
  if (password.length < 8) {
    throw new AuthError("Password must be at least 8 characters.");
  }
  const exists = db.prepare("SELECT 1 FROM users WHERE username = ?").get(u);
  if (exists) throw new AuthError("That username is taken.");

  const info = db
    .prepare(
      "INSERT INTO users (username, password_hash, display_name, created_at) VALUES (?, ?, ?, ?)",
    )
    .run(u, hashPassword(password), name, nowISO());
  return { id: Number(info.lastInsertRowid), username: u, display_name: name };
}

export function login(username: string, password: string): User {
  const u = username.trim().toLowerCase();
  const row = db
    .prepare("SELECT id, username, display_name, password_hash FROM users WHERE username = ?")
    .get(u) as (User & { password_hash: string }) | undefined;
  if (!row || !verifyPassword(password, row.password_hash)) {
    throw new AuthError("Wrong username or password.");
  }
  return { id: row.id, username: row.username, display_name: row.display_name };
}

export function createSession(userId: number): string {
  const token = randomBytes(32).toString("hex");
  const created = new Date();
  const expires = new Date(created.getTime() + SESSION_DAYS * 86400_000);
  db.prepare(
    "INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
  ).run(token, userId, created.toISOString(), expires.toISOString());
  return token;
}

export function userForToken(token: string | undefined): User | null {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT u.id, u.username, u.display_name, s.expires_at
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token = ?`,
    )
    .get(token) as (User & { expires_at: string }) | undefined;
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
    return null;
  }
  return { id: row.id, username: row.username, display_name: row.display_name };
}

export function destroySession(token: string | undefined): void {
  if (token) db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
}
