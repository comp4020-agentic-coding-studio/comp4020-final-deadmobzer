import { Link, Route, Switch, useLocation } from "wouter";
import { Lobby } from "./Lobby.tsx";
import { Game } from "./Game.tsx";
import { Home } from "./Home.tsx";
import { Friends } from "./Friends.tsx";
import { Profile } from "./Profile.tsx";

// The persistent nav, rendered once outside <Switch> — this is what makes
// navigation between pages feel instant instead of a page-by-page reload.
// Links mirror src/serverview.ts's HEADER (same labels/order, same markup
// shape so .app-body > header's CSS, shared with the server-rendered pages,
// applies unchanged); "How to Play" and "About" stay real <a> links on
// purpose — those two pages are plain static content and deliberately
// weren't moved into the SPA (they gain nothing from client routing, and a
// hard navigation there is invisible either way).
function Nav() {
  const [path] = useLocation();
  const on = (p: string) => (path === p ? "on" : "");
  return (
    <header>
      <span className="brand">Maleghast Online</span>
      <Link href="/" className={on("/")}>Home</Link>
      <Link href="/play" className={on("/play")}>Play</Link>
      <a href="/how-to-play/">How to Play</a>
      <Link href="/friends" className={on("/friends")}>Friends</Link>
      <Link href="/profile" className={on("/profile")}>Profile</Link>
      <a href="/readme/">About</a>
    </header>
  );
}

// The game room (/g/:id) is full-bleed, like appShell("Table") already was
// server-side (no header option passed) — every other route gets the nav.
export function App() {
  const [path] = useLocation();
  const fullBleed = /^\/g\//.test(path);
  return (
    <>
      {!fullBleed && <Nav />}
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/play" component={Lobby} />
        <Route path="/g/:id">{(params) => <Game gameId={params.id} />}</Route>
        <Route path="/friends" component={Friends} />
        <Route path="/profile" component={Profile} />
      </Switch>
    </>
  );
}
