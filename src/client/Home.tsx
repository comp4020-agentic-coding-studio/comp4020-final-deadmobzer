import { useEffect, useState } from "react";
import { Link } from "wouter";
import { getJSON, houseStyle, portraitPath } from "./api.ts";

interface Profile {
  username: string; display_name: string; elo: number;
  avatarHouse: string | null; avatarUnit: string | null; colour: string | null;
}
interface FactionDef { id: string; name: string; accent: string; necromancer: { id: string } }
interface Factions { factions: FactionDef[] }

export function Home() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [factions, setFactions] = useState<Factions | null>(null);

  useEffect(() => {
    getJSON<Profile>("/api/profile").then(setProfile).catch(() => {});
    getJSON<Factions>("/api/factions").then(setFactions).catch(() => {});
  }, []);

  async function signOut() {
    await fetch("/logout", { method: "POST" });
    location.assign("/");   // a real navigation — the session is gone, so is the SPA's reason to exist
  }

  if (!profile) return <div className="pad">Loading…</div>;

  const house = profile.avatarHouse
    ? factions?.factions.find((f) => f.id === profile.avatarHouse)
    : undefined;

  return (
    <div className="pad" style={houseStyle(house?.accent)}>
      <h1>Welcome, {profile.display_name}</h1>
      <div className="dossier">
        {profile.avatarHouse && profile.avatarUnit ? (
          <img className="house-portrait house-glow"
            src={portraitPath(profile.avatarHouse, profile.avatarUnit, house?.necromancer.id)}
            alt={`${house?.name ?? profile.avatarHouse} portrait`} />
        ) : (
          <div className="house-portrait" style={{ display: "flex", alignItems: "center", justifyContent: "center", color: "#777", fontSize: ".85rem", textAlign: "center", padding: 12 }}>
            No avatar yet — <Link href="/profile">pick one</Link>
          </div>
        )}
        <div className="dossier-id">
          <p>Username: <code>{profile.username}</code></p>
          <p>Rating (ELO): <strong>{profile.elo}</strong></p>
          {house && <p>House: <strong style={{ color: house.accent }}>{house.name}</strong></p>}

          <div className="roster-row primary">
            <Link href="/play">Find a match</Link>
          </div>
          <div className="roster-row">
            <span className="label">Profile</span>
            <Link href="/profile">Edit</Link>
          </div>
          <div className="roster-row">
            <span className="label">Friends</span>
            <Link href="/friends">View</Link>
          </div>
        </div>
      </div>
      <p style={{ marginTop: 24 }}><button onClick={signOut}>Sign out</button></p>
    </div>
  );
}
