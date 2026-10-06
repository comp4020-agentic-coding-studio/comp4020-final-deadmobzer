// The app runs on a single server day in the course's timezone. "Today" is
// derived from the clock on each request — no scheduler. APP_TODAY pins the day
// for manual testing and for seeing the next-day reveal without waiting.
export const TZ = "Australia/Canberra";

export function dayIn(tz: string, at: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD, which sorts and compares as a plain string.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

export function today(): string {
  return process.env.APP_TODAY ?? dayIn(TZ);
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

export function yesterday(day: string = today()): string {
  return addDays(day, -1);
}

export function nowISO(): string {
  return new Date().toISOString();
}
