import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { getJSON, postJSON, houseStyle, portraitPath } from "./api.ts";

interface Upgrade { name: string; text: string }
interface UnitDef { id: string; name: string; type: string; upgrades?: Upgrade[] }
interface FactionDef { id: string; name: string; blurb: string; playstyle: string; accent: string; necromancer: UnitDef; units: UnitDef[] }
interface MaliceLevel { name: string; darkPower: number }
interface UnitTypeInfo { slotCost: number; limit: number | null }
interface Factions {
  palette: string[]; malice: MaliceLevel[]; factions: FactionDef[];
  unitTypes: Record<string, UnitTypeInfo>; unitSlots: number;
}

type Mode = "fixed" | "faithful";

export function Lobby() {
  const [, setLocation] = useLocation();
  const [data, setData] = useState<Factions | null>(null);
  const [mode, setMode] = useState<Mode>("fixed");
  const [house, setHouse] = useState("carcass");
  const [colour, setColour] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [malice, setMalice] = useState("Spite");
  const [upgrades, setUpgrades] = useState<Record<string, string>>({});
  const [code, setCode] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [live, setLive] = useState<{ id: string; mode: string; players: string[] }[]>([]);

  useEffect(() => { getJSON<Factions>("/api/factions").then((d) => { setData(d); setColour(d.palette[0]); }); }, []);
  useEffect(() => {
    const load = () => getJSON<{ games: typeof live }>("/api/games/active").then((r) => setLive(r.games)).catch(() => {});
    load(); const t = setInterval(load, 5000); return () => clearInterval(t);
  }, []);

  const faction = data?.factions.find((f) => f.id === house);

  function loadoutBody() {
    if (mode === "fixed") return { mode, house, colour, units: [] };
    const ids = picked.length ? picked : (faction?.units.map((u) => u.id) ?? []);
    // only keep upgrades for units actually in the roster
    const cleanUpgrades: Record<string, string> = {};
    for (const [defId, up] of Object.entries(upgrades)) if (ids.includes(defId) && up) cleanUpgrades[defId] = up;
    return { mode, house, colour, units: ids.map((defId) => ({ defId })), malice, upgrades: cleanUpgrades };
  }

  const darkPower = data?.malice.find((m) => m.name === malice)?.darkPower ?? 0;
  const spent = Object.values(upgrades).filter(Boolean).length;
  const unitSlots = data?.unitSlots ?? 5;
  const unitTypes = data?.unitTypes ?? {};

  // Same budget math as src/loadouts.ts's validateLoadout(), mirrored client-side
  // so the builder can't even offer an illegal pick — the server still re-checks.
  const slotsUsed = picked.reduce((sum, id) => {
    const type = faction?.units.find((u) => u.id === id)?.type;
    return sum + (type ? unitTypes[type]?.slotCost ?? 1 : 1);
  }, 0);
  function countOf(defId: string): number { return picked.filter((p) => p === defId).length; }
  function canAdd(u: UnitDef): boolean {
    const info = unitTypes[u.type];
    if (info?.limit != null && countOf(u.id) >= info.limit) return false;
    const cost = info?.slotCost ?? 1;
    return slotsUsed + cost <= unitSlots;
  }

  async function go(kind: "quickjoin" | "create" | "join") {
    setError(null);
    try {
      if (kind === "quickjoin") {
        const r = await postJSON<{ gameId?: string; code?: string }>("/api/quickjoin", loadoutBody());
        if (r.gameId) setLocation(`/g/${r.gameId}`);
        else { setCreated(r.code!); pollLobby(r.code!); }
      } else if (kind === "create") {
        const r = await postJSON<{ code: string }>("/api/lobby/create", { ...loadoutBody(), visibility: "private" });
        setCreated(r.code); pollLobby(r.code);
      } else {
        const r = await postJSON<{ gameId: string }>("/api/lobby/join", { ...loadoutBody(), code });
        setLocation(`/g/${r.gameId}`);
      }
    } catch (e) { setError(String(e)); }
  }

  // When hosting, poll until someone joins and a game exists, then jump in.
  function pollLobby(c: string) {
    setWaiting(true);
    const timer = setInterval(async () => {
      try {
        const r = await getJSON<{ gameId: string | null }>(`/api/lobby/${c}`);
        if (r.gameId) { clearInterval(timer); setLocation(`/g/${r.gameId}`); }
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
      <h1>Find a match <a href="/how-to-play/" target="_blank" rel="noreferrer" style={{ fontSize: "1rem" }}>(How to play)</a></h1>
      <div className="row">
        <label>Mode</label>
        <select value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
          <option value="fixed">Fixed roster</option>
          <option value="faithful">Faithful (Black Mass)</option>
        </select>
      </div>
      <div className="row">
        <label>House</label>
        <select className="house-accent-rule" style={houseStyle(faction?.accent)}
          value={house} onChange={(e) => { setHouse(e.target.value); setPicked([]); }}>
          {data.factions.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      </div>
      {faction && (
        <div className="house-panel house-glow" style={houseStyle(faction.accent)}>
          <img className="house-portrait" src={portraitPath(faction.id, faction.necromancer.id, faction.necromancer.id)}
            alt={`${faction.name} necromancer`} />
          <p className="blurb">
            <strong style={{ color: faction.accent }}>{faction.name}</strong> — {faction.blurb}{" "}
            <em>({faction.playstyle})</em>
          </p>
        </div>
      )}
      <div className="row">
        <label>Colour</label>
        <div className="swatches" style={houseStyle(faction?.accent)}>
          {data.palette.map((c) => (
            <button key={c} className={"sw" + (c === colour ? " on" : "")}
              style={{ background: c }} onClick={() => setColour(c)} aria-label={c} />
          ))}
        </div>
      </div>
      {mode === "faithful" && faction && (
        <>
          <div className="row">
            <label>Malice</label>
            <select value={malice} onChange={(e) => { setMalice(e.target.value); setUpgrades({}); }}>
              {data.malice.map((m) => <option key={m.name} value={m.name}>{m.name} ({m.darkPower} dark power)</option>)}
            </select>
            <span className="blurb">spent {spent}/{darkPower}</span>
          </div>
          <div className="row">
            <label>Units (slot budget {slotsUsed}/{unitSlots})</label>
            <div className="units">
              {faction.units.map((u) => {
                const n = countOf(u.id);
                const inRoster = n > 0;
                const limit = unitTypes[u.type]?.limit;
                const atLimit = limit != null && n >= limit;
                const upgradeBudgetFull = spent >= darkPower && !upgrades[u.id];
                return (
                  <div key={u.id} className="unitpick">
                    <span>{u.name} <em>{u.type}</em> ×{n}{limit != null ? ` (max ${limit})` : ""}</span>
                    <button disabled={!canAdd(u)} onClick={() => setPicked([...picked, u.id])}>+</button>
                    <button disabled={n === 0} onClick={() => { const i = picked.indexOf(u.id); if (i >= 0) setPicked(picked.filter((_, j) => j !== i)); }}>−</button>
                    {inRoster && darkPower > 0 && u.upgrades && (
                      <select value={upgrades[u.id] ?? ""} title={u.upgrades.find((x) => x.name === upgrades[u.id])?.text}
                        onChange={(e) => setUpgrades({ ...upgrades, [u.id]: e.target.value })}>
                        <option value="">no upgrade</option>
                        {u.upgrades.map((up) => (
                          <option key={up.name} value={up.name} disabled={upgradeBudgetFull && upgrades[u.id] !== up.name}>
                            {up.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </>
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

      <h2 style={{ marginTop: 28 }}>Watch a live game</h2>
      {live.length === 0 && <p className="blurb">No games in progress right now.</p>}
      <div className="units">
        {live.map((g) => (
          <div key={g.id} className="unitpick">
            <span>{g.players.join(" vs ")} <em>{g.mode}</em></span>
            <button onClick={() => setLocation(`/g/${g.id}`)}>Watch</button>
          </div>
        ))}
      </div>
    </div>
  );
}
