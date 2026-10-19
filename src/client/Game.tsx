import { useEffect, useRef, useState, useCallback } from "react";
import anime from "animejs";
import { Table, type TableState } from "../three/table.ts";
import { getJSON, postJSON, openGameSocket } from "./api.ts";

interface Ability { name: string; tags: string[]; range?: [number, number] | "melee" | "self"; text: string }
interface Unit {
  iid: string; owner: 0 | 1; name: string; type: string; art: string;
  mv: number; hp: number; maxHp: number; df: number; arm: string | null;
  pos: { x: number; y: number }; tokens: Record<string, number>;
  acts: Ability[]; alive: boolean; isNecromancer: boolean; upgrade?: string;
  activatedThisRound: boolean;
}
interface State extends TableState {
  phase: string; round: number; activeSide: 0 | 1; winner: 0 | 1 | null;
  units: Unit[];
  log: { round: number; actor: string; text: string; dice?: number[] }[];
}
interface ChatMsg { id: number; displayName: string; body: string }
interface GameView {
  role: "p0" | "p1" | "spectator"; state: State; audience: number;
  chat: { player: ChatMsg[]; audience: ChatMsg[] };
}

export function Game({ gameId }: { gameId: string }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<Table | null>(null);
  const handlersRef = useRef({
    pickUnit: (_iid: string) => {},
    pickTile: (_x: number, _y: number) => {},
    hoverUnit: (_iid: string | null) => {},
  });
  const [view, setView] = useState<GameView | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [tab, setTab] = useState<"log" | "player" | "audience">("log");
  const [error, setError] = useState<string | null>(null);
  const [pendingAbility, setPendingAbility] = useState<Ability | null>(null);
  const [targetable, setTargetable] = useState<string[]>([]);

  const refetch = useCallback(async () => {
    try { setView(await getJSON<GameView>(`/api/game/${gameId}`)); }
    catch (e) { setError(String(e)); }
  }, [gameId]);

  const myseat = view?.role === "p0" ? 0 : view?.role === "p1" ? 1 : null;
  const myTurn = myseat !== null && view?.state.activeSide === myseat && view?.state.phase === "playing";
  const selectedUnit = view?.state.units.find((u) => u.iid === selected) ?? null;
  const hoverUnit = view?.state.units.find((u) => u.iid === hover) ?? null;

  // initial load + live socket
  useEffect(() => {
    refetch();
    const ws = openGameSocket(gameId, () => refetch());
    return () => ws.close();
  }, [gameId, refetch]);

  // mount the 3D table once. Its click handlers route through handlersRef, which
  // is refreshed every render — otherwise they'd capture the first render's stale
  // tryMove/selection and clicking a tile would do nothing.
  useEffect(() => {
    if (!mountRef.current || tableRef.current || !view) return;
    tableRef.current = new Table(mountRef.current, view.state, {
      onPickUnit: (iid) => handlersRef.current.pickUnit(iid),
      onPickTile: (x, y) => handlersRef.current.pickTile(x, y),
      onHoverUnit: (iid) => handlersRef.current.hoverUnit(iid),
    });
    return () => { tableRef.current?.dispose(); tableRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view !== null]);

  // pulse the status line whenever the turn or round changes (anime.js, 2D UI)
  const statusRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (statusRef.current) anime({ targets: statusRef.current, opacity: [0.3, 1], duration: 500, easing: "easeOutQuad" });
  }, [view?.state.activeSide, view?.state.round]);

  // feed new state into the table, and roll dice for any newly-logged rolls
  const lastLogLen = useRef(0);
  useEffect(() => {
    if (!view || !tableRef.current) return;
    tableRef.current.sync(view.state);
    const log = view.state.log;
    for (let i = lastLogLen.current; i < log.length; i++) {
      if (log[i].dice?.length) tableRef.current.rollDice(log[i].dice!);
    }
    lastLogLen.current = log.length;
  }, [view]);

  // Highlight the board for the current intent: an armed ability shows its valid
  // targets (amber); otherwise a selected own unit shows where it can move (red).
  useEffect(() => {
    if (!tableRef.current) return;
    const su = view?.state.units.find((u) => u.iid === selected);
    if (!myTurn || !su || su.owner !== myseat) {
      setTargetable([]); tableRef.current.highlightTiles([]); return;
    }
    if (pendingAbility) {
      getJSON<{ targets: { iid: string; pos: { x: number; y: number } }[] }>(
        `/api/game/${gameId}/targets?iid=${selected}&ability=${encodeURIComponent(pendingAbility.name)}`)
        .then((r) => {
          setTargetable(r.targets.map((t) => t.iid));
          tableRef.current?.highlightTiles(r.targets.map((t) => t.pos), "target");
        }).catch(() => {});
    } else {
      setTargetable([]);
      getJSON<{ tiles: { x: number; y: number }[] }>(`/api/game/${gameId}/moves?iid=${selected}`)
        .then((r) => tableRef.current?.highlightTiles(r.tiles, "move")).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, pendingAbility, view?.state.activeSide, view?.state.round]);

  // A 409 means the game moved under us (see src/games.ts act() /
  // docs/adr-005-concurrent-actions.md) — our view of the board is stale, so
  // the fix is to refetch the real state, not retry blindly against it.
  async function runAction(action: unknown) {
    try {
      await postJSON(`/api/game/${gameId}/action`, { action });
      setSelected(null); refetch();
    } catch (e) {
      setError(String(e));
      refetch();
    }
  }
  async function tryMove(x: number, y: number) {
    if (!myTurn || !selectedUnit || selectedUnit.owner !== myseat) return;
    await runAction({ kind: "move", iid: selectedUnit.iid, to: { x, y } });
  }
  async function useAbility(ability: Ability, targetIid?: string) {
    if (!myTurn || !selectedUnit) return;
    const target = targetIid
      ? view!.state.units.find((u) => u.iid === targetIid)?.pos
      : undefined;
    await runAction({ kind: "act", iid: selectedUnit.iid, ability: ability.name, target });
  }
  async function endTurn() {
    await runAction({ kind: "endTurn" });
  }
  async function leave() {
    // participants forfeit on leave so the opponent isn't stranded; spectators just go
    if (view && view.role !== "spectator" && view.state.phase !== "over") {
      try { await postJSON(`/api/game/${gameId}/leave`, {}); } catch { /* leave anyway */ }
    }
    location.assign("/play");
  }
  async function postChat(channel: "player" | "audience", body: string) {
    if (!body.trim()) return;
    try { await postJSON(`/api/game/${gameId}/chat`, { channel, body }); refetch(); }
    catch (e) { setError(String(e)); }
  }

  // Refresh the handlers the 3D table calls, so clicks always use current state.
  handlersRef.current.pickUnit = (iid) => {
    // If an ability is armed and this unit is a valid target, fire it.
    if (pendingAbility && targetable.includes(iid)) {
      useAbility(pendingAbility, iid); setPendingAbility(null); return;
    }
    setPendingAbility(null);
    setSelected((cur) => (cur === iid ? null : iid));
  };
  handlersRef.current.pickTile = (x, y) => { if (!pendingAbility) tryMove(x, y); };
  handlersRef.current.hoverUnit = (iid) => setHover(iid);

  if (!view) return <div className="pad">{error ?? "Loading the table…"}</div>;
  const s = view.state;

  return (
    <div className="game">
      <div className="board" ref={mountRef} />
      <aside className="hud">
        <div className="statusline" ref={statusRef}>
          <strong>Round {s.round}</strong> ·{" "}
          {s.phase === "over"
            ? (s.winner === null ? "Draw" : `Side ${s.winner + 1} wins`)
            : myTurn ? "Your turn" : `Side ${s.activeSide + 1}'s turn`}
          {" · "}<span>{view.role}</span> · 👁 {view.audience}
          <button className="leave" onClick={leave}>
            {view.role === "spectator" ? "Stop watching" : "Leave"}
          </button>
        </div>

        {s.phase === "over" && (
          <div className="gameover">
            <h2>{s.winner === null ? "Draw" : myseat === s.winner ? "Victory" : myseat === null ? `Side ${s.winner + 1} wins` : "Defeat"}</h2>
            <button className="endturn" onClick={leave}>Back to lobby</button>
          </div>
        )}

        <div className="hint">
          {s.phase === "over" ? "The battle is over."
            : view.role === "spectator" ? "You're watching. Drag to orbit the board; chat in Audience."
            : !myTurn ? "Waiting for your opponent. Drag to orbit the board."
            : pendingAbility ? `Click a glowing (amber) target for ${pendingAbility.name}.`
            : selectedUnit && selectedUnit.owner === myseat
              ? "Click a glowing (red) tile to move, or pick an ability. Click the unit again to deselect."
              : "Your turn — click one of your units to select it (drag to orbit), then move or act. Or End turn."}
        </div>

        {selectedUnit && (
          <div className="panel">
            <h3>{selectedUnit.name}</h3>
            <Stat u={selectedUnit} />
            {myTurn && selectedUnit.owner === myseat && (
              <div className="acts">
                {selectedUnit.acts.map((a) => {
                  const selfCast = a.tags.includes("self") || a.range === "self";
                  const armed = pendingAbility?.name === a.name;
                  return (
                    <button key={a.name} title={a.text} className={armed ? "on" : ""}
                      onClick={() => selfCast ? useAbility(a) : setPendingAbility(armed ? null : a)}>
                      {a.name}
                    </button>
                  );
                })}
              </div>
            )}
            {pendingAbility && (
              <p className="targeting">
                Targeting with <strong>{pendingAbility.name}</strong> — click a glowing
                target on the board, or <button className="link" onClick={() => setPendingAbility(null)}>cancel</button>.
              </p>
            )}
          </div>
        )}

        {hoverUnit && hoverUnit.iid !== selectedUnit?.iid && (
          <div className="panel ghost"><h3>{hoverUnit.name}</h3><Stat u={hoverUnit} /></div>
        )}

        {myTurn && <button className="endturn" onClick={endTurn}>End turn</button>}
        {error && <p className="err">{error}</p>}

        <div className="tabs">
          <button className={tab === "log" ? "on" : ""} onClick={() => setTab("log")}>Battle log</button>
          <button className={tab === "player" ? "on" : ""} onClick={() => setTab("player")}>Players</button>
          <button className={tab === "audience" ? "on" : ""} onClick={() => setTab("audience")}>Audience</button>
        </div>
        <div className="feed">
          {tab === "log" && [...s.log].slice(-60).reverse().map((l, i) => (
            <div key={i} className="logline"><span className="who">{l.actor}</span> {l.text}
              {l.dice?.length ? <span className="dice"> 🎲 {l.dice.join(" ")}</span> : null}</div>
          ))}
          {tab !== "log" && view.chat[tab].map((m) => (
            <div key={m.id} className="chatline"><strong>{m.displayName}:</strong> {m.body}</div>
          ))}
        </div>
        {tab !== "log" && !(tab === "player" && view.role === "spectator") && (
          <ChatBox
            placeholder={view.role === "spectator" ? "Cheer from the stands…" : "Say something…"}
            onSend={(b) => postChat(tab === "audience" || view.role === "spectator" ? "audience" : "player", b)} />
        )}
        {tab === "player" && view.role === "spectator" && (
          <p className="blurb">Player chat is read-only for spectators — use Audience.</p>
        )}
      </aside>
    </div>
  );
}

// Chat input with its own local draft state, isolated from the game's frequent
// re-renders (every WebSocket event refetches the view) so typing never drops.
function ChatBox({ placeholder, onSend }: { placeholder: string; onSend: (body: string) => void }) {
  const [draft, setDraft] = useState("");
  const submit = () => { const b = draft.trim(); if (b) { onSend(b); setDraft(""); } };
  return (
    <div className="compose">
      <input value={draft} placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }} />
      <button onClick={submit}>Send</button>
    </div>
  );
}

// a tiny stat block
function Stat({ u }: { u: Unit }) {
  const toks = Object.entries(u.tokens ?? {}).filter(([, n]) => n > 0);
  return (
    <div className="stat">
      <span>HP {u.hp}/{u.maxHp}</span> <span>MV {u.mv}</span>
      <span>DF {u.df}+</span> <span>ARM {u.arm ?? "–"}</span>
      <div className="type">{u.type}{u.upgrade ? ` · upgrade: ${u.upgrade}` : ""}</div>
      {toks.length > 0 && <div className="tokens">{toks.map(([t, n]) => `${t}×${n}`).join(" · ")}</div>}
    </div>
  );
}

