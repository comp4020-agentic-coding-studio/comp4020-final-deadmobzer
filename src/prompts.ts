// Two curated pools. The friend prompt carries a [friend] placeholder filled
// with the target's display name when a day's task is created. The chosen text
// is stored on the task row so a prompt never changes under someone mid-day.

export const SELF_PROMPTS = [
  "One thing I'm grateful for today is…",
  "Something that went better than I expected today…",
  "A small moment I want to remember from today…",
  "One thing that was hard today, and how I met it…",
  "Something I'm looking forward to…",
  "A way I was kind to myself today…",
  "What gave me energy today?",
  "One thing I learned about myself today…",
];

export const FRIEND_PROMPTS = [
  "One thing I appreciate about [friend] is…",
  "A moment [friend] made better just by being there…",
  "Something [friend] is good at that they might not notice…",
  "What I'd thank [friend] for, if it wasn't awkward to say…",
  "A way [friend] has grown that I admire…",
  "Something I hope goes well for [friend] soon…",
  "Why I'm glad [friend] is in my life…",
];

// Deterministic pick: same (day, user) always lands on the same prompt, so a
// restart mid-day doesn't reshuffle anyone's prompt before it's stored.
function pick<T>(pool: T[], seed: string): T {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return pool[Math.abs(h) % pool.length];
}

export function selfPromptFor(day: string, userId: number): string {
  return pick(SELF_PROMPTS, `self:${day}:${userId}`);
}

export function friendPromptFor(day: string, userId: number, friendName: string): string {
  return pick(FRIEND_PROMPTS, `friend:${day}:${userId}`).replace("[friend]", friendName);
}
