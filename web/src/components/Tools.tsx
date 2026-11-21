import { KeyRound, Send } from 'lucide-react';
import { FlaskConical as FlaskConicalIcon } from 'lucide-react';
import { useState } from 'react';
import { api, callTestbed } from '../api';
import { Picker } from './Picker';

const TOKEN_KEY = 'dash_test_token';

export function Tools() {
  // token generator
  const [sub, setSub] = useState('dev-tester');
  const [role, setRole] = useState('');
  const [ttl, setTtl] = useState(3600);
  const [genOut, setGenOut] = useState('');
  const [genErr, setGenErr] = useState('');

  async function gen() {
    setGenErr(''); setGenOut('');
    try {
      const r: any = await api.token({ sub, role: role || undefined, ttl: Number(ttl) });
      if (r.error) { setGenErr(r.error); return; }
      setGenOut(r.token);
      localStorage.setItem(TOKEN_KEY, r.token);
      setTok(r.token);
    } catch (e: any) { setGenErr(String(e?.message || e)); }
  }

  // api tester
  const [method, setMethod] = useState('GET');
  const [path, setPath] = useState('/actuator/health');
  const [tok, setTok] = useState(localStorage.getItem(TOKEN_KEY) || '');
  const [reqBody, setReqBody] = useState('');
  const [resp, setResp] = useState<{ status: number; ms: number; body: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [reqErr, setReqErr] = useState('');

  async function send() {
    setReqErr(''); setResp(null); setBusy(true);
    try {
      const r = await callTestbed(method, path, tok || undefined, ['GET', 'HEAD'].includes(method) ? undefined : reqBody);
      setResp(r);
    } catch (e: any) { setReqErr(String(e?.message || e)); }
    finally { setBusy(false); }
  }

  return (
    <div>
      <div className="topbar"><div><h1><FlaskConicalIcon size={22} />Tools</h1><div className="sub">테스트 토큰 발급, 테스트배드 API 호출</div></div></div>

      <div className="scard" style={{ marginBottom: 14, cursor: 'default' }}>
        <header className="scard-head"><span className="scard-icon"><KeyRound size={17} /></span><div><div className="scard-title">테스트 토큰 발급</div><div className="scard-sub">테스트배드 API 를 부를 JWT</div></div></header>
        <div className="scard-body">
          <div className="row">
            <label className="fld"><span>sub</span><input value={sub} onChange={(e) => setSub(e.target.value)} /></label>
            <label className="fld"><span>role (선택)</span><input value={role} onChange={(e) => setRole(e.target.value)} placeholder="예: PROTECTOR" /></label>
            <label className="fld"><span>ttl (초)</span><input type="number" value={ttl} onChange={(e) => setTtl(Number(e.target.value))} /></label>
          </div>
          <button className="btn primary" onClick={gen}>발급</button>
          {genErr && <div className="err">{genErr}</div>}
          {genOut && <div className="out" style={{ marginTop: 12 }}>{genOut}</div>}
          {genOut && <div className="code" style={{ marginTop: 6 }}>아래 API 테스터에 자동 적용됨 (localStorage 저장)</div>}
        </div>
      </div>

      <div className="scard" style={{ cursor: 'default' }}>
        <header className="scard-head"><span className="scard-icon"><Send size={17} /></span><div><div className="scard-title">API 테스터</div><div className="scard-sub">테스트배드에 요청을 보내고 응답을 봅니다</div></div></header>
        <div className="scard-body">
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <label className="fld" style={{ flex: '0 0 110px' }}><span>method</span>
              <Picker label="method" value={method} onChange={setMethod}
                options={['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => ({ value: m, label: m }))} />
            </label>
            <label className="fld" style={{ flex: 1 }}><span>테스트배드 경로 (TESTBED_URL 뒤)</span><input className="mono" value={path} onChange={(e) => setPath(e.target.value)} placeholder="/api/v1/..." /></label>
          </div>
          <label className="fld"><span>Bearer token (선택)</span><input className="mono" value={tok} onChange={(e) => setTok(e.target.value)} placeholder="JWT…" /></label>
          {!['GET', 'HEAD'].includes(method) && (
            <label className="fld"><span>body (JSON)</span><textarea value={reqBody} onChange={(e) => setReqBody(e.target.value)} placeholder='{ "key": "value" }' /></label>
          )}
          <button className="btn primary" onClick={send} disabled={busy}>{busy ? '호출 중…' : '보내기'}</button>
          {reqErr && <div className="err">{reqErr}</div>}
          {resp && (
            <div style={{ marginTop: 12 }}>
              <div className="code" style={{ marginBottom: 6 }}>
                status <span className={resp.status < 400 ? 'v green' : 'v red'}>{resp.status}</span>, {resp.ms} ms
              </div>
              <div className="out">{prettify(resp.body)}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function prettify(s: string) {
  try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return s; }
}
