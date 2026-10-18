// Server-side audit log for crit 10 ("Fly by instruments"): who did what, read
// from `flyctl logs`. Each state change and each sign-in emits one readable line
// keyed by username, so two people using the app can be told apart from the logs
// alone. It deliberately records the ACTION, never the reflection content — the
// seal/privacy invariants hold in the logs too.

import { AsyncLocalStorage } from "node:async_hooks";

type Field = string | number;

// Values are whitespace-collapsed so each record stays one greppable token-set
// (usernames are already space-free; this guards display-derived values).
function safe(v: Field): string {
  return String(v).replace(/\s+/g, "_");
}

// Carries the current HTTP request's id across every function call made while
// handling it (src/server.ts runs each request inside requestContext.run), so
// a line logged deep in src/games.ts or src/lobbies.ts still carries it without
// threading an id parameter through every function on the call path. One
// request can touch several audit lines (e.g. an action that ends the game
// also updates ELO) — the shared req= is what ties them into one trace in
// `flyctl logs`.
const requestContext = new AsyncLocalStorage<string>();

export function withRequestId<T>(id: string, fn: () => T): T {
  return requestContext.run(id, fn);
}

export function formatAudit(
  actor: string,
  action: string,
  fields: Record<string, Field> = {},
): string {
  const parts = [`user=${safe(actor)}`, `action=${action}`];
  const reqId = requestContext.getStore();
  if (reqId) parts.push(`req=${reqId}`);
  for (const [k, v] of Object.entries(fields)) parts.push(`${k}=${safe(v)}`);
  return `audit ${parts.join(" ")}`;
}

export function audit(actor: string, action: string, fields?: Record<string, Field>): void {
  console.log(formatAudit(actor, action, fields));
}
