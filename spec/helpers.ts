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

// A JSON API call with a session cookie.
export async function api(
  baseUrl: string, sid: string, path: string, body?: unknown, method = "POST",
): Promise<Response> {
  return fetch(new URL(path, baseUrl), {
    method,
    redirect: "manual",
    headers: { "content-type": "application/json", cookie: "sid=" + sid },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

// Start a fresh game between two new users via the lobby flow, then deploy both
// sides so the game reaches "playing" — createGameRecord no longer auto-deploys
// (src/games.ts), games start in the engine's default "deploy" phase and the
// client (or a test) places units via the "deploy" action. This mirrors
// autoDeploy's old row-filling (src/game/engine.ts): side 0 fills y=0 then y=1,
// side 1 fills y=mapSize-1 then y=mapSize-2, by column index — within the
// deployFromEdgeSpaces=2 band the engine now enforces.
export async function startGame(baseUrl: string): Promise<{
  a: TestUser; b: TestUser; gameId: string; palette: string[];
}> {
  const a = await signup(baseUrl);
  const b = await signup(baseUrl);
  const facs = await (await fetch(new URL("/api/factions", baseUrl))).json();
  const palette = facs.palette as string[];
  const create = await (await api(baseUrl, a.sid, "/api/lobby/create",
    { mode: "fixed", visibility: "private", house: "carcass", colour: palette[0], units: [] })).json();
  const join = await (await api(baseUrl, b.sid, "/api/lobby/join",
    { code: create.code, mode: "fixed", house: "goregrinders", colour: palette[3], units: [] })).json();
  const gameId = join.gameId as string;
  await deployBothSides(baseUrl, a.sid, b.sid, gameId);
  return { a, b, gameId, palette };
}

// Deploy every unit for both sides of a game still in "deploy" phase, one
// placements batch (the engine loops over the array) per side, each within its
// own edge band.
export async function deployBothSides(baseUrl: string, aSid: string, bSid: string, gameId: string): Promise<void> {
  const view = await (await get(baseUrl, `/api/game/${gameId}`, aSid)).json();
  const { mapSize, units } = view.state as { mapSize: number; units: { iid: string; owner: 0 | 1 }[] };
  for (const [side, sid] of [[0, aSid], [1, bSid]] as const) {
    const mine = units.filter((u) => u.owner === side);
    const placements = mine.map((u, i) => ({
      iid: u.iid,
      pos: { x: i % mapSize, y: side === 0 ? (i < mapSize ? 0 : 1) : (i < mapSize ? mapSize - 1 : mapSize - 2) },
    }));
    const res = await api(baseUrl, sid, `/api/game/${gameId}/action`, { action: { kind: "deploy", placements } });
    if (!res.ok) throw new Error(`deploy failed for side ${side} (${res.status})`);
  }
}
