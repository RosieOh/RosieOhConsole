import { createContext, useContext, useEffect, useState } from 'react';
import { api } from './api';

// 사람 표시 — GitHub 프로필 사진(원형) + 아이디. 아이디만 글자로 늘어놓지 않는다
type U = { login: string; fullName: string; avatar: string };
const Ctx = createContext<Record<string, U>>({});

export function UsersProvider({ children }: { children: React.ReactNode }) {
  const [m, setM] = useState<Record<string, U>>({});
  useEffect(() => { api.users().then((r) => setM(Object.fromEntries(r.users.map((u) => [u.login, u])))).catch(() => {}); }, []);
  return <Ctx.Provider value={m}>{children}</Ctx.Provider>;
}

const COLORS = ['#3a7ca5', '#2e8b83', '#5566a8', '#8a6ba8', '#b06a82', '#3f8f63', '#b5853f', '#60809b'];
const color = (s: string) => COLORS[[...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 3) % COLORS.length];

export function Avatar({ login, size = 22 }: { login: string; size?: number }) {
  const u = useContext(Ctx)[String(login || '').toLowerCase()];
  const [bad, setBad] = useState(false);
  if (u?.avatar && !bad) return <img className="avatar" src={u.avatar} alt="" width={size} height={size} onError={() => setBad(true)} />;
  return <span className="avatar" style={{ width: size, height: size, background: color(login || '?'), fontSize: Math.round(size * 0.48) }}>{(login || '?').slice(0, 1).toUpperCase()}</span>;
}

/** 아바타 + 아이디(이름은 말풍선) */
export function User({ login, size = 20, name = false }: { login?: string | null; size?: number; name?: boolean }) {
  const u = useContext(Ctx)[String(login || '').toLowerCase()];
  if (!login) return <span className="muted"></span>;
  return (
    <span className="user" title={u?.fullName ? `${u.fullName} (${login})` : login}>
      <Avatar login={login} size={size} />
      <span>{login}{name && u?.fullName ? <span className="muted">, {u.fullName}</span> : null}</span>
    </span>
  );
}

/** 여러 사람 — 아바타를 겹쳐서 */
export function Users({ logins, max = 5, size = 22 }: { logins: string[]; max?: number; size?: number }) {
  if (!logins.length) return <span className="muted"></span>;
  return (
    <span className="users" title={logins.join(', ')}>
      {logins.slice(0, max).map((l) => <Avatar key={l} login={l} size={size} />)}
      {logins.length > max && <span className="users-more">+{logins.length - max}</span>}
      {logins.length <= 2 && <span style={{ marginLeft: 6 }}>{logins.join(', ')}</span>}
    </span>
  );
}
