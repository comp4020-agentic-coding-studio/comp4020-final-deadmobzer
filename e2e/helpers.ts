// Shared helpers for the e2e/ suite. Everything here drives the real browser
// (Playwright `Page`) through the real UI — forms, buttons, and the
// window.__testHooks canvas escape hatch (src/client/Game.tsx) — and reads
// authoritative state back from the same JSON API the client itself calls
// (never a separate/mocked source of truth).
import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

export interface TestUnit {
  iid: string;
  owner: 0 | 1;
  name: string;
  pos: { x: number; y: number };
  hp: number;
  alive: boolean;
  activatedThisRound: boolean;
  acts: { name: string; tags: string[]; range?: [number, number] | "melee" | "self" }[];
}
export interface TestState {
  phase: "deploy" | "playing" | "over";
  round: number;
  activeSide: 0 | 1;
  mapSize: number;
  units: TestUnit[];
  log: { text: string; actor: string; dice?: number[] }[];
}
export interface TestGameView {
  role: "p0" | "p1" | "spectator";
  state: TestState;
}

export function uniqueName(): string {
  return "e2e" + Math.random().toString(36).slice(2, 10);
}

// Sign up a fresh account through the real /signup form (not an API shortcut)
// and land back on "/", proving the auth flow itself works end to end.
export async function signUpViaForm(page: Page): Promise<{ username: string; displayName: string }> {
  const username = uniqueName();
  const displayName = "Player " + username;
  await page.goto("/");
  await page.locator('form[action="/signup"] input[name="username"]').fill(username);
  await page.locator('form[action="/signup"] input[name="display_name"]').fill(displayName);
  await page.locator('form[action="/signup"] input[name="password"]').fill("password1234");
  await Promise.all([
    page.waitForURL((u) => u.pathname === "/"),
    page.locator('form[action="/signup"] button[type="submit"]').click(),
  ]);
  await expect(page.locator("h1")).toContainText("Welcome");
  return { username, displayName };
}

// Host creates a private lobby (fixed roster) and returns the share code shown
// on screen — the same code a real second player would be told out of band.
export async function createLobby(page: Page, house: string): Promise<string> {
  await page.goto("/play");
  await page.locator("select").first().selectOption("fixed"); // mode
  await page.locator("select").nth(1).selectOption(house); // house
  await page.getByRole("button", { name: "Create lobby code" }).click();
  const codeEl = page.locator(".code");
  await expect(codeEl).toBeVisible();
  const code = (await codeEl.textContent())?.trim();
  if (!code) throw new Error("lobby code never appeared");
  return code;
}

