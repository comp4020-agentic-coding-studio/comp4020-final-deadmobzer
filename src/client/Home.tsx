import { useEffect, useState } from "react";
import { Link } from "wouter";
import { getJSON } from "./api.ts";

interface Profile {
  username: string; display_name: string; elo: number;
  avatarHouse: string | null; avatarUnit: string | null; colour: string | null;
}

export function Home() {
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => { getJSON<Profile>("/api/profile").then(setProfile).catch(() => {}); }, []);

  async function signOut() {
    await fetch("/logout", { method: "POST" });
    location.assign("/");   // a real navigation — the session is gone, so is the SPA's reason to exist
  }

  if (!profile) return <div className="pad">Loading…</div>;

  return (
    <div className="pad">
      <h1>Welcome, {profile.display_name}</h1>
      <div className="card">
        {profile.avatarHouse && profile.avatarUnit && (
          <img className="avatar" src={`/art/portraits/${profile.avatarHouse}/${profile.avatarUnit}.png`} alt="avatar"
            style={profile.colour ? { boxShadow: `0 0 0 4px ${profile.colour}` } : undefined} />
        )}
        <p>Rating (ELO): <strong>{profile.elo}</strong></p>
      </div>
      <div className="homelinks">
        <Link href="/play" className="card linkcard">Find a match</Link>
        <Link href="/profile" className="card linkcard">Profile</Link>
        <Link href="/friends" className="card linkcard">Friends</Link>
      </div>
      <button onClick={signOut}>Sign out</button>
    </div>
  );
}
