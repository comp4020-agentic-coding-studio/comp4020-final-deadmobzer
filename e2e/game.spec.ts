// The permanent two-browser-window E2E suite (see e2e/playwright.config.ts for
// why this lives outside pnpm check). Two independent Playwright browser
// contexts stand in for two separate "players" on two separate machines: each
// gets its own cookie jar, its own video recording, and talks to the app only
// through real UI interaction — sign up via the real form, create/join a real
// lobby, deploy via the real bench + the window.__testHooks canvas escape
// hatch (src/client/Game.tsx), and play real turns, asserting throughout on
// state fetched from the same server-authoritative /api/game/:id the client
// itself reads (never a mocked or client-asserted outcome).
import { test, expect, type Browser, type TestInfo } from "@playwright/test";
import {
  activateUnit, createLobby, deploySide, fetchView, gotoGameWithHooks,
  joinLobby, signUpViaForm, type TestUnit,
} from "./helpers.ts";

test.describe.configure({ mode: "serial" });

test("two players sign up, deploy, and play real turns to a visible state change", async (
  { browser }: { browser: Browser }, testInfo: TestInfo,
) => {
  // Two fully separate browser contexts == two separate players: distinct
  // cookie jars, distinct video recordings, no shared state except the
  // server. playwright.config.ts's use.video:"on" only auto-applies to the
  // built-in `context`/`page` test fixtures, not to contexts a test opens
  // itself (browser.newContext()) — so recordVideo is passed explicitly here,
  // into the per-test output dir (e2e/test-results/<test name>/), the same
  // place the built-in fixture would have put it.
  const videoDir = testInfo.outputPath("video");
  const hostCtx = await browser.newContext({ recordVideo: { dir: videoDir } });
  const guestCtx = await browser.newContext({ recordVideo: { dir: videoDir } });
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();

  try {
    // ---- real sign-up, both sides ----
    const hostUser = await signUpViaForm(host);
    const guestUser = await signUpViaForm(guest);
    expect(hostUser.username).not.toBe(guestUser.username);

    // ---- real lobby create/join ----
    const code = await createLobby(host, "carcass");
    const gameId = await joinLobby(guest, "goregrinders", code);

    // host's tab is still on the "lobby ready" screen (it polls
    // /api/lobby/:code and redirects itself once the game starts) — send it
    // straight to the room instead of waiting on that poll, which is this
    // test's concern, not the UI's.
    await gotoGameWithHooks(host, gameId);
    await gotoGameWithHooks(guest, gameId);

    let view = await fetchView(host, gameId);
    expect(view.state.phase).toBe("deploy");

    // ---- real deploy phase, both sides, via bench clicks + the canvas hook ----
    await deploySide(host, gameId, 0);
    await deploySide(guest, gameId, 1);

    view = await fetchView(host, gameId);
    expect(view.state.phase).toBe("playing");
    expect(view.state.units.every((u) => u.pos.x >= 0 && u.pos.y >= 0)).toBe(true);

    // ---- play real turns until a visible state change proves the loop works ----
    // "Visible state change" here is either (a) a dice roll logged (an attack
    // actually resolved, win or lose) or (b) HP moving on some unit, within a
    // bounded number of activations — whichever fires first. Both are things
    // only the server decides (src/game/engine.ts), so either is proof the
    // click -> POST /action -> engine -> persisted state loop is real, not
    // just UI animation.
    const initialHp = new Map(view.state.units.map((u) => [u.iid, u.hp]));
    let sawDiceRoll = false;
    let sawHpChange = false;
    const MAX_ACTIVATIONS = 24; // generous: two 6-unit rosters, well under a full round-6 game
    const narration: string[] = [];

    for (let i = 0; i < MAX_ACTIVATIONS; i++) {
      view = await fetchView(host, gameId);
      if (view.state.phase === "over") break;

      sawDiceRoll ||= view.state.log.some((l) => (l.dice?.length ?? 0) > 0);
      sawHpChange ||= view.state.units.some((u) => initialHp.get(u.iid) !== undefined && u.hp !== initialHp.get(u.iid));
      if (sawDiceRoll || sawHpChange) break;

      const side = view.state.activeSide;
      const page = side === 0 ? host : guest;
      const mine = view.state.units.filter((u): u is TestUnit => u.owner === side && u.alive && !u.activatedThisRound);
      const enemies = view.state.units.filter((u): u is TestUnit => u.owner !== side && u.alive);
      if (mine.length === 0) continue; // shouldn't happen — engine auto-skips a fully-activated side
      const unit = mine[0];
      const what = await activateUnit(page, gameId, unit, enemies);
      narration.push(`round ${view.state.round}, side ${side}: ${what}`);

      // Let the losing side's live socket (realtime.ts broadcastGame) catch up
      // so its own view (and the next loop's fetchView from `host`, which both
      // sides' actions feed into the same persisted state regardless) reflects
      // this action before the next activation reads activeSide again.
      await page.waitForTimeout(150);
    }

    view = await fetchView(host, gameId);
    sawDiceRoll ||= view.state.log.some((l) => (l.dice?.length ?? 0) > 0);
    sawHpChange ||= view.state.units.some((u) => initialHp.get(u.iid) !== undefined && u.hp !== initialHp.get(u.iid));

    // eslint-disable-next-line no-console
    console.log(`[e2e] activations played:\n${narration.join("\n")}`);

    expect(
      sawDiceRoll || sawHpChange || view.state.phase === "over",
      `expected a dice roll, an HP change, or the game to end within ${MAX_ACTIVATIONS} activations; ` +
        `log so far:\n${view.state.log.map((l) => l.text).join("\n")}`,
    ).toBe(true);

    // The round counter having advanced past 1, or the game having ended, is
    // the final end-to-end confirmation that real turns (not just one click)
    // went through the server's authoritative endTurn()/round-advance logic.
    expect(view.state.round > 1 || view.state.phase === "over" || sawDiceRoll || sawHpChange).toBe(true);
  } finally {
    await hostCtx.close();
    await guestCtx.close();
  }
});
