import { db } from "./db.ts";
import { taskFor } from "./daily.ts";
import { isRevealed } from "./reveal.ts";
import { nowISO, today, yesterday } from "./time.ts";

export { isRevealed };

export class EntryError extends Error {}

export interface ReceivedNote {
  day: string;
  prompt_text: string;
  body: string;
  author_name: string;
}

export interface SelfEntry {
  day: string;
  prompt_text: string;
  body: string;
}

// Write (or refine, same day) one of today's two answers. The prompt and — for
// a friend note — the target are taken from the day's assigned task, so a writer
// can only ever write about the friend they were matched with.
export function writeEntry(userId: number, kind: "self" | "friend", body: string): void {
  const text = body.trim();
  if (!text) throw new EntryError("Write something first.");
  const day = today();
  const task = taskFor(userId, day);

  let targetId: number | null = null;
  let prompt: string;
  if (kind === "self") {
    prompt = task.self_prompt_text;
  } else {
    if (task.friend_target_id === null || task.friend_prompt_text === null) {
      throw new EntryError("You have no friend prompt today — add a friend first.");
    }
    targetId = task.friend_target_id;
    prompt = task.friend_prompt_text;
  }

  db.prepare(
    `INSERT INTO entries (day, author_id, kind, target_id, prompt_text, body, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (day, author_id, kind)
       DO UPDATE SET body = excluded.body, prompt_text = excluded.prompt_text,
                     target_id = excluded.target_id, created_at = excluded.created_at`,
  ).run(day, userId, kind, targetId, prompt, text, nowISO());
}

// What the author wrote today (to show their own answers back as "done").
export function myEntriesToday(userId: number, day: string = today()): Record<string, SelfEntry> {
  const rows = db
    .prepare("SELECT kind, day, prompt_text, body FROM entries WHERE author_id = ? AND day = ?")
    .all(userId, day) as (SelfEntry & { kind: string })[];
  const out: Record<string, SelfEntry> = {};
  for (const r of rows) out[r.kind] = { day: r.day, prompt_text: r.prompt_text, body: r.body };
  return out;
}

// Notes written about `userId` on `onDay`, returned only if they've unsealed
// relative to the viewer's current day. The reveal gate lives here so no caller
// can accidentally leak a sealed note.
export function receivedNotes(userId: number, onDay: string, viewerDay: string = today()): ReceivedNote[] {
  if (!isRevealed(onDay, viewerDay)) return [];
  return db
    .prepare(
      `SELECT e.day, e.prompt_text, e.body, u.display_name AS author_name
         FROM entries e JOIN users u ON u.id = e.author_id
        WHERE e.kind = 'friend' AND e.target_id = ? AND e.day = ?
        ORDER BY e.created_at`,
    )
    .all(userId, onDay) as ReceivedNote[];
}

// The home-page reveal: what a friend wrote about you yesterday.
export function notesFromYesterday(userId: number): ReceivedNote[] {
  return receivedNotes(userId, yesterday(), today());
}

// Calendar: every day the user wrote a self-reflection, newest first, flagged
// with whether a friend's note for that day has unsealed.
export interface CalendarDay {
  day: string;
  has_note: boolean;
}

export function calendar(userId: number, viewerDay: string = today()): CalendarDay[] {
  const days = db
    .prepare(
      "SELECT DISTINCT day FROM entries WHERE author_id = ? AND kind = 'self' ORDER BY day DESC",
    )
    .all(userId) as { day: string }[];
  return days.map(({ day }) => ({
    day,
    has_note: receivedNotes(userId, day, viewerDay).length > 0,
  }));
}

// One past day for the calendar detail view: the user's own reflection plus any
// unsealed note they received that day.
export function dayDetail(userId: number, day: string, viewerDay: string = today()) {
  const self = db
    .prepare(
      "SELECT day, prompt_text, body FROM entries WHERE author_id = ? AND kind = 'self' AND day = ?",
    )
    .get(userId, day) as SelfEntry | undefined;
  return { self: self ?? null, notes: receivedNotes(userId, day, viewerDay) };
}
