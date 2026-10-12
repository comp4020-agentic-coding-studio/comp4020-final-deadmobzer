import { useEffect, useState } from "react";
import { getJSON, postJSON } from "./api.ts";

interface UnitDef { id: string; name: string; type: string }
interface FactionDef { id: string; name: string; blurb: string; playstyle: string; accent: string; units: UnitDef[] }
interface Factions { palette: string[]; factions: FactionDef[] }

type Mode = "fixed" | "faithful";

export function Lobby() {
  const [data, setData] = useState<Factions | null>(null);
  const [mode, setMode] = useState<Mode>("fixed");
  const [house, setHouse] = useState("carcass");
  const [colour, setColour] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [code, setCode] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);

  useEffect(() => { getJSON<Factions>("/api/factions").then((d) => { setData(d); setColour(d.palette[0]); }); }, []);

  const faction = data?.factions.find((f) => f.id === house);

  function loadoutBody() {
    const units = mode === "fixed"
      ? [] // server fills the fixed roster
      : (picked.length ? picked : (faction?.units.map((u) => u.id) ?? [])).map((defId) => ({ defId }));
    return { mode, house, colour, units };
  }

  async function go(kind: "quickjoin" | "create" | "join") {
    setError(null);
    try {
      if (kind === "quickjoin") {
        const r = await postJSON<{ gameId?: string; code?: string }>("/api/quickjoin", loadoutBody());
        if (r.gameId) location.assign(`/g/${r.gameId}`);
        else { setCreated(r.code!); pollLobby(r.code!); }
      } else if (kind === "create") {
        const r = await postJSON<{ code: string }>("/api/lobby/create", { ...loadoutBody(), visibility: "private" });
        setCreated(r.code); pollLobby(r.code);
      } else {
        const r = await postJSON<{ gameId: string }>("/api/lobby/join", { ...loadoutBody(), code });
        location.assign(`/g/${r.gameId}`);
      }
    } catch (e) { setError(String(e)); }
  }

  // When hosting, poll until someone joins and a game exists, then jump in.
  function pollLobby(c: string) {
    setWaiting(true);
    const timer = setInterval(async () => {
      try {
        const r = await getJSON<{ gameId: string | null }>(`/api/lobby/${c}`);
        if (r.gameId) { clearInterval(timer); location.assign(`/g/${r.gameId}`); }
      } catch { /* keep waiting */ }
    }, 1500);
  }

  if (!data) return <div className="pad">Loading…</div>;

  if (created) {
    return (
      <div className="pad lobby">
        <h1>Lobby ready</h1>
        <p>Share this code with your opponent:</p>
        <div className="code">{created}</div>
        <p>{waiting ? "Waiting for an opponent to join…" : ""}</p>
      </div>
    );
  }

  return (
    <div className="pad lobby">
      <h1>Find a match</h1>
      <div className="row">
        <label>Mode</label>
        <select value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
          <option value="fixed">Fixed roster</option>
          <option value="faithful">Faithful (Black Mass)</option>
        </select>
      </div>
      <div className="row">
        <label>House</label>
        <select value={house} onChange={(e) => { setHouse(e.target.value); setPicked([]); }}>
          {data.factions.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      </div>
      {faction && <p className="blurb">{faction.blurb} <em>({faction.playstyle})</em></p>}
      <div className="row">
        <label>Colour</label>
        <div className="swatches">
          {data.palette.map((c) => (
            <button key={c} className={"sw" + (c === colour ? " on" : "")}
              style={{ background: c }} onClick={() => setColour(c)} aria-label={c} />
          ))}
        </div>
      </div>
      {mode === "faithful" && faction && (
        <div className="row">
          <label>Units (slot budget 5)</label>
          <div className="units">
            {faction.units.map((u) => {
              const n = picked.filter((p) => p === u.id).length;
              return (
                <div key={u.id} className="unitpick">
                  <span>{u.name} <em>{u.type}</em> ×{n}</span>
                  <button onClick={() => setPicked([...picked, u.id])}>+</button>
                  <button onClick={() => { const i = picked.indexOf(u.id); if (i >= 0) setPicked(picked.filter((_, j) => j !== i)); }}>−</button>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <div className="actions">
        <button onClick={() => go("quickjoin")}>Quick-join (ranked)</button>
        <button onClick={() => go("create")}>Create lobby code</button>
        <span className="joinbox">
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="CODE" maxLength={5} />
          <button onClick={() => go("join")} disabled={code.length < 5}>Join</button>
        </span>
      </div>
      {error && <p className="err">{error}</p>}
    </div>
  );
}
