import { expect, inject, it } from "vitest";

// /how-to-play/ is a concise, server-rendered rules primer (src/serverview.ts's
// howToPlay()), open to everyone (no session needed). This just checks it's
// reachable and actually renders the page, not a 404/500 or an empty shell.
const baseUrl = inject("baseUrl");

it("publishes a How to Play page at /how-to-play/", async () => {
  const res = await fetch(new URL("/how-to-play/", baseUrl));
  expect(res.status).toBe(200);
  const body = await res.text();
  expect(body).toContain("How to Play");
  expect(body).toContain("Deployment");
});

it("also answers at /how-to-play (no trailing slash)", async () => {
  const res = await fetch(new URL("/how-to-play", baseUrl));
  expect(res.status).toBe(200);
});
