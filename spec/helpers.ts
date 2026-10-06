// Shared helpers for the spec. Not a *.test.ts, so vitest doesn't collect it as
// a suite; the checks import it. Everything here talks to the running app over
// HTTP, so it holds whatever the app is built with.

// A fresh, unique account per call so repeated local runs don't collide on the
// username unique constraint. Lowercase + digits keeps it inside the app's rule.
export function uniqueName(): string {
  return "u" + Math.random().toString(36).slice(2, 10);
}

export interface TestUser {
  sid: string;
  username: string;
  display_name: string;
}

export async function signup(baseUrl: string): Promise<TestUser> {
  const username = uniqueName();
  const display_name = "Test " + username;
  const res = await fetch(new URL("/signup", baseUrl), {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username, password: "password1", display_name }),
  });
  const sid = /sid=([^;]+)/.exec(res.headers.get("set-cookie") ?? "")?.[1];
  if (!sid) throw new Error(`signup failed (${res.status})`);
  return { sid, username, display_name };
}

export function form(sid: string, fields: Record<string, string>): RequestInit {
  return {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: "sid=" + sid },
    body: new URLSearchParams(fields),
  };
}

export async function get(baseUrl: string, path: string, sid?: string): Promise<Response> {
  return fetch(new URL(path, baseUrl), {
    redirect: "manual",
    headers: sid ? { cookie: "sid=" + sid } : {},
  });
}
