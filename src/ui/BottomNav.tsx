import type { MouseEvent } from "react";
import Paper from "@mui/material/Paper";
import BottomNavigation from "@mui/material/BottomNavigation";
import BottomNavigationAction from "@mui/material/BottomNavigationAction";
import type { Route } from "./types.ts";
import { IconAbout, IconCalendar, IconFriends, IconToday } from "./icons.tsx";

const ITEMS = [
  { route: "today", label: "Today", href: "/", Icon: IconToday },
  { route: "calendar", label: "Calendar", href: "/calendar", Icon: IconCalendar },
  { route: "friends", label: "Friends", href: "/friends", Icon: IconFriends },
  { route: "about", label: "About", href: "/readme/", Icon: IconAbout },
] as const;

// The floating bar. Each action is a real link (href) so navigation works
// without JS and direct URLs still render server-side; once hydrated the client
// intercepts the click for an instant swap. A day view highlights Calendar.
export default function BottomNav({
  route,
  onNavigate,
}: {
  route: Route;
  onNavigate?: (path: string) => void;
}) {
  const selected = route === "day" ? "calendar" : route;

  return (
    <Paper
      elevation={6}
      sx={{
        position: "fixed",
        bottom: 16,
        left: "50%",
        transform: "translateX(-50%)",
        borderRadius: 999,
        overflow: "hidden",
        bgcolor: "background.default",
        boxShadow: (t) =>
          t.palette.mode === "dark"
            ? "0 6px 24px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.08)"
            : "0 6px 24px rgba(43,38,34,0.18)",
        zIndex: 1200,
      }}
    >
      <BottomNavigation value={selected} showLabels sx={{ bgcolor: "transparent", px: 1 }}>
        {ITEMS.map(({ route: r, label, href, Icon }) => (
          <BottomNavigationAction
            key={r}
            value={r}
            label={label}
            icon={<Icon />}
            component="a"
            href={href}
            onClick={(e: MouseEvent) => {
              if (onNavigate) {
                e.preventDefault();
                onNavigate(href);
              }
            }}
            sx={{ minWidth: 72 }}
          />
        ))}
      </BottomNavigation>
    </Paper>
  );
}
