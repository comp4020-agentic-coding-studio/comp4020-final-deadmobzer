// No script injection: user content is returned as text, never live markup, and
// a strict CSP is set on responses. Guards the new user-content surfaces (chat,
// names) against stored/reflected XSS.
import { expect, inject, it, describe } from "vitest";
import { api, get, startGame } from "./helpers.ts";

const baseUrl = inject("baseUrl");

describe("no script injection", () => {
  it("a chat message with a script payload comes back escaped, not live", async () => {
    const { a, gameId } = await startGame(baseUrl);
    const payload = `<script>alert(1)</script><img src=x onerror=alert(2)>`;
    const post = await api(baseUrl, a.sid, `/api/game/${gameId}/chat`, { channel: "player", body: payload });
    expect(post.status).toBe(200);
    const view = await (await api(baseUrl, a.sid, `/api/game/${gameId}`, undefined, "GET")).json();
    const last = view.chat.player.at(-1);
    expect(last.body).not.toContain("<script>");
    expect(last.body).not.toContain("<img");
    expect(last.body).toContain("&lt;script&gt;");
  });

  it("a strict CSP header is present (scripts self-only, no inline)", async () => {
    const res = await get(baseUrl, "/");
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });
});
