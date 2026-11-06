import { useCallback, useEffect, useState } from "react";
import { getJSON, postJSON, openUserSocket, houseStyle, portraitPath } from "./api.ts";

interface AvatarFields { avatar_house: string | null; avatar_unit: string | null; colour: string | null }
interface Friend extends AvatarFields { id: number; username: string; display_name: string; online?: boolean }
interface PendingRequest extends AvatarFields { friendship_id: number; id: number; username: string; display_name: string }
interface Opponent extends AvatarFields { id: number; username: string; display_name: string }
interface FriendsData { friends: Friend[]; incoming: PendingRequest[]; recent: Opponent[] }
interface FactionDef { id: string; accent: string; necromancer: { id: string } }
interface Factions { factions: FactionDef[] }

// A small avatar thumbnail + the owner's House-accent colour on their name —
// the one piece of per-person identity the other pages already show (Home,
// Profile) that this list was still rendering as plain text.
function PersonTag({ person, factions }: { person: AvatarFields & { display_name: string }; factions: FactionDef[] }) {
  const house = person.avatar_house ? factions.find((f) => f.id === person.avatar_house) : undefined;
  return (
    <span className="person-tag" style={houseStyle(house?.accent)}>
      {person.avatar_house && person.avatar_unit ? (
        <img className="person-avatar house-accent-rule"
          src={portraitPath(person.avatar_house, person.avatar_unit, house?.necromancer.id)} alt="" />
      ) : (
        <span className="person-avatar person-avatar-blank" />
      )}
      <span style={house ? { color: house.accent } : undefined}>{person.display_name}</span>
    </span>
  );
}

export function Friends() {
  const [data, setData] = useState<FriendsData | null>(null);
  const [factions, setFactions] = useState<FactionDef[]>([]);
  const [username, setUsername] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const refetch = useCallback(() => {
    getJSON<FriendsData>("/api/friends").then(setData).catch(() => {});
  }, []);

  useEffect(() => { refetch(); }, [refetch]);
  useEffect(() => { getJSON<Factions>("/api/factions").then((f) => setFactions(f.factions)).catch(() => {}); }, []);

  // Live updates: a friend request/acceptance from the other side, or a
  // presence change, should refresh this page without a manual reload — the
  // per-user socket (src/realtime.ts, no ?game= param) already pushes these
  // events; GET /api/friends didn't have a client consumer before the SPA.
  useEffect(() => {
    const ws = openUserSocket((ev) => {
      if (ev.type === "friend_request" || ev.type === "friend_accepted" || ev.type === "presence") refetch();
    });
    return () => ws.close();
  }, [refetch]);

  async function sendRequest() {
    if (!username.trim()) return;
    setMsg(null);
    try { await postJSON("/api/friends/request", { username }); setUsername(""); setMsg("Request sent."); refetch(); }
    catch (e) { setMsg(String(e)); }
  }
  async function accept(friendshipId: number) {
    try { await postJSON("/api/friends/accept", { friendship_id: friendshipId }); refetch(); } catch { /* ignore */ }
  }
  async function decline(friendshipId: number) {
    try { await postJSON("/api/friends/decline", { friendship_id: friendshipId }); refetch(); } catch { /* ignore */ }
  }
  async function addFriend(uname: string) {
    try { await postJSON("/api/friends/request", { username: uname }); refetch(); } catch { /* ignore */ }
  }

  if (!data) return <div className="pad">Loading…</div>;

  return (
    <div className="pad">
      <h1>Friends</h1>
      {msg && <p className="err">{msg}</p>}
      <div className="card">
        <h2>Add a friend</h2>
        <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="their username"
          onKeyDown={(e) => { if (e.key === "Enter") sendRequest(); }} />
        <button onClick={sendRequest}>Send request</button>
      </div>
      <div className="card">
        <h2>Your friends</h2>
        {data.friends.length === 0 ? <p>None yet.</p> : (
          <ul className="person-list">{data.friends.map((f) => (
            <li key={f.id}>
              <PersonTag person={f} factions={factions} />
              {f.online && <em>· online</em>}
            </li>
          ))}</ul>
        )}
      </div>
      <div className="card">
        <h2>Incoming requests</h2>
        {data.incoming.length === 0 ? <p>None.</p> : (
          <ul className="person-list">{data.incoming.map((r) => (
            <li key={r.friendship_id}>
              <PersonTag person={r} factions={factions} />
              <button onClick={() => accept(r.friendship_id)}>Accept</button>
              <button onClick={() => decline(r.friendship_id)}>Decline</button>
            </li>
          ))}</ul>
        )}
      </div>
      <div className="card">
        <h2>Recent opponents</h2>
        {data.recent.length === 0 ? <p>No games yet.</p> : (
          <ul className="person-list">{data.recent.map((o) => (
            <li key={o.id}>
              <PersonTag person={o} factions={factions} /> <code>{o.username}</code>
              <button onClick={() => addFriend(o.username)}>Add friend</button>
            </li>
          ))}</ul>
        )}
      </div>
    </div>
  );
}
