import { expect, inject, it } from "vitest";
import { form, get, signup } from "./helpers.ts";

// The crit-10 contract: what a person may see and change is checked on the
// server, not just hidden by the UI. A friend request only belongs to its
// addressee, so accepting or declining someone else's request must fail even if
// the request id is guessed or replayed. These assert the server contract via
// status codes and /api/state (JSON), so they survive a change of UI or stack.
const baseUrl = inject("baseUrl");

interface State {
  friends: { username: string }[];
  incoming: { username: string }[];
}

async function state(sid: string): Promise<State> {
  const res = await get(baseUrl, "/api/state", sid);
  expect(res.status).toBe(200);
  return (await res.json()) as State;
}

const hasUser = (list: { username: string }[], username: string): boolean =>
  list.some((u) => u.username === username);

it("refuses to let a stranger accept a friend request that isn't theirs", async () => {
  const sender = await signup(baseUrl);
  const addressee = await signup(baseUrl);
  const outsider = await signup(baseUrl);

  await fetch(new URL("/friends/request", baseUrl), form(sender.sid, {
    username: addressee.username,
  }));

  // The outsider doesn't know the real friendship id, but even a lucky guess
  // (small sequential ids in a fresh test db) must be rejected server-side.
  for (let friendshipId = 1; friendshipId <= 5; friendshipId++) {
    const res = await fetch(
      new URL("/friends/accept", baseUrl),
      form(outsider.sid, { friendship_id: String(friendshipId) }),
    );
    expect(res.status).toBe(303);
  }

  // The request is still pending for its real addressee; nobody became friends.
  expect(hasUser((await state(addressee.sid)).incoming, sender.username)).toBe(true);
  expect(hasUser((await state(addressee.sid)).friends, sender.username)).toBe(false);
  expect(hasUser((await state(outsider.sid)).friends, sender.username)).toBe(false);
});

it("refuses to let the requester accept their own pending request", async () => {
  const sender = await signup(baseUrl);
  const addressee = await signup(baseUrl);

  await fetch(new URL("/friends/request", baseUrl), form(sender.sid, {
    username: addressee.username,
  }));

  for (let friendshipId = 1; friendshipId <= 5; friendshipId++) {
    const res = await fetch(
      new URL("/friends/accept", baseUrl),
      form(sender.sid, { friendship_id: String(friendshipId) }),
    );
    expect(res.status).toBe(303);
  }

  // Still not friends: a request is only acceptable by its addressee.
  expect(hasUser((await state(sender.sid)).friends, addressee.username)).toBe(false);
  expect(hasUser((await state(addressee.sid)).incoming, sender.username)).toBe(true);
});

it("refuses to let a stranger decline a friend request that isn't theirs", async () => {
  const sender = await signup(baseUrl);
  const addressee = await signup(baseUrl);
  const outsider = await signup(baseUrl);

  await fetch(new URL("/friends/request", baseUrl), form(sender.sid, {
    username: addressee.username,
  }));

  for (let friendshipId = 1; friendshipId <= 5; friendshipId++) {
    const res = await fetch(
      new URL("/friends/decline", baseUrl),
      form(outsider.sid, { friendship_id: String(friendshipId) }),
    );
    expect(res.status).toBe(303);
  }

  // The request survives a stranger's decline, waiting for its real addressee.
  expect(hasUser((await state(addressee.sid)).incoming, sender.username)).toBe(true);
});
