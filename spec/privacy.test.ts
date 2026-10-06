import { expect, inject, it } from "vitest";
import { form, get, signup } from "./helpers.ts";

// "Good" here means a private, unperformed space. These protect that promise:
// a stranger is never served someone's state, and no one can read another
// person's reflection.
const baseUrl = inject("baseUrl");

it("does not serve your state to a signed-out visitor", async () => {
  const res = await get(baseUrl, "/api/state");
  expect(res.status).toBe(303); // bounced to sign in, never 200 JSON
});

it("shows signed-out visitors the door, not a diary", async () => {
  const res = await fetch(new URL("/", baseUrl));
  const body = await res.text();
  expect(res.status).toBe(200);
  expect(body).toContain("Sign in");
  expect(body).not.toContain("What a friend wrote about you");
});

it("refuses to record an entry without a session", async () => {
  const res = await fetch(new URL("/entry", baseUrl), form("not-a-real-session", {
    kind: "self",
    body: "should never be stored",
  }));
  // No valid session → bounced to the landing page, nothing written.
  expect(res.status).toBe(303);
  expect(res.headers.get("location")).toBe("/");
});

it("keeps one person's reflection out of another person's view", async () => {
  const author = await signup(baseUrl);
  const secret = "secret-" + author.username;
  await fetch(new URL("/entry", baseUrl), form(author.sid, { kind: "self", body: secret }));

  // Find the day the author just wrote, from their own calendar.
  const cal = await (await get(baseUrl, "/calendar", author.sid)).text();
  const day = /\/day\?d=(\d{4}-\d{2}-\d{2})/.exec(cal)?.[1];
  expect(day, "author should have a calendar entry").toBeTruthy();

  const stranger = await signup(baseUrl);
  const strangerView = await (await get(baseUrl, `/day?d=${day}`, stranger.sid)).text();
  expect(strangerView).not.toContain(secret);
});
