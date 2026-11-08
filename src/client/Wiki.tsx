// A reference page for every House's full build info — necromancer stats,
// traits, acts, SOUL abilities, and every unit's complete upgrade text — for
// planning a custom Black Mass (faithful mode) loadout outside the lobby's
// cramped in-progress builder. Read-only: fetches /api/factions once, same
// endpoint Lobby.tsx already uses, no new backend data.
import { useEffect, useState } from "react";
import { getJSON, houseStyle, portraitPath } from "./api.ts";

interface Ability { name: string; tags: string[]; range?: [number, number] | "melee" | "self"; text: string; soul?: number }
interface Trait { name: string; text: string }
interface Upgrade { name: string; text: string }
interface UnitDef {
  id: string; name: string; type: string;
  mv: number; hp: number; df: number; arm: string | null;
  traits: Trait[]; acts: Ability[]; souls?: Ability[]; upgrades?: Upgrade[];
}
interface FactionDef {
  id: string; name: string; blurb: string; playstyle: string; accent: string;
  necromancer: UnitDef; units: UnitDef[];
}
interface Factions { factions: FactionDef[] }

export function Wiki() {
  const [data, setData] = useState<Factions | null>(null);
  const [house, setHouse] = useState("carcass");

  useEffect(() => { getJSON<Factions>("/api/factions").then(setData); }, []);

  if (!data) return <div className="pad">Loading…</div>;
  const faction = data.factions.find((f) => f.id === house) ?? data.factions[0];

  return (
    <div className="pad wiki">
      <h1>House wiki</h1>
      <p className="blurb">
        Full build reference for every House — necromancer SOUL abilities and
        every unit's upgrades, for planning a custom Black Mass loadout.
      </p>
      <div className="tabs wiki-houses">
        {data.factions.map((f) => (
          <button key={f.id} className={f.id === faction.id ? "on" : ""}
            style={houseStyle(f.accent)}
            onClick={() => setHouse(f.id)}>
            {f.name}
          </button>
        ))}
      </div>

      <div className="house-panel house-glow" style={houseStyle(faction.accent)}>
        <img className="house-portrait" src={portraitPath(faction.id, faction.necromancer.id, faction.necromancer.id)}
          alt={`${faction.name} necromancer`} />
        <p className="blurb">
          <strong style={{ color: faction.accent }}>{faction.name}</strong> — {faction.blurb}{" "}
          <em>({faction.playstyle})</em>
        </p>
      </div>

      <UnitCard u={faction.necromancer} accent={faction.accent} house={faction.id} necromancerId={faction.necromancer.id} />

      <h2 style={{ marginTop: 28 }}>Roster</h2>
      <div className="wiki-grid">
        {faction.units.map((u) => (
          <UnitCard key={u.id} u={u} accent={faction.accent} house={faction.id} necromancerId={faction.necromancer.id} />
        ))}
      </div>
    </div>
  );
}

function UnitCard({ u, accent, house, necromancerId }: { u: UnitDef; accent: string; house: string; necromancerId: string }) {
  return (
    <div className="card house-accent-rule" style={houseStyle(accent)}>
      <div className="wiki-card-head">
        <img className="person-avatar" style={{ width: 56, height: 56 }}
          src={portraitPath(house, u.id, necromancerId)} alt={u.name} />
        <div>
          <h3 style={{ margin: 0, color: accent }}>{u.name}</h3>
          <div className="type">{u.type}</div>
        </div>
      </div>
      <div className="stat">
        <span>MV {u.mv}</span> <span>HP {u.hp}</span>
        <span>DF {u.df}+</span> <span>ARM {u.arm ?? "–"}</span>
      </div>

      {u.traits.length > 0 && (
        <>
          <h4>Traits</h4>
          <ul className="wiki-list">
            {u.traits.map((t) => <li key={t.name}><strong>{t.name}</strong> — {t.text}</li>)}
          </ul>
        </>
      )}

      <h4>Acts</h4>
      <ul className="wiki-list">
        {u.acts.map((a) => <li key={a.name}><strong>{a.name}</strong> — {a.text}</li>)}
      </ul>

      {u.souls && u.souls.length > 0 && (
        <>
          <h4>SOUL</h4>
          <ul className="wiki-list">
            {u.souls.map((a) => <li key={a.name}><strong>{a.name}</strong> ({a.soul}) — {a.text}</li>)}
          </ul>
        </>
      )}

      {u.upgrades && u.upgrades.length > 0 && (
        <>
          <h4>Upgrades</h4>
          <ul className="wiki-list">
            {u.upgrades.map((up) => <li key={up.name}><strong>{up.name}</strong> — {up.text}</li>)}
          </ul>
        </>
      )}
    </div>
  );
}
