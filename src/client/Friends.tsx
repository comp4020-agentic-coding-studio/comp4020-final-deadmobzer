import { useCallback, useEffect, useState } from "react";
import { getJSON, postJSON, openUserSocket } from "./api.ts";

interface Friend { id: number; username: string; display_name: string; online?: boolean }
interface PendingRequest { friendship_id: number; id: number; username: string; display_name: string }
interface Opponent { id: number; username: string; display_name: string }
interface FriendsData { friends: Friend[]; incoming: PendingRequest[]; recent: Opponent[] }

export function Friends() {
  const [data, setData] = useState<FriendsData | null>(null);
  const [username, setUsername] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const refetch = useCallback(() => {
    getJSON<FriendsData>("/api/friends").then(setData).catch(() => {});
  }, []);

  useEffect(() => { refetch(); }, [refetch]);

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
          <ul>{data.friends.map((f) => (
            <li key={f.id}>{f.display_name} {f.online && <em>· online</em>}</li>
          ))}</ul>
        )}
      </div>
      <div className="card">
        <h2>Incoming requests</h2>
        {data.incoming.length === 0 ? <p>None.</p> : (
          <ul>{data.incoming.map((r) => (
            <li key={r.friendship_id}>
              {r.display_name}
              <button onClick={() => accept(r.friendship_id)}>Accept</button>
              <button onClick={() => decline(r.friendship_id)}>Decline</button>
            </li>
          ))}</ul>
        )}
      </div>
      <div className="card">
        <h2>Recent opponents</h2>
        {data.recent.length === 0 ? <p>No games yet.</p> : (
          <ul>{data.recent.map((o) => (
            <li key={o.id}>{o.display_name} <code>{o.username}</code>
              <button onClick={() => addFriend(o.username)}>Add friend</button>
            </li>
          ))}</ul>
        )}
      </div>
    </div>
  );
}
