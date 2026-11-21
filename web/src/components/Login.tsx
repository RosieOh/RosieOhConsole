import { Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import LiquidGlass from 'liquid-glass-react';
import { api, passwordProblem } from '../api';
import { applyTheme, currentTheme } from '../theme';
import { LiquidBg } from './LiquidBg';
import { Scene3D } from './Scene3D';

// GitHub 로그인이 돌려보낸 ?login=<code> — 서버(auth.controller)의 갈래와 같은 이름
const REASON: Record<string, [string, 'err' | 'ok']> = {
  pending: ['가입 신청을 받았습니다. 관리자가 승인하면 로그인할 수 있습니다.', 'ok'],
  rejected: ['가입이 거절된 계정입니다.', 'err'],
  suspended: ['정지된 계정입니다. 관리자에게 문의하세요.', 'err'],
  forbidden: ['로그인 권한이 없는 계정입니다. 관리자에게 문의하세요.', 'err'],
  conflict: ['같은 아이디의 콘솔 계정이 이미 있습니다. 그 계정으로 로그인한 뒤 마이페이지에서 GitHub 을 연결하세요.', 'err'],
  expired: ['로그인 시간이 지났습니다. 다시 눌러 주세요.', 'err'],
  failed: ['GitHub 로그인 확인에 실패했습니다. 잠시 후 다시 시도하세요.', 'err'],
  withdrawn: ['탈퇴했습니다. 이용해 주셔서 고맙습니다.', 'ok'],
};

/** GitHub 마크(lucide 에 브랜드 아이콘이 없다) */
export function GithubMark({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

/** 첫 화면 왼쪽 소개 — 넓은 화면에서만 보인다(좁으면 3D 고리가 그 자리를 채운다) */
function Hero() {
  return (
    <section className="auth-hero" aria-label="소개">
      <span className="auth-kicker">RosieOh · Console</span>
      <h1>저장소부터 배포까지,<br />한 화면에서.</h1>
      <p>GitHub 저장소 90개와 조직 프로젝트의 배포 흐름, 러너, 서버, 시크릿을 Rosie 콘솔 하나로 봅니다.</p>
      <ul>
        <li>서비스 카탈로그와 배포 현황</li>
        <li>GitHub Actions 배포 흐름 도식</li>
        <li>회원·권한과 감사 기록</li>
      </ul>
    </section>
  );
}

/** 로그인·회원가입 공통 틀 — 3D 배경(안 되면 오로라) + 유리 카드 + 테마 버튼. hero 면 왼쪽 소개를 두고 카드는 오른쪽으로 */
export function AuthFrame({ children, width = 520, hero = false }: { children: React.ReactNode; width?: number; hero?: boolean }) {
  const [dark, setDark] = useState(() => currentTheme() === 'dark');
  const [flat, setFlat] = useState(false);   // WebGL 이 안 되면 기존 오로라
  const flip = () => { const next = dark ? 'light' : 'dark'; applyTheme(next); setDark(!dark); };
  return (
    <div className={'login-wrap auth-3d' + (hero ? ' has-hero' : '')}>
      {flat ? <LiquidBg /> : <Scene3D focusX={hero ? 0.485 : 0.17} onFail={() => setFlat(true)} />}
      {hero && <Hero />}
      <button className="login-theme" onClick={flip} aria-label="테마 바꾸기" title={dark ? '밝게' : '어둡게'}>
        {dark ? <Sun size={17} /> : <Moon size={17} />}
      </button>
      {/* 이 컴포넌트는 transform: translate(-50%,-50%) 를 항상 걸기 때문에
          position 과 top/left 를 반드시 넘겨야 한다(안 넘기면 내부 레이어가 나란히 흐른다).
          형제로 뿌리는 림/음영 레이어는 styles.css 에서 끄고 테두리를 직접 그린다. */}
      <LiquidGlass className="login-glass" cornerRadius={28} padding="40px 44px 34px" displacementScale={68} blurAmount={0.06}
        saturation={135} aberrationIntensity={2} elasticity={0.14} style={{ position: 'absolute', top: '50%', left: 'var(--auth-card-x, 50%)', width: `min(${width}px, calc(100vw - 32px))` }}>
        <div className="login-box">{children}</div>
      </LiquidGlass>
    </div>
  );
}

export function Login() {
  const reason = REASON[new URLSearchParams(location.search).get('login') || ''];
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!login.trim() || !password) { setErr('아이디와 비밀번호를 넣으세요'); return; }
    setBusy(true); setErr('');
    try { await api.passwordLogin(login.trim(), password); location.replace('/'); }
    catch (e: any) { setErr(String(e?.message || e)); setBusy(false); }
  }

  return (
    <AuthFrame hero width={460}>
      <span className="login-brand brand-logo" aria-label="RosieOh" />
      <h2>Rosie 콘솔</h2>
      <p>콘솔 계정이나 GitHub 계정으로 로그인합니다.</p>
      {reason && <div className={reason[1] === 'ok' ? 'auth-note' : 'err'} style={{ marginBottom: 12 }}>{reason[0]}</div>}
      <form className="auth-form" onSubmit={submit}>
        <label className="fld"><span>아이디</span>
          <input autoComplete="username" value={login} onChange={(e) => setLogin(e.target.value)} autoFocus /></label>
        <label className="fld"><span>비밀번호</span>
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        {err && <div className="err" role="alert">{err}</div>}
        <button className="login-cta" type="submit" disabled={busy}>{busy ? '확인 중…' : '로그인'}</button>
      </form>
      <div className="auth-or"><span>또는</span></div>
      <a className="login-cta auth-gh" href="/dashapi/login"><GithubMark />GitHub 으로 로그인</a>
      <div className="auth-links">
        <a href="#signup">회원가입</a>
        <a className="login-alt" href="/apk">APK 만 받기 <span>로그인 없이</span></a>
      </div>
      <div className="auth-hint">비밀번호를 잊었으면 관리자에게 임시 비밀번호를 요청하세요.</div>
    </AuthFrame>
  );
}

export function Signup() {
  const [f, setF] = useState({ login: '', name: '', email: '', password: '', confirm: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  const loginBad = f.login && !/^[a-z][a-z0-9_-]{2,19}$/.test(f.login) ? '영문 소문자로 시작하는 3~20자(영문 소문자, 숫자, -, _)' : null;
  const emailBad = f.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email) ? '이메일 형식이 아닙니다' : null;
  const pwBad = f.password ? passwordProblem(f.password, f.login) : null;
  const confirmBad = f.confirm && f.confirm !== f.password ? '비밀번호가 서로 다릅니다' : null;
  const ready = f.login && f.name.trim() && f.email && f.password && f.confirm && !loginBad && !emailBad && !pwBad && !confirmBad;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) { setErr('빈 칸과 빨간 안내를 먼저 확인하세요'); return; }
    setBusy(true); setErr('');
    try { const r = await api.signup({ login: f.login, name: f.name.trim(), email: f.email.trim(), password: f.password }); setDone(r.login); }
    catch (e: any) { setErr(String(e?.message || e)); }
    finally { setBusy(false); }
  }

  if (done) return (
    <AuthFrame width={460}>
      <span className="login-brand brand-logo" aria-label="RosieOh" />
      <h2>가입 신청을 받았습니다</h2>
      <p><b>{done}</b> 계정은 관리자가 승인하면 로그인할 수 있습니다. 승인되면 다시 와서 로그인하세요.</p>
      <a className="login-cta" href="#">로그인 화면으로</a>
    </AuthFrame>
  );

  return (
    <AuthFrame>
      <span className="login-brand brand-logo" aria-label="RosieOh" />
      <h2>회원가입</h2>
      <p>가입하면 관리자 승인 뒤에 로그인할 수 있습니다. 처음엔 보기 권한입니다.</p>
      <form className="auth-form" onSubmit={submit} noValidate>
        <label className="fld"><span>아이디</span>
          <input autoComplete="username" value={f.login} onChange={(e) => setF({ ...f, login: e.target.value.toLowerCase() })} autoFocus />
          {loginBad && <small className="err">{loginBad}</small>}</label>
        <div className="auth-row">
          <label className="fld"><span>이름</span><input autoComplete="name" value={f.name} maxLength={40} onChange={set('name')} /></label>
          <label className="fld"><span>이메일</span><input type="email" autoComplete="email" value={f.email} onChange={set('email')} />
            {emailBad && <small className="err">{emailBad}</small>}</label>
        </div>
        <div className="auth-row">
          <label className="fld"><span>비밀번호</span><input type="password" autoComplete="new-password" value={f.password} onChange={set('password')} />
            {pwBad && <small className="err">{pwBad}</small>}</label>
          <label className="fld"><span>비밀번호 확인</span><input type="password" autoComplete="new-password" value={f.confirm} onChange={set('confirm')} />
            {confirmBad && <small className="err">{confirmBad}</small>}</label>
        </div>
        <div className="auth-hint" style={{ marginTop: -4 }}>비밀번호는 영문과 숫자를 섞어 8자 이상.</div>
        {err && <div className="err" role="alert">{err}</div>}
        <button className="login-cta" type="submit" disabled={busy}>{busy ? '보내는 중…' : '가입 신청'}</button>
      </form>
      <div className="auth-or"><span>또는</span></div>
      <a className="login-cta auth-gh" href="/dashapi/login"><GithubMark />GitHub 계정으로 가입 신청</a>
      <div className="auth-links"><a href="#">이미 계정이 있습니다, 로그인</a></div>
    </AuthFrame>
  );
}

/** 로그인 전 화면 — #signup 이면 회원가입, 아니면 로그인 */
export function AuthPages() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => { const f = () => setHash(location.hash); window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f); }, []);
  return hash.startsWith('#signup') ? <Signup /> : <Login />;
}
