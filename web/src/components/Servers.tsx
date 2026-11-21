import { AlertTriangle as AlertIco, Server as ServerIco } from 'lucide-react';
import { ghRepo } from '../github';
import { User, Users } from '../users';
import { Server as ServerIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { RefreshBar, usePoll } from '../poll';
import { hashParam } from './Tabs';
import { AlertTriangle, Boxes, LineChart, RotateCcw, ScrollText, Search } from 'lucide-react';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, ICellRendererParams } from 'ag-grid-community';
import { ProbeContainer, ServerView, serversApi } from '../api';
import { useCatalog } from '../catalog';
import { defaultColDef, gridTheme, localeKo, when } from '../grid';
import { Copyable } from './Copyable';
import { Drawer } from './Drawer';
import { Logo } from './Logo';

// 서버 — 서버마다 CPU·메모리·디스크·컨테이너, 서비스 로그, 재시작. 점검은 각 저장소의 배포 키로(서버에 설치 없음)
const gb = (b?: number) => (b == null ? '' : b >= 1e12 ? `${(b / 1e12).toFixed(1)}TB` : b >= 1e9 ? `${(b / 1e9).toFixed(1)}GB` : `${Math.round(b / 1e6)}MB`);
const pctColor = (p: number) => (p >= 90 ? 'var(--red)' : p >= 75 ? 'var(--amber)' : 'var(--green)');
const up = (s: number) => (s > 86400 ? `${Math.floor(s / 86400)}일` : `${Math.floor(s / 3600)}시간`);

// 카드의 자원 한 줄 — 이름 · 막대 · % · 사용량
function Usage({ label, pct, detail }: { label: string; pct: number; detail: string }) {
  const c = pctColor(pct);
  return (
    <div className="usage">
      <span className="usage-label">{label}</span>
      <span className="sv-track"><span style={{ width: `${Math.min(100, pct)}%`, background: c }} /></span>
      <span className="usage-pct" style={c === 'var(--green)' ? undefined : { color: c }}>{Math.round(pct)}%</span>
      <span className="usage-detail">{detail}</span>
    </div>
  );
}

const MAX_SVC = 3;
function Bar({ label, pct, text }: { label: string; pct: number; text: string }) {
  return (
    <div className="sv-bar">
      <div className="sv-bar-top"><span className="muted">{label}</span><span>{text}</span></div>
      <div className="sv-track"><span style={{ width: `${Math.min(100, pct)}%`, background: pctColor(pct) }} /></div>
    </div>
  );
}

function Spark({ pts, k, max, color }: { pts: ServerView['history']; k: 'load1' | 'memPct' | 'diskPct'; max: number; color: string }) {
  if (pts.length < 2) return <span className="muted" style={{ fontSize: 11 }}>기록 쌓는 중</span>;
  const w = 220, h = 36;
  const xs = pts.map((_, i) => (i / (pts.length - 1)) * w);
  const ys = pts.map((p) => h - Math.min(1, p[k] / max) * (h - 2) - 1);
  return <svg width={w} height={h} style={{ display: 'block' }}><polyline fill="none" stroke={color} strokeWidth={1.5} points={xs.map((x, i) => `${x},${ys[i]}`).join(' ')} /></svg>;
}

// 설정(카탈로그) 순서 — 올라간 서비스의 프로젝트가 설정 트리에서 처음 나오는 자리대로, 공용(사내·테스트배드)은 뒤에
export const byCatalog = (rank: (id: string | null | undefined) => number, comp: (key: string) => { project: string } | undefined) => {
  const at = (s: ServerView) => (s.node ? Math.min(...s.services.map((x) => rank(comp(x.comp)?.project))) : Infinity);
  return (a: ServerView, b: ServerView) => at(a) - at(b) || a.id.localeCompare(b.id);
};

