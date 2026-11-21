import { useEffect, useState } from 'react';

import { History, KeyRound, Link2, MonitorSmartphone, ShieldCheck, Unlink, UserRound, UserX } from 'lucide-react';
import { ACCOUNT_STATUS, api, LoginEvent, MyAccount, passwordProblem, ROLE_LABEL } from '../api';
import { when } from '../grid';
import { GithubMark } from './Login';
import { Section } from './Section';

// GitHub 연결 뒤 돌아온 #account?github=<code>
const LINK_MSG: Record<string, [string, 'ok' | 'err']> = {
  linked: ['GitHub 계정을 연결했습니다. 이제 GitHub 으로도 로그인할 수 있습니다.', 'ok'],
  github_taken: ['그 GitHub 계정은 다른 콘솔 계정에 연결돼 있습니다.', 'err'],
  failed: ['GitHub 연결에 실패했습니다. 잠시 후 다시 시도하세요.', 'err'],
};
const VIA = { password: '비밀번호', github: 'GitHub' } as const;
const JOINED = { signup: '회원가입', github: 'GitHub 로그인', admin: '관리자가 만듦' } as const;

/** 마이페이지 — 내 정보·로그인 방법·로그인 기록·다른 기기 로그아웃·탈퇴 */
export function MyPage({ onChanged }: { onChanged?: () => void }) {
  const [a, setA] = useState<MyAccount | null>(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState<[string, 'ok' | 'err'] | null>(() => {
    const code = new URLSearchParams(location.hash.split('?')[1] || '').get('github');
    return code ? LINK_MSG[code] ?? LINK_MSG.failed : null;
  });
  const load = () => api.account().then(setA).catch((e) => setErr(String(e?.message || e)));
  useEffect(() => { void load(); if (location.hash.includes('?')) history.replaceState(null, '', '#account'); }, []);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg(null);
    try { await fn(); setMsg([ok, 'ok']); await load(); onChanged?.(); return true; }
    catch (e: any) { setMsg([String(e?.message || e), 'err']); return false; }
  };

  if (err) return <div className="panel err">{err}</div>;
  if (!a) return <div className="muted">불러오는 중…</div>;
  const avatar = a.github ? `https://github.com/${encodeURIComponent(a.github)}.png?size=120` : null;

  return (
    <div className="mypage">
      <div className="topbar">
        <div>
          <h1><UserRound size={22} />마이페이지</h1>
          <div className="sub">내 정보와 로그인 방법, 최근 로그인 기록</div>
        </div>
      </div>
      {msg && <div className={'panel ' + (msg[1] === 'ok' ? 'ok-note' : 'err')} style={{ marginBottom: 12 }} role="status">{msg[0]}</div>}

      <div className="mypage-grid">
        <Section icon={UserRound} title="프로필">
          <div className="mypage-who">
            <Avatar src={avatar} name={a.name} />
            <div>
              <div className="mypage-name">{a.name} <span className="muted mono">@{a.login}</span></div>
              <div className="mypage-tags">
                <span className={'chip ' + ACCOUNT_STATUS[a.status][1]}>{ACCOUNT_STATUS[a.status][0]}</span>
                <span className="chip">{ROLE_LABEL[a.role]}{a.root ? ' (처음 관리자)' : ''}</span>
              </div>
            </div>
          </div>
          <dl className="mypage-kv">
            <dt>가입</dt><dd>{when(a.createdAt)} · {JOINED[a.via]}</dd>
            <dt>마지막 로그인</dt><dd>{a.lastLoginAt ? when(a.lastLoginAt) : '—'}</dd>
          </dl>
          <ProfileForm a={a} onSave={(b) => run(() => api.updateAccount(b), '프로필을 저장했습니다')} />
        </Section>

        <Section icon={KeyRound} title="로그인 방법">
          <div className="mypage-method">
            <div><b>비밀번호</b><div className="muted">{a.hasPassword ? '아이디·비밀번호로 로그인할 수 있습니다' : '아직 없습니다. 정하면 아이디·비밀번호로도 로그인합니다'}</div></div>
          </div>
          <PasswordForm login={a.login} has={a.hasPassword}
            onSave={(b) => run(() => api.changePassword(b), a.hasPassword ? '비밀번호를 바꿨습니다. 다른 기기는 로그아웃됐습니다' : '비밀번호를 정했습니다')} />
          <div className="mypage-method" style={{ marginTop: 14 }}>
            <div><b><GithubMark size={14} /> GitHub</b>
              <div className="muted">{a.github ? <>연결됨 — <a href={`https://github.com/${a.github}`} target="_blank" rel="noreferrer">@{a.github}</a></> : '연결 안 됨'}</div></div>
            {a.github
              ? <button className="btn ghost sm" disabled={!a.hasPassword || a.root} title={a.root ? '처음 관리자는 끊을 수 없습니다' : !a.hasPassword ? '비밀번호를 먼저 정하세요' : ''}
                  onClick={() => confirm('GitHub 연결을 끊을까요? 이후엔 비밀번호로만 로그인합니다.') && run(() => api.unlinkGithub(), 'GitHub 연결을 끊었습니다')}><Unlink size={14} />연결 끊기</button>
              : <a className="btn sm" href="/dashapi/login?mode=link"><Link2 size={14} />연결하기</a>}
          </div>
        </Section>

        <Section icon={ShieldCheck} title="보안">
          <div className="mypage-method">
            <div><b>다른 기기 로그아웃</b><div className="muted">이 브라우저만 남기고, 다른 곳에 남은 로그인을 모두 끊습니다.</div></div>
            <button className="btn ghost sm" onClick={() => run(() => api.logoutOthers(), '다른 기기에서 모두 로그아웃했습니다')}><MonitorSmartphone size={14} />로그아웃</button>
          </div>
        </Section>

        <Section icon={History} title={`최근 로그인 ${a.history.length}건`} flush>
          {a.history.length ? <table className="mypage-table"><thead><tr><th>때</th><th>방법</th><th>IP</th><th>결과</th></tr></thead>
            <tbody>{a.history.map((h: LoginEvent, i) => (
              <tr key={i}><td>{when(h.at)}</td><td>{VIA[h.via]}</td><td className="mono">{h.ip}</td>
                <td>{h.ok ? <span className="chip green">성공</span> : <span className="chip red" title={h.reason}>실패{h.reason ? `, ${h.reason}` : ''}</span>}</td></tr>
            ))}</tbody></table>
            : <div className="muted" style={{ padding: 14 }}>기록이 없습니다</div>}
        </Section>

        <Section icon={UserX} title="탈퇴" tone="bad">
          <Withdraw a={a} />
        </Section>
      </div>
    </div>
  );
}