// Guest joins by code; the real UI's location.assign() takes this page
// straight to /g/<gameId> once the server starts the game.
export async function joinLobby(page: Page, house: string, code: string): Promise<string> {
  await page.goto("/play");
  await page.locator("select").first().selectOption("fixed");
  await page.locator("select").nth(1).selectOption(house);
  await page.locator('input[placeholder="CODE"]').fill(code);
  await Promise.all([
    page.waitForURL((u) => /^\/g\//.test(u.pathname)),
    page.getByRole("button", { name: "Join", exact: true }).click(),
  ]);
  const m = /\/g\/([^/?#]+)/.exec(page.url());
  if (!m) throw new Error("did not land on a game room after joining");
  return m[1];
}

// Navigate (or re-navigate) to the game room with the test-hook escape hatch
// armed (see the testHooksRequested() gate in src/client/Game.tsx), and wait
// for window.__testHooks to actually exist before handing back control —
// otherwise an early pickUnit/pickTile call races the client's mount effect.
export async function gotoGameWithHooks(page: Page, gameId: string): Promise<void> {
  const url = `/g/${gameId}?testHooks=1`;
  if (!page.url().includes(gameId)) await page.goto(url);
  else if (!page.url().includes("testHooks=1")) await page.goto(url);
  await page.waitForFunction(() => Boolean((window as unknown as { __testHooks?: unknown }).__testHooks));
  await expect(page.locator(".board canvas")).toBeVisible();
}

// Read the authoritative GameState the same way the client does — a same-origin
// fetch inside the page, riding the session cookie already in this browser
// context. This never asserts on anything the UI "claims"; it asserts on what
// the server actually persisted.
export async function fetchView(page: Page, gameId: string): Promise<TestGameView> {
  return page.evaluate(async (id) => {
    const res = await fetch(`/api/game/${id}`, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`GET /api/game/${id} -> ${res.status}`);
    return res.json();
  }, gameId);
}

export async function fetchMoves(page: Page, gameId: string, iid: string): Promise<{ x: number; y: number }[]> {
  return page.evaluate(async ([id, unit]) => {
    const res = await fetch(`/api/game/${id}/moves?iid=${encodeURIComponent(unit)}`);
    return (await res.json()).tiles;
  }, [gameId, iid] as const);
}

export async function fetchTargets(
  page: Page, gameId: string, iid: string, ability: string,
): Promise<{ iid: string; pos: { x: number; y: number } }[]> {
  return page.evaluate(async ([id, unit, ab]) => {
    const res = await fetch(`/api/game/${id}/targets?iid=${encodeURIComponent(unit)}&ability=${encodeURIComponent(ab)}`);
    return (await res.json()).targets;
  }, [gameId, iid, ability] as const);
}

// ---- canvas interaction via window.__testHooks (see src/client/Game.tsx) ----
// Both calls below land on the exact same handlersRef.current.pickUnit/pickTile
// a real canvas click would call; they only replace "click this pixel" with
// "click this game coordinate / this unit id" so the test isn't fragile to
// camera angle, standee layout, or where the deploy bench happens to render.

export async function hookPickUnit(page: Page, iid: string): Promise<void> {
  await page.evaluate((id) => (window as unknown as { __testHooks: { pickUnit: (i: string) => void } })
    .__testHooks.pickUnit(id), iid);
}
export async function hookPickTile(page: Page, x: number, y: number): Promise<void> {
  await page.evaluate(([tx, ty]) => (window as unknown as { __testHooks: { pickTile: (x: number, y: number) => void } })
    .__testHooks.pickTile(tx, ty), [x, y] as const);
}

// The deploy-phase bench list (src/client/Game.tsx's `.bench` panel) is plain
// DOM — a real click works fine there, no escape hatch needed. Deploys every
// one of `side`'s unplaced units (necromancer + full roster) in a deterministic
// snake fill of its own edge band, mirroring spec/helpers.ts's deployBothSides
// so the two harnesses agree on what a "legal" deploy looks like.
export async function deploySide(page: Page, gameId: string, side: 0 | 1): Promise<void> {
  const view = await fetchView(page, gameId);
  const mapSize = view.state.mapSize;
  const mine = view.state.units.filter((u) => u.owner === side && u.pos.x < 0);
  for (let i = 0; i < mine.length; i++) {
    // Snake-fill the edge band by loop index, same scheme as
    // spec/helpers.ts's deployBothSides, so both harnesses agree on "legal":
    // row 0 (then row 1) from side 0's edge, mirrored from the far edge for side 1.
    const x = i % mapSize;
    const y = side === 0 ? (i < mapSize ? 0 : 1) : (i < mapSize ? mapSize - 1 : mapSize - 2);
    const bench = page.locator(".bench button").first();
    await expect(bench).toBeVisible();
    await bench.click();
    await hookPickTile(page, x, y);
    // wait for this unit to drop off the bench before placing the next one
    await expect(page.locator(".bench button")).toHaveCount(mine.length - i - 1, { timeout: 10_000 });
  }
}

function abilityButton(page: Page, name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return page.locator(".acts button").filter({ hasText: new RegExp(`^${escaped}$`) });
}

// Drive one activation for whichever unit is passed in, preferring a real
// melee attack (so at least one run produces a hit/graze roll and a possible
// HP change in the battle log), falling back to a move that closes distance,
// and falling back again to the global "End turn" button if a unit is
// completely boxed in. Every branch is a real DOM/canvas interaction, never a
// direct API call standing in for a client action.
export async function activateUnit(page: Page, gameId: string, unit: TestUnit, enemies: TestUnit[]): Promise<string> {
  await hookPickUnit(page, unit.iid);

  const meleeAttack = unit.acts.find((a) => a.tags.includes("melee") && a.tags.includes("attack"));
  if (meleeAttack) {
    const targets = await fetchTargets(page, gameId, unit.iid, meleeAttack.name);
    if (targets.length > 0) {
      // Arming an ability triggers Game.tsx's effect to GET /targets and only
      // then populate the `targetable` state that handlersRef.current.pickUnit
      // checks before firing — wait for that round trip to land before the
      // test's own pickUnit, or the click can race an empty targetable array.
      const [resp] = await Promise.all([
        page.waitForResponse((r) => r.url().includes("/targets?") && r.status() === 200),
        abilityButton(page, meleeAttack.name).click(),
      ]);
      await resp.finished();
      await hookPickUnit(page, targets[0].iid);
      return `attack: ${unit.name} used ${meleeAttack.name}`;
    }
  }

  const reachable = await fetchMoves(page, gameId, unit.iid);
  if (reachable.length > 0 && enemies.length > 0) {
    const dist = (p: { x: number; y: number }) =>
      Math.min(...enemies.map((e) => Math.max(Math.abs(e.pos.x - p.x), Math.abs(e.pos.y - p.y))));
    const best = reachable.reduce((a, b) => (dist(b) < dist(a) ? b : a));
    await hookPickTile(page, best.x, best.y);
    return `move: ${unit.name} to (${best.x},${best.y})`;
  }

  // boxed in / nothing sensible to do — forfeit this unit's activation via the
  // same global "End turn" control a stuck human player would click.
  await page.getByRole("button", { name: "End turn", exact: true }).click();
  return `endTurn (boxed in): ${unit.name}`;
}