export function Servers({ deployer }: { deployer: boolean }) {
  const { comp, node, rank } = useCatalog();
  const [d, setD] = useState<Awaited<ReturnType<typeof serversApi.list>> | null>(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState<string | null>(() => hashParam('open'));
  const load = () => serversApi.list().then(setD).catch((e) => setErr(String(e?.message || e)));
  const poll = usePoll(load, 10000);
  const sel = d?.servers.find((s) => s.id === open);
  const bad = (d?.servers ?? []).filter((s) => s.alerts.some((a) => a.level === 'bad')).length;

  return (
    <div>
      <div className="topbar">
        <div>
          <h1><ServerIcon size={22} />서버</h1>
          <div className="sub">
            {d ? `서버 ${d.servers.length}대, 15분마다 점검` : '\u00a0'}{bad ? <>, <span className="red">문제 {bad}대</span></> : null}
          </div>
        </div>
        <RefreshBar poll={poll} />
      </div>
      {err && <div className="panel err">{err}</div>}
      {d && !d.canRun && <div className="panel amber" style={{ marginBottom: 12 }}>점검 요청, 로그, 재시작을 쓸 수 없습니다(콘솔 설정 필요).</div>}
      <div className="sv-grid">
        {(d?.servers ?? []).slice().sort(byCatalog(rank, comp)).map((s) => {
          const p = s.probe;
          const memPct = p && p.mem.total ? (1 - p.mem.available / p.mem.total) * 100 : 0;
          const level = s.alerts.some((a) => a.level === 'bad') ? 'bad' : s.alerts.length ? 'warn' : 'ok';
          const mainDisk = p?.disks.find((x) => x.mount === '/') ?? p?.disks[0];
          const names = s.services.map((x) => ({ x, c: comp(x.comp) }));
          return (
            <article key={s.id} className={'scard ' + level} onClick={() => setOpen(s.id)}>
              <header className="scard-head">
                {node(s.node) ? <Logo file={node(s.node)!.logo} name={s.short} size={34} /> : <span className="scard-icon"><ServerIco size={18} /></span>}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="scard-title">{s.short}{s.node && <span className="chip scard-env">운영</span>}</div>
                  <div className="scard-addr">
                    {s.ip && <Copyable text={s.ip} />}
                    {s.domains.slice(0, 1).map((h) => <Copyable key={h} text={h} />)}
                  </div>
                </div>
                <span className={'chip ' + (level === 'ok' ? 'green' : level === 'bad' ? 'red' : 'amber')}>{level === 'ok' ? '정상' : level === 'bad' ? '문제' : '주의'}</span>
              </header>
              <div className="scard-body">
                {p ? (
                  <div className="usages">
                    <Usage label="CPU" pct={(p.load[1] / p.cpus) * 100} detail={`${p.cpus}코어`} />
                    <Usage label="메모리" pct={memPct} detail={`${gb(p.mem.total - p.mem.available)} / ${gb(p.mem.total)}`} />
                    {mainDisk && <Usage label="디스크" pct={mainDisk.pct} detail={`${gb(mainDisk.used)} / ${gb(mainDisk.size)}`} />}
                  </div>
                ) : <div className="scard-empty">{s.reachable === false ? '서버에 접속하지 못했습니다' : '아직 점검 결과가 없습니다'}</div>}
                {s.alerts.length > 0 && <div className={'scard-alert ' + level}>{s.alerts.map((a) => <div key={a.text}><AlertIco size={14} />{a.text}</div>)}</div>}
                <div className="scard-svcs">
                  {names.slice(0, names.length > MAX_SVC + 1 ? MAX_SVC : names.length).map(({ x, c }) => <span key={x.kamal} className="chip svc" title={x.kamal}><Logo file={c?.logo} name={c?.name ?? x.comp} size={16} />{c?.name ?? x.comp}</span>)}
                  {names.length > MAX_SVC + 1 && <span className="chip svc more" title={names.slice(MAX_SVC).map(({ x, c }) => c?.name ?? x.comp).join('\n')}>외 {names.length - MAX_SVC}개</span>}
                </div>
              </div>
              <footer className="scard-meta">
                {p && <span>컨테이너 {p.containers.filter((c) => c.state === 'running').length}개</span>}
                {p && <span>가동 {up(p.uptimeSec)}</span>}
                <span>{s.at ? `점검 ${when(s.at)}` : '점검 전'}</span>
              </footer>
            </article>
          );
        })}
      </div>
      {(d?.restarts.length ?? 0) > 0 && (
        <div className="panel" style={{ marginTop: 14 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>최근 재시작</div>
          {d!.restarts.map((r) => <div key={r.at + r.target} className="kv"><span className="k" style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>{when(r.at)} <User login={r.by} size={16} /> {d!.servers.find((x) => x.id === r.server)?.name ?? r.server} · {r.target}</span><span className="v">{r.status}</span></div>)}
        </div>
      )}
      {sel && <Drawer wide onClose={() => setOpen(null)}><ServerDetail s={sel} deployer={deployer} canRun={!!d?.canRun} onChange={load} /></Drawer>}
    </div>
  );
}

function ServerDetail({ s, deployer, canRun, onChange }: { s: ServerView; deployer: boolean; canRun: boolean; onChange: () => void }) {
  const { comp } = useCatalog();
  const [msg, setMsg] = useState('');
  const [logT, setLogT] = useState<string | null>(null);
  const [restartT, setRestartT] = useState<string | null>(null);
  const svcOf = (name: string) => s.services.find((x) => name.startsWith(`${x.kamal}-web-`));
  const rows = (s.probe?.containers ?? []).slice().sort((a, b) => Number(!!svcOf(b.name)) - Number(!!svcOf(a.name)) || Number(b.state === 'running') - Number(a.state === 'running'));
  const cols: ColDef<ProbeContainer>[] = useMemo(() => [
    { headerName: '컨테이너', minWidth: 200, flex: 1.4, field: 'name',
      cellRenderer: (p: ICellRendererParams<ProbeContainer>) => { const x = svcOf(p.data!.name); const c = x && comp(x.comp); return <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', minWidth: 0, maxWidth: '100%' }}>{c && <Logo file={c.logo} name={c.name} size={14} />}<Copyable text={p.data!.name} /></span>; } },
    { headerName: '상태', width: 150, valueGetter: (p) => p.data!.status, cellRenderer: (p: ICellRendererParams<ProbeContainer>) => <span className={p.data!.state === 'running' ? (/unhealthy/.test(p.data!.status) ? 'red' : 'green') : 'muted'}>{p.data!.status}</span> },
    { headerName: 'CPU', width: 80, valueGetter: (p) => p.data!.cpu, valueFormatter: (p) => (p.value == null ? '' : `${p.value}%`) },
    { headerName: '메모리', width: 140, valueGetter: (p) => p.data!.memBytes, valueFormatter: (p) => (p.value == null ? '' : `${gb(p.value)}${p.data!.memLimit ? ' / ' + gb(p.data!.memLimit) : ''}`) },
    { headerName: '', width: 150, sortable: false, filter: false,
      cellRenderer: (p: ICellRendererParams<ProbeContainer>) => { const x = svcOf(p.data!.name); if (!x || p.data!.state !== 'running' || !deployer) return null;
        return <span style={{ display: 'inline-flex', gap: 4 }}><button className="btn ghost" style={{ padding: '1px 7px' }} onClick={() => setLogT(x.kamal)}>로그</button><button className="btn ghost" style={{ padding: '1px 7px', color: 'var(--red)' }} onClick={() => setRestartT(x.kamal)}>재시작</button></span>; } },
  ], [s]);   // eslint-disable-line
  const act = async (f: () => Promise<unknown>, ok: string) => { setMsg(''); try { await f(); setMsg(ok); onChange(); } catch (e: any) { setMsg(String(e?.message || e)); } };

  return (
    <div>
      <h2>{s.name}</h2>
      <div className="scard-addr" style={{ marginTop: 6 }}>
        {s.ip && <Copyable text={s.ip} />}
        {s.domains.map((h) => <Copyable key={h} text={h} />)}
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{s.note ? `${s.note}, ` : ''}점검 {s.at ? when(s.at) : '전'}</div>
      {s.probe && <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>부하 {s.probe.load.join(', ')} ({s.probe.cpus}코어), 디스크 {s.probe.disks.map((x) => `${x.mount} ${x.pct}% (${gb(x.used)} / ${gb(x.size)})`).join(', ')}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button className="btn ghost" disabled={!canRun || s.pending.some((p) => p.action === 'probe')} onClick={() => act(() => serversApi.probe(s.id), '점검 요청됨')}>{s.pending.some((p) => p.action === 'probe') ? '점검 중…' : '지금 확인'}</button>
        <a className="btn ghost" href={`${ghRepo(s.repo)}/actions/workflows/probe.yml`} target="_blank" rel="noreferrer">점검 실행 기록 ↗</a>
      </div>
      {msg && <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{msg}</div>}
      {s.alerts.length > 0 && <div className="sec"><h3><AlertTriangle size={14} />경고</h3>{s.alerts.map((a) => <div key={a.text} className={a.level === 'bad' ? 'red' : 'amber'} style={{ fontSize: 12.5 }}>● {a.text}</div>)}</div>}
      <div className="sec">
        <h3><LineChart size={14} />7일 추이</h3>
        <div className="kv"><span className="k">부하(1분)</span><span className="v"><Spark pts={s.history} k="load1" max={Math.max(1, s.probe?.cpus ?? 1)} color="#5b8def" /></span></div>
        <div className="kv"><span className="k">메모리 %</span><span className="v"><Spark pts={s.history} k="memPct" max={100} color="#3ecf8e" /></span></div>
        <div className="kv"><span className="k">디스크 % (가장 찬 곳)</span><span className="v"><Spark pts={s.history} k="diskPct" max={100} color="#f5a623" /></span></div>
      </div>
      <div className="sec">
        <h3><Boxes size={14} />컨테이너 {rows.length}</h3>
        <div style={{ height: Math.min(80 + rows.length * 36, 420) }}>
          <AgGridReact<ProbeContainer> theme={gridTheme} localeText={localeKo} rowData={rows} columnDefs={cols} defaultColDef={defaultColDef} rowHeight={36} getRowId={(p) => p.data.name} suppressCellFocus />
        </div>
        {!deployer && <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>로그, 재시작은 관리자, 배포 담당만 할 수 있습니다.</div>}
      </div>
      {logT && <LogView s={s} target={logT} onClose={() => setLogT(null)} />}
      {restartT && <RestartForm s={s} target={restartT} onClose={() => setRestartT(null)} onDone={(m) => { setRestartT(null); setMsg(m); onChange(); }} />}
    </div>
  );
}

function LogView({ s, target, onClose }: { s: ServerView; target: string; onClose: () => void }) {
  const [d, setD] = useState<Awaited<ReturnType<typeof serversApi.logs>> | null>(null);
  const [q, setQ] = useState('');
  const [err, setErr] = useState('');
  const [asked, setAsked] = useState<number>(0);
  useEffect(() => { serversApi.requestLogs(s.id, target).then(() => setAsked(Date.now())).catch((e) => setErr(String(e?.message || e))); }, [s.id, target]);
  useEffect(() => {
    const t = setInterval(() => serversApi.logs(s.id, target).then(setD).catch(() => {}), 3000);
    serversApi.logs(s.id, target).then(setD).catch(() => {});
    return () => clearInterval(t);
  }, [s.id, target]);
  const fresh = d?.at && Date.parse(d.at) >= asked - 5000;
  const lines = (d?.lines ?? []).filter((l) => !q || l.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="sec">
      <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><ScrollText size={14} />로그, {target} <button className="btn ghost" style={{ padding: '1px 7px', marginLeft: 'auto' }} onClick={onClose}>닫기</button></h3>
      <div className="muted" style={{ fontSize: 11.5, marginBottom: 6 }}>
        {err || (fresh ? `${d!.container}, 끝 ${d!.lines.length}줄, ${when(d!.at)}, 이메일, 전화, 토큰은 가려서 보여 줍니다(저장하지 않음)` : '서버에서 받아 오는 중…(30초 안팎)')}
      </div>
      <input placeholder="찾기(ERROR, 예외 이름 …)" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 6 }} />
      <pre className="out" style={{ maxHeight: 420 }}>{lines.map((l, i) => <div key={i} className={/\b(ERROR|Exception|FATAL)\b/.test(l) ? 'red' : /\bWARN/.test(l) ? 'amber' : ''}>{l}</div>)}</pre>
    </div>
  );
}

function RestartForm({ s, target, onClose, onDone }: { s: ServerView; target: string; onClose: () => void; onDone: (m: string) => void }) {
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  return (
    <div className="sec">
      <div className="panel" style={{ borderColor: 'var(--red)' }}>
        <div style={{ fontWeight: 600 }}>{target} 재시작</div>
        <div className="muted" style={{ fontSize: 12, margin: '4px 0 8px' }}>같은 버전으로 다시 켭니다. 켜지는 동안 요청이 끊깁니다.</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <input placeholder={`"${target}" 입력`} value={confirm} onChange={(e) => setConfirm(e.target.value)} style={{ width: 200 }} />
          <button className="btn primary" style={{ background: 'var(--red)', borderColor: 'var(--red)', color: '#fff' }} disabled={busy || confirm !== target}
            onClick={async () => { setBusy(true); setErr(''); try { await serversApi.restart(s.id, target, confirm); onDone(`${target} 재시작 요청됨`); } catch (e: any) { setErr(String(e?.message || e)); } finally { setBusy(false); } }}>재시작</button>
          <button className="btn ghost" onClick={onClose}>취소</button>
        </div>
        {err && <div className="err">{err}</div>}
      </div>
    </div>
  );
}