/** 프로필 사진 — GitHub 사진을 못 불러오면 이름 첫 글자 */
function Avatar({ src, name }: { src: string | null; name: string }) {
  const [bad, setBad] = useState(false);
  if (!src || bad) return <span className="mypage-initial">{[...name][0] ?? '?'}</span>;
  return <img src={src} alt="" width={56} height={56} onError={() => setBad(true)} />;
}

function ProfileForm({ a, onSave }: { a: MyAccount; onSave: (b: { name: string; email: string }) => Promise<boolean> }) {
  const [name, setName] = useState(a.name);
  const [email, setEmail] = useState(a.email);
  const changed = name.trim() !== a.name || email.trim() !== a.email;
  return (
    <form className="mypage-form" onSubmit={(e) => { e.preventDefault(); void onSave({ name: name.trim(), email: email.trim() }); }}>
      <label className="fld"><span>이름</span><input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} /></label>
      <label className="fld"><span>이메일</span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="선택" /></label>
      <button className="btn primary sm" disabled={!changed || !name.trim()}>저장</button>
    </form>
  );
}

function PasswordForm({ login, has, onSave }: { login: string; has: boolean; onSave: (b: { current?: string; next: string }) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const bad = next ? passwordProblem(next, login) : null;
  const diff = again && again !== next ? '새 비밀번호가 서로 다릅니다' : null;
  if (!open) return <button className="btn ghost sm" onClick={() => setOpen(true)}><KeyRound size={14} />{has ? '비밀번호 바꾸기' : '비밀번호 정하기'}</button>;
  return (
    <form className="mypage-form" onSubmit={async (e) => {
      e.preventDefault();
      if (bad || diff || !next || !again) return;
      if (await onSave({ ...(has ? { current: cur } : {}), next })) { setOpen(false); setCur(''); setNext(''); setAgain(''); }
    }}>
      {has && <label className="fld"><span>지금 비밀번호</span><input type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} /></label>}
      <label className="fld"><span>새 비밀번호</span><input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />{bad && <small className="err">{bad}</small>}</label>
      <label className="fld"><span>새 비밀번호 확인</span><input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />{diff && <small className="err">{diff}</small>}</label>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn primary sm" disabled={!!bad || !!diff || !next || !again || (has && !cur)}>저장</button>
        <button type="button" className="btn ghost sm" onClick={() => setOpen(false)}>취소</button>
      </div>
    </form>
  );
}

function Withdraw({ a }: { a: MyAccount }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState('');
  const [err, setErr] = useState('');
  if (a.root) return <div className="muted">처음 관리자(서버 설정 CONSOLE_ADMINS)는 탈퇴할 수 없습니다.</div>;
  if (!open) return (
    <div className="mypage-method">
      <div className="muted">계정과 권한이 지워지고 다시 되돌릴 수 없습니다. 다시 쓰려면 새로 가입해야 합니다.</div>
      <button className="btn ghost sm" style={{ color: 'var(--red)' }} onClick={() => setOpen(true)}>탈퇴하기</button>
    </div>
  );
  return (
    <form className="mypage-form" onSubmit={async (e) => {
      e.preventDefault(); setErr('');
      try { await api.withdraw(a.hasPassword ? { password: v } : { confirm: v }); location.replace('/?login=withdrawn'); }
      catch (e: any) { setErr(String(e?.message || e)); }
    }}>
      <label className="fld"><span>{a.hasPassword ? '비밀번호를 넣어 확인' : `아이디 "${a.login}" 를 그대로 입력`}</span>
        <input type={a.hasPassword ? 'password' : 'text'} value={v} onChange={(e) => setV(e.target.value)} autoFocus /></label>
      {err && <div className="err">{err}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn sm" style={{ background: 'var(--red)', borderColor: 'var(--red)', color: '#fff' }} disabled={!v}>탈퇴</button>
        <button type="button" className="btn ghost sm" onClick={() => { setOpen(false); setV(''); }}>취소</button>
      </div>
    </form>
  );
}
