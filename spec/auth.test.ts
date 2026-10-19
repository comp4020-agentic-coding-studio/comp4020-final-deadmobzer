// Auth edge cases beyond the happy path spec/helpers.ts's signup() exercises
// everywhere else: duplicate usernames, the validation boundaries src/auth.ts
// enforces (username shape, password length), wrong-password login, and that
// a session cookie is actually dead after logout — not just cleared client-side.
import { expect, inject, it, describe } from "vitest";
import { uniqueName } from "./helpers.ts";

const baseUrl = inject("baseUrl");

function signupRaw(fields: Record<string, string>): Promise<Response> {
  return fetch(new URL("/signup", baseUrl), {
    method: "POST", redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  });
}
function loginRaw(fields: Record<string, string>): Promise<Response> {
  return fetch(new URL("/login", baseUrl), {
    method: "POST", redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  });
}
function sidFrom(res: Response): string | undefined {
  return /sid=([^;]+)/.exec(res.headers.get("set-cookie") ?? "")?.[1];
}

describe("POST /signup", () => {
  it("succeeds once and redirects home with a session cookie", async () => {
    const username = uniqueName();
    const res = await signupRaw({ username, password: "password1", display_name: "Someone" });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/");
    expect(sidFrom(res)).toBeTruthy();
  });

  it("rejects a second signup with the same username", async () => {
    const username = uniqueName();
    const first = await signupRaw({ username, password: "password1", display_name: "A" });
    expect(first.status).toBe(303);
    const second = await signupRaw({ username, password: "password2", display_name: "B" });
    expect(second.status).toBe(400);
    const body = await second.text();
    expect(body.toLowerCase()).toContain("taken");
  });

  it("rejects a username shorter than 3 characters", async () => {
    const res = await signupRaw({ username: "ab", password: "password1", display_name: "x" });
    expect(res.status).toBe(400);
  });

  it("rejects a username with characters outside [a-z0-9_]", async () => {
    const res = await signupRaw({ username: "bad name!", password: "password1", display_name: "x" });
    expect(res.status).toBe(400);
  });

  it("rejects a password shorter than 8 characters", async () => {
    const res = await signupRaw({ username: uniqueName(), password: "short1", display_name: "x" });
    expect(res.status).toBe(400);
  });

  it("accepts an uppercase/mixed-case username and normalises it to lowercase", async () => {
    const mixed = "MiXeD" + uniqueName();
    const res = await signupRaw({ username: mixed, password: "password1", display_name: "x" });
    expect(res.status).toBe(303);
    const sid = sidFrom(res)!;
    const profile = await (await fetch(new URL("/api/profile", baseUrl), { headers: { cookie: "sid=" + sid } })).json();
    expect(profile.username).toBe(mixed.toLowerCase());
  });

  it("falls back the display name to the username when left blank", async () => {
    const username = uniqueName();
    const res = await signupRaw({ username, password: "password1", display_name: "" });
    expect(res.status).toBe(303);
    const sid = sidFrom(res)!;
    const profile = await (await fetch(new URL("/api/profile", baseUrl), { headers: { cookie: "sid=" + sid } })).json();
    expect(profile.display_name).toBe(username);
  });
});

describe("POST /login", () => {
  it("rejects a wrong password for a real username", async () => {
    const username = uniqueName();
    await signupRaw({ username, password: "password1", display_name: "x" });
    const res = await loginRaw({ username, password: "totally-wrong" });
    expect(res.status).toBe(401);
  });

  it("rejects a username that was never registered", async () => {
    const res = await loginRaw({ username: uniqueName(), password: "whatever1" });
    expect(res.status).toBe(401);
  });

  it("logs in case-insensitively on the username", async () => {
    const username = uniqueName();
    await signupRaw({ username, password: "password1", display_name: "x" });
    const res = await loginRaw({ username: username.toUpperCase(), password: "password1" });
    expect(res.status).toBe(303);
    expect(sidFrom(res)).toBeTruthy();
  });
});

describe("POST /logout", () => {
  it("kills the session: the same sid is rejected by a protected API afterwards", async () => {
    const username = uniqueName();
    const signupRes = await signupRaw({ username, password: "password1", display_name: "x" });
    const sid = sidFrom(signupRes)!;

    const before = await fetch(new URL("/api/profile", baseUrl), { headers: { cookie: "sid=" + sid } });
    expect(before.status).toBe(200);

    const logout = await fetch(new URL("/logout", baseUrl), {
      method: "POST", redirect: "manual", headers: { cookie: "sid=" + sid },
    });
    expect(logout.status).toBe(303);
    // The cookie-clearing response itself expires the cookie.
    expect(logout.headers.get("set-cookie") ?? "").toContain("Max-Age=0");

    const after = await fetch(new URL("/api/profile", baseUrl), { headers: { cookie: "sid=" + sid } });
    expect(after.status).toBe(401);
  });

  it("is a no-op (still redirects) when no session cookie is present", async () => {
    const res = await fetch(new URL("/logout", baseUrl), { method: "POST", redirect: "manual" });
    expect(res.status).toBe(303);
  });
});
