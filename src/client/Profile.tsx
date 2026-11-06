import { useEffect, useState } from "react";
import { getJSON, postJSON, houseStyle, portraitPath } from "./api.ts";

interface Profile {
  username: string; display_name: string; elo: number;
  avatarHouse: string | null; avatarUnit: string | null; colour: string | null;
}
interface UnitDef { id: string; name: string }
interface FactionDef { id: string; name: string; accent: string; necromancer: UnitDef; units: UnitDef[] }
interface Factions { palette: string[]; factions: FactionDef[] }

export function Profile() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [factions, setFactions] = useState<Factions | null>(null);
  const [avatar, setAvatar] = useState("");
  const [colour, setColour] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getJSON<Profile>("/api/profile").then((p) => {
      setProfile(p);
      if (p.avatarHouse && p.avatarUnit) setAvatar(`${p.avatarHouse}:${p.avatarUnit}`);
      if (p.colour) setColour(p.colour);
    }).catch(() => {});
    getJSON<Factions>("/api/factions").then((f) => { setFactions(f); if (!colour) setColour(f.palette[0]); }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() {
    setError(null);
    const [house, unit] = avatar.split(":");
    if (!house || !unit) { setError("Pick a portrait first."); return; }
    try {
      await postJSON("/api/profile/avatar", { house, unit, colour });
      const p = await getJSON<Profile>("/api/profile");
      setProfile(p);
    } catch (e) { setError(String(e)); }
  }

  if (!profile || !factions) return <div className="pad">Loading…</div>;

  const avatarOptions = factions.factions.flatMap((f) =>
    [f.necromancer, ...f.units].map((u) => ({ value: `${f.id}:${u.id}`, label: `${f.name} — ${u.name}` })));

  const [pickedHouseId] = avatar.split(":");
  const pickedHouse = factions.factions.find((f) => f.id === pickedHouseId);
  const currentHouse = profile.avatarHouse ? factions.factions.find((f) => f.id === profile.avatarHouse) : undefined;

  return (
    <div className="pad" style={houseStyle(pickedHouse?.accent ?? currentHouse?.accent)}>
      <h1>{profile.display_name}</h1>
      <div className="card house-accent-rule">
        <p>Username: <code>{profile.username}</code> · Rating (ELO): <strong>{profile.elo}</strong></p>
        {profile.avatarHouse && profile.avatarUnit ? (
          <img className="avatar house-glow"
            src={portraitPath(profile.avatarHouse, profile.avatarUnit, currentHouse?.necromancer.id)} alt="avatar" />
        ) : <p>No avatar set yet.</p>}
      </div>
      <div className="card">
        <h2>Choose your avatar</h2>
        <label>Portrait</label>
        <select value={avatar} onChange={(e) => setAvatar(e.target.value)}>
          <option value="">— pick one —</option>
          {avatarOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <label>Colour (also tints your pawns)</label>
        <div className="swatches avatar-swatches">
          {factions.palette.map((c) => (
            <label key={c} className="avatar-sw">
              <input type="radio" name="colour" checked={colour === c} onChange={() => setColour(c)} />
              <span style={{ background: c }} />
            </label>
          ))}
        </div>
        {error && <p className="err">{error}</p>}
        <p><button className="house-accent-rule" onClick={save}>Save</button></p>
      </div>
    </div>
  );
}
