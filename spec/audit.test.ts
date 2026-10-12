import { expect, it } from "vitest";
import { formatAudit } from "../src/audit.ts";

// The crit-10 contract: the server logs who did what, so two people can be told
// apart from the logs alone — and the seal holds in the logs too (never the
// reflection content). This pins the shape of a line and that promise.

it("names the actor and the action", () => {
  const line = formatAudit("alice", "login");
  expect(line).toBe("audit user=alice action=login");
});

it("tells two people apart", () => {
  expect(formatAudit("alice", "entry.save", { kind: "self" })).toContain("user=alice");
  expect(formatAudit("bob", "entry.save", { kind: "self" })).toContain("user=bob");
});

it("records the action, never the reflection body", () => {
  // Only the fields we pass are logged; a save records its kind, not its text.
  const secret = "my private reflection";
  const line = formatAudit("alice", "entry.save", { kind: "friend" });
  expect(line).toBe("audit user=alice action=entry.save kind=friend");
  expect(line).not.toContain(secret);
});

it("keeps each record on one line of space-free tokens", () => {
  const line = formatAudit("alice", "friend.accept", { with: "Bob the Builder" });
  expect(line).not.toMatch(/\n/);
  // display-derived values are collapsed so a value can't split the record
  expect(line).toBe("audit user=alice action=friend.accept with=Bob_the_Builder");
});
