// Friends system: requesting, accepting, declining, and the edge cases around
// them — previously untested. This matters for "fair" and "legible" the same
// way games do: a friend request is a social action between two accounts, so
// it must be checked server-side (can't befriend yourself, can't double-request,
// can't act on someone else's pending request) and it's audited (src/audit.ts)
// the same way game actions are. Also covers /api/recent-opponents, which
// feeds the "Add friend" shortcut on the Friends page.
import { expect, inject, it, describe } from "vitest";
import { api, get, signup, startGame, uniqueName } from "./helpers.ts";

const baseUrl = inject("baseUrl");

// The one-time-use friendship_id a /friends/accept or /decline call needs,
// read from GET /api/friends's "incoming" list (src/server.ts).
async function firstFriendshipId(sid: string): Promise<number> {
  const body = await (await api(baseUrl, sid, "/api/friends", undefined, "GET")).json();
  const first = body.incoming?.[0];
  if (!first) throw new Error("no pending friendship_id found in GET /api/friends");
  return Number(first.friendship_id);
}

describe("friend requests", () => {
  it("sending, then accepting, makes both sides see each other as friends", async () => {
    const a = await signup(baseUrl);
    const b = await signup(baseUrl);

    const send = await api(baseUrl, a.sid, "/api/friends/request", { username: b.username });
    expect(send.status).toBe(200);
    expect((await send.json()).ok).toBe(true);

    const fid = await firstFriendshipId(b.sid);
    const accept = await api(baseUrl, b.sid, "/api/friends/accept", { friendship_id: fid });
    expect(accept.status).toBe(200);

    const friendsA = await (await api(baseUrl, a.sid, "/api/friends", undefined, "GET")).json();
    const friendsB = await (await api(baseUrl, b.sid, "/api/friends", undefined, "GET")).json();
    expect(friendsA.friends.some((f: { display_name: string }) => f.display_name === b.display_name)).toBe(true);
    expect(friendsB.friends.some((f: { display_name: string }) => f.display_name === a.display_name)).toBe(true);
  });

  it("sending, then declining, leaves both sides unfriended", async () => {
    const a = await signup(baseUrl);
    const b = await signup(baseUrl);
    await api(baseUrl, a.sid, "/api/friends/request", { username: b.username });

    const fid = await firstFriendshipId(b.sid);
    const decline = await api(baseUrl, b.sid, "/api/friends/decline", { friendship_id: fid });
    expect(decline.status).toBe(200);

    const friendsB = await (await api(baseUrl, b.sid, "/api/friends", undefined, "GET")).json();
    // The request is gone from the incoming list and no friendship was made.
    expect(friendsB.incoming.some((r: { friendship_id: number }) => r.friendship_id === fid)).toBe(false);
    expect(friendsB.friends).toEqual([]);
  });

  it("rejects a self-request", async () => {
    const a = await signup(baseUrl);
    const res = await api(baseUrl, a.sid, "/api/friends/request", { username: a.username });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/yourself/i);
  });

  it("rejects a request to a username that doesn't exist", async () => {
    const a = await signup(baseUrl);
    const res = await api(baseUrl, a.sid, "/api/friends/request", { username: "nobody_" + uniqueName() });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/no one/i);
  });

  it("rejects a duplicate request to the same pending user", async () => {
    const a = await signup(baseUrl);
    const b = await signup(baseUrl);
    const first = await api(baseUrl, a.sid, "/api/friends/request", { username: b.username });
    expect(first.status).toBe(200);
    const second = await api(baseUrl, a.sid, "/api/friends/request", { username: b.username });
    expect(second.status).toBe(400);
    expect((await second.json()).error).toMatch(/already/i);
  });

  it("a mutual request (B requests A back while A's request is pending) auto-accepts instead of erroring", async () => {
    const a = await signup(baseUrl);
    const b = await signup(baseUrl);
    await api(baseUrl, a.sid, "/api/friends/request", { username: b.username });
    const reverse = await api(baseUrl, b.sid, "/api/friends/request", { username: a.username });
    expect(reverse.status).toBe(200);
    const friendsA = await (await api(baseUrl, a.sid, "/api/friends", undefined, "GET")).json();
    expect(friendsA.friends.some((f: { display_name: string }) => f.display_name === b.display_name)).toBe(true);
  });

  it("rejects accepting a request that isn't yours, and declining it is a silent no-op", async () => {
    const a = await signup(baseUrl);
    const b = await signup(baseUrl);
    const c = await signup(baseUrl);
    await api(baseUrl, a.sid, "/api/friends/request", { username: b.username });
    const fid = await firstFriendshipId(b.sid);

    const wrongAccept = await api(baseUrl, c.sid, "/api/friends/accept", { friendship_id: fid });
    expect(wrongAccept.status).toBe(400);
    // /api/friends/decline is deliberately idempotent (src/server.ts: "already
    // gone" is swallowed) — it always answers {ok:true} whether or not a row
    // actually matched, by someone else's id or an unknown one alike. So c's
    // call here reports success without actually touching a's request.
    const wrongDecline = await api(baseUrl, c.sid, "/api/friends/decline", { friendship_id: fid });
    expect(wrongDecline.status).toBe(200);

    // The real addressee can still act on it afterwards — c's bad call didn't consume it.
    const accept = await api(baseUrl, b.sid, "/api/friends/accept", { friendship_id: fid });
    expect(accept.status).toBe(200);
  });

  it("accepting an unknown friendship id fails cleanly (400); declining one is a silent no-op (200)", async () => {
    const a = await signup(baseUrl);
    const res = await api(baseUrl, a.sid, "/api/friends/accept", { friendship_id: 999_999_999 });
    expect(res.status).toBe(400);
    // See note above: decline never errors, by design.
    const res2 = await api(baseUrl, a.sid, "/api/friends/decline", { friendship_id: 999_999_999 });
    expect(res2.status).toBe(200);
  });

  it("is turned away unauthenticated", async () => {
    const b = await signup(baseUrl);
    const res = await fetch(new URL("/api/friends/request", baseUrl), {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: b.username }),
    });
    expect(res.status).toBe(401);
  });
});

describe("recent opponents", () => {
  it("lists a past opponent by name after a game, and offers 'add friend'", async () => {
    const { a, b } = await startGame(baseUrl);
    const res = await api(baseUrl, a.sid, "/api/recent-opponents", undefined, "GET");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.opponents.some((o: { username: string }) => o.username === b.username)).toBe(true);

    const friendsA = await (await api(baseUrl, a.sid, "/api/friends", undefined, "GET")).json();
    expect(friendsA.recent.some((o: { display_name: string }) => o.display_name === b.display_name)).toBe(true);
  });

  it("is empty for a user who has never played", async () => {
    const a = await signup(baseUrl);
    const res = await api(baseUrl, a.sid, "/api/recent-opponents", undefined, "GET");
    const body = await res.json();
    expect(body.opponents).toEqual([]);
  });

  it("is turned away unauthenticated", async () => {
    const res = await get(baseUrl, "/api/recent-opponents");
    expect(res.status).toBe(401);
  });
});
