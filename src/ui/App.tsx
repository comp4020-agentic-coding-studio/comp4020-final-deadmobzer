import { useCallback, useEffect, useMemo, useState } from "react";
import { ThemeProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import Container from "@mui/material/Container";
import Snackbar from "@mui/material/Snackbar";
import { buildTheme } from "./theme.ts";
import BottomNav from "./BottomNav.tsx";
import ThemeToggle from "./ThemeToggle.tsx";
import Landing from "./pages/Landing.tsx";
import Today from "./pages/Today.tsx";
import Calendar from "./pages/Calendar.tsx";
import Day from "./pages/Day.tsx";
import Friends from "./pages/Friends.tsx";
import About from "./pages/About.tsx";
import type { AppProps, Friend, Mode, PageData, PendingRequest } from "./types.ts";

interface Social {
  friends: Friend[];
  incoming: PendingRequest[];
}

const socialFromPage = (page: PageData): Social | null =>
  page.route === "friends" ? { friends: page.friends, incoming: page.incoming } : null;

export default function App(props: AppProps) {
  const { user } = props;
  const [mode, setMode] = useState<Mode>(props.mode);
  const [page, setPage] = useState<PageData>(props.page);
  const [social, setSocial] = useState<Social | null>(socialFromPage(props.page));
  const [toast, setToast] = useState<string | null>(null);

  const theme = useMemo(() => buildTheme(mode), [mode]);

  // Client-side navigation: ask the server for just this route's data and swap
  // it in. Falls back to a full load if anything is off (expired session, etc.).
  const navigate = useCallback(async (path: string, push = true) => {
    try {
      const res = await fetch(path, { headers: { "x-data": "1" } });
      const ct = res.headers.get("content-type") ?? "";
      if (!res.ok || !ct.includes("application/json")) {
        window.location.href = path;
        return;
      }
      const payload = (await res.json()) as { mode: Mode; page: PageData };
      setPage(payload.page);
      const s = socialFromPage(payload.page);
      if (s) setSocial(s);
      if (push) window.history.pushState({ path }, "", path);
      window.scrollTo(0, 0);
    } catch {
      window.location.href = path;
    }
  }, []);

  useEffect(() => {
    const onPop = () => navigate(window.location.pathname + window.location.search, false);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [navigate]);

  // Live social: relationship events arrive over the WebSocket; on each we
  // refetch authoritative state (friends + incoming, with presence) and toast
  // the relationship ones. Reflection content is never pushed here, by design.
  useEffect(() => {
    if (!user) return;
    let closed = false;
    let ws: WebSocket | null = null;

    const refresh = async () => {
      try {
        const res = await fetch("/api/state", { headers: { accept: "application/json" } });
        if (res.ok) setSocial((await res.json()) as Social);
      } catch {
        /* offline; the last state stays */
      }
    };

    const connect = () => {
      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${proto}://${window.location.host}/ws`);
      ws.addEventListener("message", (ev) => {
        let msg: { type?: string; from?: string; by?: string };
        try {
          msg = JSON.parse(String(ev.data));
        } catch {
          return;
        }
        if (msg.type === "friend_request") setToast(`${msg.from} sent you a friend request`);
        else if (msg.type === "friend_accepted") setToast(`${msg.by} accepted your friend request`);
        refresh();
      });
      ws.addEventListener("close", () => {
        if (!closed) setTimeout(connect, 3000);
      });
    };

    refresh();
    connect();
    return () => {
      closed = true;
      ws?.close();
    };
  }, [user]);

  const toggleMode = () => {
    setMode((m) => {
      const next: Mode = m === "dark" ? "light" : "dark";
      document.cookie = `theme=${next}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
      return next;
    });
  };

  const fr: Social = social ?? { friends: [], incoming: [] };

  const content = (() => {
    switch (page.route) {
      case "landing":
        return <Landing error={page.error} />;
      case "today":
        return <Today data={page} />;
      case "calendar":
        return <Calendar data={page} onNavigate={navigate} />;
      case "day":
        return <Day data={page} onNavigate={navigate} />;
      case "friends":
        return <Friends friends={fr.friends} incoming={fr.incoming} flash={page.flash} />;
      case "about":
        return <About html={page.html} />;
    }
  })();

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline enableColorScheme />
      <ThemeToggle mode={mode} onToggle={toggleMode} />
      <Container maxWidth="sm" sx={{ pt: 6, pb: user ? 14 : 6, minHeight: "100dvh" }}>
        {content}
      </Container>
      {user ? <BottomNav route={page.route} onNavigate={navigate} /> : null}
      <Snackbar
        open={toast !== null}
        autoHideDuration={4000}
        onClose={() => setToast(null)}
        message={toast ?? ""}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        sx={{ mb: user ? 11 : 2 }}
      />
    </ThemeProvider>
  );
}
