import { db } from "./db.ts";
import { maximumMatching } from "./matching.ts";
import { friendPromptFor, selfPromptFor } from "./prompts.ts";
import { nowISO, today } from "./time.ts";

export interface DailyTask {
  self_prompt_text: string;
  friend_target_id: number | null;
  friend_prompt_text: string | null;
  friend_name: string | null;
}

// Generate a day's prompts and friend matching exactly once. Runs in a single
// synchronous transaction; because the process is single-threaded and
// better-sqlite3 is synchronous, the daily_runs lock makes concurrent callers
// on a fresh day safe — the first wins, the rest see the marker and return.
export const ensureAssignments = db.transaction((day: string): void => {
  const already = db.prepare("SELECT 1 FROM daily_runs WHERE day = ?").get(day);
  if (already) return;

  const users = db.prepare("SELECT id FROM users").all() as { id: number }[];

  // Build the friendship adjacency among users who have at least one friend.
  const adjacency = new Map<number, number[]>();
  for (const { id } of users) {
    const friends = db
      .prepare(
        `SELECT CASE WHEN requester_id = ? THEN addressee_id ELSE requester_id END AS fid
           FROM friendships
          WHERE status = 'accepted' AND (requester_id = ? OR addressee_id = ?)`,
      )
      .all(id, id, id) as { fid: number }[];
    if (friends.length > 0) adjacency.set(id, friends.map((f) => f.fid));
  }

  // Reciprocal matching first: each matched target is written about once.
  const matched = maximumMatching(adjacency);

  // Writers the matching left out still get someone to write about, so everyone
  // with a friend gets their friend-prompt. Degenerate graphs (e.g. a star) can
  // still leave a few people unread on a given day — the guarantee holds only
  // when the graph admits a matching.
  const assignment = new Map<number, number>(matched);
  for (const [writer, candidates] of adjacency) {
    if (!assignment.has(writer)) {
      // Deterministic fallback: lowest friend id that isn't the writer.
      const target = [...candidates].sort((a, b) => a - b)[0];
      if (target !== undefined) assignment.set(writer, target);
    }
  }

  const nameOf = db.prepare("SELECT display_name FROM users WHERE id = ?");
  const insert = db.prepare(
    `INSERT OR IGNORE INTO daily_tasks
       (day, user_id, self_prompt_text, friend_target_id, friend_prompt_text)
     VALUES (?, ?, ?, ?, ?)`,
  );

  for (const { id } of users) {
    const targetId = assignment.get(id) ?? null;
    let friendPrompt: string | null = null;
    if (targetId !== null) {
      const name = (nameOf.get(targetId) as { display_name: string }).display_name;
      friendPrompt = friendPromptFor(day, id, name);
    }
    insert.run(day, id, selfPromptFor(day, id), targetId, friendPrompt);
  }

  db.prepare("INSERT INTO daily_runs (day, created_at) VALUES (?, ?)").run(day, nowISO());
});

export function taskFor(userId: number, day: string = today()): DailyTask {
  ensureAssignments(day);
  const row = db
    .prepare(
      `SELECT t.self_prompt_text, t.friend_target_id, t.friend_prompt_text, u.display_name AS friend_name
         FROM daily_tasks t
         LEFT JOIN users u ON u.id = t.friend_target_id
        WHERE t.day = ? AND t.user_id = ?`,
    )
    .get(day, userId) as DailyTask | undefined;
  // A user who joined after today's run has no row yet; give them one now.
  if (!row) {
    db.prepare(
      "INSERT OR IGNORE INTO daily_tasks (day, user_id, self_prompt_text) VALUES (?, ?, ?)",
    ).run(day, userId, selfPromptFor(day, userId));
    return {
      self_prompt_text: selfPromptFor(day, userId),
      friend_target_id: null,
      friend_prompt_text: null,
      friend_name: null,
    };
  }
  return row;
}
