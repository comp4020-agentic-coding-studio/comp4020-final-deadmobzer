import type { User } from "../auth.ts";
import type { Friend, PendingRequest } from "../friends.ts";
import type { CalendarDay, ReceivedNote, SelfEntry } from "../entries.ts";
import type { DailyTask } from "../daily.ts";

// Everything here is plain JSON: the server serialises it into window.__DATA__
// and the client hydrates from the same shape, so props must match exactly on
// both sides (no Dates, no functions).

export type Mode = "light" | "dark";

export type Route = "landing" | "today" | "calendar" | "day" | "friends" | "about";

export type PageData =
  | { route: "landing"; error?: string }
  | {
      route: "today";
      task: DailyTask;
      mine: { self?: SelfEntry; friend?: SelfEntry };
      yesterday: ReceivedNote[];
      todayLabel: string;
      flash?: string;
    }
  | { route: "calendar"; days: CalendarDay[] }
  | { route: "day"; day: string; self: SelfEntry | null; notes: ReceivedNote[] }
  | { route: "friends"; friends: Friend[]; incoming: PendingRequest[]; flash?: string }
  | { route: "about"; html: string };

export interface AppProps {
  user: User | null;
  mode: Mode;
  page: PageData;
}

export type { User, Friend, PendingRequest, CalendarDay, ReceivedNote, SelfEntry, DailyTask };
