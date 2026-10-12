// Server-side audit log for crit 10 ("Fly by instruments"): who did what, read
// from `flyctl logs`. Each state change and each sign-in emits one readable line
// keyed by username, so two people using the app can be told apart from the logs
// alone. It deliberately records the ACTION, never the reflection content — the
// seal/privacy invariants hold in the logs too.

type Field = string | number;

// Values are whitespace-collapsed so each record stays one greppable token-set
// (usernames are already space-free; this guards display-derived values).
function safe(v: Field): string {
  return String(v).replace(/\s+/g, "_");
}

export function formatAudit(
  actor: string,
  action: string,
  fields: Record<string, Field> = {},
): string {
  const parts = [`user=${safe(actor)}`, `action=${action}`];
  for (const [k, v] of Object.entries(fields)) parts.push(`${k}=${safe(v)}`);
  return `audit ${parts.join(" ")}`;
}

export function audit(actor: string, action: string, fields?: Record<string, Field>): void {
  console.log(formatAudit(actor, action, fields));
}
