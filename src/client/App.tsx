import { Lobby } from "./Lobby.tsx";
import { Game } from "./Game.tsx";

// Tiny path-based router: /g/<id> is the table, anything else is the lobby.
export function App() {
  const m = /^\/g\/([A-Za-z0-9_-]+)/.exec(location.pathname);
  if (m) return <Game gameId={m[1]} />;
  return <Lobby />;
}
