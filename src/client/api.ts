// Thin fetch helpers for the JSON API. The session cookie rides along
// automatically; we only ever send/receive JSON.
import type { CSSProperties } from "react";

// --house is a CSS custom property (see public/app.css) that drives the
// per-House accent colour (data/style.json's house_accents) across the SPA.
// React's CSSProperties type doesn't know custom-property names, so this is
// the one narrow cast point every page that sets --house shares, instead of
// each page re-deriving its own.
export function houseStyle(accent: string | undefined): (CSSProperties & { "--house"?: string }) | undefined {
  return accent ? { "--house": accent } : undefined;
}

// Every unit's portrait lives at /art/portraits/<house>/<id>.png EXCEPT the
// necromancer: scripts/extract-art.py always names that one file
// "necromancer.png", regardless of the necromancer's own data id (e.g.
// carcass's is "operator") — so building the path straight from the unit id
// 404s for every House's necromancer. necromancerId is the faction's
// necromancer.id (from /api/factions), used to detect that one case.
export function portraitPath(house: string, unitId: string, necromancerId?: string): string {
  const file = unitId === necromancerId ? "necromancer" : unitId;
  return `/art/portraits/${house}/${file}.png`;
}

export async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json() as Promise<T>;
}

export async function postJSON<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `${res.status}`);
  return data;
}

// Open the game-room socket; calls onEvent for each live event.
export function openGameSocket(gameId: string, onEvent: (ev: { type: string }) => void): WebSocket {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws?game=${encodeURIComponent(gameId)}`);
  ws.onmessage = (e) => {
    try { onEvent(JSON.parse(e.data)); } catch { /* ignore */ }
  };
  return ws;
}

// The per-user socket (no `?game=`, see src/realtime.ts) — friend requests,
// acceptances, and presence. Opened once per app session (App.tsx), not
// per-page, since it carries events relevant across the whole SPA.
export function openUserSocket(onEvent: (ev: { type: string }) => void): WebSocket {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onmessage = (e) => {
    try { onEvent(JSON.parse(e.data)); } catch { /* ignore */ }
  };
  return ws;
}
