import { User, Users } from '../users';
import { ghRepo } from '../github';
import { Rocket as RocketIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, ICellRendererParams } from 'ag-grid-community';
import {
  api, ApkChange, ApkRepo, AuditEntry, CatalogComponent, DeployOverview, DeployRun, EnvStatus, KIND_LABEL, LANE_LABEL, ServiceStatus, StoreAppView, StoreRun, TrackView, VersionNotes, projectPath,
} from '../api';
import { useCatalog } from '../catalog';
import { defaultColDef, gridTheme, lasting, localeKo, when } from '../grid';
import { Drawer } from './Drawer';
import { Logo } from './Logo';
import { BookOpen, CheckCircle2, ChevronRight, GitBranch, Loader2, Lock, MinusCircle, PlayCircle, ScrollText, Undo2, Workflow, XCircle } from 'lucide-react';
import { MiniGrid } from './MiniGrid';
import { AlertTriangle, ClipboardList, ShieldAlert, ExternalLink, FlaskConical, Globe, Layers, Link2, Rocket as RocketI, Server as ServerIcon, Smartphone, StickyNote, Store } from 'lucide-react';
import { Section } from './Section';
import { DeployHistory } from './DeployHistory';
import { Promote } from './Promote';
import { TabPanel, Tabs, Toolbar, useHashTab } from './Tabs';
import { RefreshBar, usePoll } from '../poll';

type Env = 'prod' | 'testbed';
const ENV_LABEL: Record<Env, string> = { prod: '운영', testbed: '테스트배드' };
const STATE: Record<string, [string, string]> = {
  success: ['성공', 'green'], failure: ['실패', 'red'], cancelled: ['취소', 'muted'], skipped: ['건너뜀', 'muted'], running: ['실행 중', 'amber'],
};
const stateOf = (s: string) => STATE[s] ?? [s, 'muted'];

interface Row {
  c: CatalogComponent; path: string; tracks: Partial<Record<Env, TrackView>>; health?: ServiceStatus; store?: StoreAppView;
  last: (DeployRun & { env: Env }) | null; lastStore: StoreRun | null; apk?: ApkRepo;
}

function lastOf(tracks: Partial<Record<Env, TrackView>>): (DeployRun & { env: Env }) | null {
  let best: (DeployRun & { env: Env }) | null = null;
  for (const env of ['prod', 'testbed'] as Env[]) {
    const l = tracks[env]?.last;
    if (l && (!best || l.at > best.at)) best = { ...l, env };
  }
  return best;
}

function HealthLink({ s }: { s?: EnvStatus }) {
  if (!s) return null;
  if (!s.checked_at) return <a className="cell-link" href={s.link} target="_blank" rel="noreferrer">확인 중</a>;
  return <a className={'cell-link ' + (s.up ? 'green' : 'red')} href={s.link} target="_blank" rel="noreferrer" title={s.error || s.link}>{s.up ? 'UP' : 'DOWN'} ↗</a>;
}

function TrackCell({ t, h }: { t?: TrackView; h?: EnvStatus }) {
  if (!t) return h ? <span><span className="muted">배포 연결 없음</span><HealthLink s={h} /></span> : <span className="muted"></span>;
  const c = t.current;
  return (
    <div style={{ lineHeight: 1.35, paddingTop: 5 }}>
      <div>
        {c ? <a href={c.url} target="_blank" rel="noreferrer" className="mono" style={{ fontWeight: 600 }} title="이 버전을 올린 실행 로그">{c.version}</a> : <span className="muted">기록 없음</span>}
        {c?.action === 'rollback' && <span className="chip amber" style={{ marginLeft: 6 }}>되돌림</span>}
        {c?.warn && <span title={c.warn} className="amber" style={{ marginLeft: 6 }}>⚠</span>}
        {t.running.length > 0 && <a className="chip amber" style={{ marginLeft: 6 }} href={t.running[0].url} target="_blank" rel="noreferrer">실행 중 ↗</a>}
        <HealthLink s={h} />
      </div>
      <div className="muted" style={{ fontSize: 11, display: 'flex', gap: 6, alignItems: 'center' }}>{c && <>#{c.number}, {when(c.at)}{c.actor && <User login={c.actor} size={14} />}</>}</div>
    </div>
  );
}

function StoreCell({ s }: { s?: StoreAppView }) {
  if (!s) return <span className="muted"></span>;
  return (
    <div style={{ lineHeight: 1.35, paddingTop: 5 }}>
      <div>
        {s.storeVersion ? <a className="mono" style={{ fontWeight: 600 }} href={s.storeTagUrl || s.repoUrl} target="_blank" rel="noreferrer" title="스토어 릴리스 태그">스토어 {s.storeVersion}</a> : <span className="muted">스토어 기록 없음</span>}
        {s.lastOta && <a className="chip" style={{ marginLeft: 6 }} href={s.lastOta.url} target="_blank" rel="noreferrer" title="마지막 OTA 배포">OTA {when(s.lastOta.at)}</a>}
        {s.running.length > 0 && <a className="chip amber" style={{ marginLeft: 6 }} href={s.running[0].url} target="_blank" rel="noreferrer">실행 중 ↗</a>}
      </div>
      <div className="muted" style={{ fontSize: 11 }}>
        {s.lastStore ? `업로드 ${when(s.lastStore.at)}, 출시는 스토어 콘솔에서` : ''}{s.error && <span className="amber"> {s.error}</span>}
      </div>
    </div>
  );
}

function ApkCell({ a }: { a?: ApkRepo }) {
  const rel = a?.releases[0];
  if (!rel) return <span className="muted">릴리스 없음</span>;
  return (
    <div style={{ lineHeight: 1.35, paddingTop: 5 }}>
      <a className="mono" style={{ fontWeight: 600 }} href={rel.url} target="_blank" rel="noreferrer">APK {rel.tag}</a>
      <div className="muted" style={{ fontSize: 11 }}>{when(rel.date)}{rel.versionCode ? `, versionCode ${rel.versionCode}` : ''}</div>
    </div>
  );
}

function LastCell({ r }: { r: Row }) {
  if (r.c.kind === 'store-app') {
    const l = r.store?.last;
    if (!l) return <span className="muted"></span>;
    const [label, cls] = stateOf(l.state);
    return (
      <div style={{ lineHeight: 1.35, paddingTop: 5 }}>
        <a className={cls} href={l.url} target="_blank" rel="noreferrer">{label}</a> <span className="muted">{when(l.at)}</span>
        <div className="muted" style={{ fontSize: 11, display: 'flex', gap: 6, alignItems: 'center' }}>{l.lane ? LANE_LABEL[l.lane] : ''}{l.actor && <User login={l.actor} size={14} />}</div>
      </div>
    );
  }
  const l = r.last;
  if (!l) return <span className="muted"></span>;
  const [label, cls] = stateOf(l.state);
  return (
    <div style={{ lineHeight: 1.35, paddingTop: 5 }}>
      <a className={cls} href={l.url} target="_blank" rel="noreferrer" title="실행 로그">{label}</a> <span className="muted">{when(l.at)}</span>
      <div className="muted" style={{ fontSize: 11, display: 'flex', gap: 6, alignItems: 'center' }}>{ENV_LABEL[l.env]}, {l.action === 'rollback' ? '되돌리기' : '배포'}{l.actor && <User login={l.actor} size={14} />}</div>
    </div>
  );
}

const StateBadge = ({ s }: { s: string }) => {
  const [label, cls] = stateOf(s);
  const Icon = s === 'success' ? CheckCircle2 : s === 'failure' ? XCircle : s === 'running' ? Loader2 : MinusCircle;
  return <span className={'rbadge ' + cls}><Icon size={13} />{label}</span>;
};

type HistRow = { id: string; state: string; kind: string; version: string; at: string; number: number; actor: string; url: string };
const histCols: ColDef<HistRow>[] = [
  { headerName: '결과', width: 96, field: 'state', cellRenderer: (p: ICellRendererParams<HistRow>) => <StateBadge s={p.data!.state} /> },
  { headerName: '종류', width: 84, field: 'kind' },
  { headerName: '버전', flex: 1, minWidth: 110, field: 'version', cellClass: 'mono' },
  { headerName: '시각', width: 150, field: 'at', sort: 'desc', valueFormatter: (p) => `#${p.data!.number}, ${when(p.value)}` },
  { headerName: '실행', width: 108, field: 'actor', cellRenderer: (p: ICellRendererParams<HistRow>) => <User login={p.data!.actor} size={18} /> },
  { headerName: '', width: 44, sortable: false, resizable: false, cellRenderer: (p: ICellRendererParams<HistRow>) => <a className="icon-link" href={p.data!.url} target="_blank" rel="noreferrer" title="실행 로그"><ScrollText size={15} /></a> },
];
const histRows = (runs: (DeployRun | StoreRun)[]): HistRow[] => runs.map((h) => ({
  id: String(h.id), state: h.state, number: h.number, actor: h.actor, url: h.url, at: h.at,
  kind: 'lane' in h ? (h.lane ? LANE_LABEL[h.lane] : '릴리스') : h.action === 'rollback' ? '되돌리기' : '배포',
  version: 'lane' in h ? '' : h.version ?? '',
}));

const CHG_KIND: Record<ApkChange['kind'], [string, string]> = { feat: ['기능', 'blue'], fix: ['수정', 'amber'], perf: ['성능', 'green'], other: ['기타', 'muted'] };
function ChangeItem({ c, issueUrl }: { c: ApkChange; issueUrl: string }) {
  return (
    <li>
      <span className={'chip ' + CHG_KIND[c.kind][1]}>{CHG_KIND[c.kind][0]}</span>
      <span className="chg-title">{c.title}{c.detail && <span className="muted">, {c.detail}</span>}</span>
      {c.issue && <a className="chg-issue" href={issueUrl + c.issue} target="_blank" rel="noreferrer">#{c.issue}</a>}
    </li>
  );
}
/** 버전 줄 아래 한 줄 — 그 버전에서 들어온 변경 */
function AddedLine({ list, loading }: { list: ApkChange[] | null | undefined; loading: boolean }) {
  if (loading) return <span className="vrow-added muted">변경 내용 읽는 중…</span>;
  if (!list) return null;
  if (!list.length) return <span className="vrow-added muted">들어온 변경 없음 (같은 코드 재배포)</span>;
  const [a, b] = list;
  return <span className="vrow-added" title={list.map((c) => c.title).join('\n')}>{a.title}{b ? `, ${b.title}` : ''}{list.length > 2 ? ` 외 ${list.length - 2}개` : ''}</span>;
}

/** 되돌리기 — 버전을 목록에서 골라 실행. 하한보다 먼저 배포된 버전은 잠겨 있다 */
function RollbackPanel({ name, svcKey, t, onDone, onCancel }: { name: string; svcKey: string; t: TrackView; onDone: (msg: string) => void; onCancel: () => void }) {
  const open = t.candidates.filter((v) => !t.blocked?.[v]);
  const [version, setVersion] = useState(open[0] ?? '');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const need = t.rollback?.confirm;
  const at = (v: string) => t.history.find((h) => h.version === v && h.state === 'success');
  const [notes, setNotes] = useState<VersionNotes | null>(null);
  const [notesErr, setNotesErr] = useState('');
  useEffect(() => { api.versions(svcKey, t.env).then(setNotes).catch((e) => setNotesErr(String(e?.message || e))); }, [svcKey, t.env]);
  const noteOf = (v: string) => notes?.versions.find((x) => x.version === v);
  const dropped = noteOf(version)?.dropped;
  async function go() {
    setBusy(true); setErr('');
    try {
      const r = await api.rollback({ service: svcKey, env: t.env, version, confirm: need ? confirm : undefined });
      onDone(`${name} ${ENV_LABEL[t.env]} 되돌리기를 시작했습니다: ${r.from ?? '?'} → ${r.to}`);
    } catch (e: any) { setErr(String(e?.message || e)); } finally { setBusy(false); }
  }
  return (
    <div className={'dd-panel ' + t.env}>
      <div className="dd-panel-title"><Undo2 size={15} />되돌릴 버전 고르기</div>
      <div className="vlist" role="radiogroup">
        {t.candidates.map((v) => {
          const run = at(v); const lock = t.blocked?.[v];
          return (
            <label key={v} className={'vrow' + (lock ? ' locked' : '') + (version === v ? ' on' : '')}>
              {lock ? <Lock size={15} className="vrow-ic" /> : <input type="radio" name={`rb-${t.env}`} checked={version === v} onChange={() => setVersion(v)} />}
              <span className="vrow-main">
                <span className="vrow-head">
                  <span className="mono vrow-ver">{v}</span>
                  <span className="vrow-sub">{lock ? `막힘, ${lock}` : run ? `#${run.number}, ${when(run.at)}` : ''}</span>
                  {!lock && run?.actor && <span className="vrow-who"><User login={run.actor} size={16} /></span>}
                </span>
                <AddedLine list={noteOf(v)?.added} loading={!notes && !notesErr} />
              </span>
            </label>
          );
        })}
      </div>
      {version && notes && (
        <div className="vdrop">
          <div className="vdrop-title">{version}으로 되돌리면 빠지는 변경{dropped ? ` ${dropped.length}개` : ''}</div>
          {dropped == null ? <div className="muted">변경 내용을 읽지 못했습니다</div>
            : dropped.length === 0 ? <div className="muted">빠지는 변경 없음</div>
            : <ul className="chg-list">{dropped.map((c) => <ChangeItem key={c.sha + c.title} c={c} issueUrl={notes.issueUrl} />)}</ul>}
        </div>
      )}
      {notesErr && <div className="muted">변경 내용을 불러오지 못했습니다: {notesErr}</div>}
      {!open.length && <div className="err">남은 버전이 모두 되돌리기 하한보다 먼저 배포돼 고를 수 없습니다.</div>}
      {open.length > 0 && (
        <div className="dd-panel-acts">
          {need && <input placeholder={`확인을 위해 ${need} 입력`} value={confirm} onChange={(e) => setConfirm(e.target.value)} />}
          <button className={'btn ' + (t.env === 'prod' ? 'danger' : 'primary')} disabled={busy || !version || (!!need && confirm !== need)} onClick={go}>
            {busy ? '요청 중…' : `${version || '버전'}으로 되돌리기`}
          </button>
          <button className="btn ghost" onClick={onCancel}>취소</button>
        </div>
      )}
      {err && <div className="err">{err}</div>}
    </div>
  );
}

/** 되돌리기 하한 정하기 — 데이터 형식을 바꾼 배포 뒤 옛 버전으로 못 돌아가게 막는다 */
function FloorPanel({ svcKey, t, onDone, onCancel }: { svcKey: string; t: TrackView; onDone: (msg: string) => void; onCancel: () => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const cur = t.current?.version!;
  async function go() {
    setBusy(true); setErr('');
    try { await api.rollbackFloor({ service: svcKey, env: t.env, version: cur, reason }); onDone(`${ENV_LABEL[t.env]} 되돌리기 하한을 ${cur} 로 정했습니다`); }
    catch (e: any) { setErr(String(e?.message || e)); } finally { setBusy(false); }
  }
  return (
    <div className="dd-panel floor">
      <div className="dd-panel-title"><ShieldAlert size={15} />되돌리기 하한을 <span className="mono">{cur}</span> 로 정하기</div>
      <p className="dd-panel-help">이 버전보다 먼저 배포된 버전으로는 되돌릴 수 없게 됩니다. 저장 형식이나 암호를 바꾼 배포 뒤에 정하세요.</p>
      <div className="dd-panel-acts">
        <input placeholder="이유 (되돌리기 목록에 그대로 보임)" value={reason} onChange={(e) => setReason(e.target.value)} />
        <button className="btn primary" disabled={busy || !reason.trim()} onClick={go}>정하기</button>
        <button className="btn ghost" onClick={onCancel}>취소</button>
      </div>
      {err && <div className="err">{err}</div>}
    </div>
  );
}

function EnvCard({ c, t, canRollback, deployer, admin, onDone }: { c: CatalogComponent; t: TrackView; canRollback: boolean; deployer: boolean; admin: boolean; onDone: (m: string) => void }) {
  const [mode, setMode] = useState<'' | 'rollback' | 'floor'>('');
  const [err, setErr] = useState('');
  const cur = t.current;
  const last = t.running[0] ?? t.last;
  const canRb = deployer && canRollback && !!t.rollback;
  async function clearFloor() {
    setErr('');
    try { await api.rollbackFloor({ service: c.key, env: t.env, clear: true }); onDone(`${ENV_LABEL[t.env]} 되돌리기 하한을 풀었습니다`); }
    catch (e: any) { setErr(String(e?.message || e)); }
  }
  const done = (m: string) => { setMode(''); onDone(m); };
  return (
    <div className={'scard static dd-env' + (last?.state === 'failure' ? ' bad' : '')}>
      <div className="scard-head">
        <span className="scard-icon">{t.env === 'prod' ? <RocketI size={17} /> : <FlaskConical size={17} />}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="scard-title">{ENV_LABEL[t.env]}</div>
          <div className="scard-sub">{t.kamal}, {t.dest}</div>
        </div>
        {last && <StateBadge s={last.state} />}
      </div>
      <div className="scard-body">
        <div className="metrics dd-metrics">
          <div className="metric"><div className="metric-label">지금 버전</div><div className="metric-value mono">{cur?.version ?? ''}</div>
            <div className="metric-detail">{cur?.action === 'rollback' ? '되돌려서 올린 버전' : cur ? '배포로 올린 버전' : '기록 없음'}</div></div>
          <div className="metric"><div className="metric-label">올린 시각</div><div className="metric-value sm">{cur ? when(cur.at) : ''}</div>
            <div className="metric-detail">{cur ? <a href={cur.url} target="_blank" rel="noreferrer">실행 #{cur.number} ↗</a> : ''}</div></div>
          <div className="metric"><div className="metric-label">올린 사람</div><div className="metric-value sm">{cur?.actor ? <User login={cur.actor} size={22} /> : ''}</div>
            <div className="metric-detail">{cur?.actor ? '실행한 계정' : ''}</div></div>
        </div>
        {cur?.warn && <div className="scard-alert warn" style={{ marginTop: 0, marginBottom: 10 }}><div><AlertTriangle size={14} />{cur.warn}</div></div>}
        {t.floor && (
          <div className="dd-floor">
            <ShieldAlert size={16} />
            <div className="dd-floor-main">
              <div><b>되돌리기 하한</b> <span className="mono">{t.floor.version}</span></div>
              <div className="dd-floor-sub">{t.floor.reason}, <User login={t.floor.by} size={16} /> {when(t.floor.at)}</div>
            </div>
            {admin && <button className="btn sm" onClick={clearFloor}>풀기</button>}
          </div>
        )}
        {t.rollback && (
          <div className="dd-acts">
            {canRb && (t.candidates.length
              ? <button className={'btn' + (mode === 'rollback' ? ' on' : '')} onClick={() => setMode(mode === 'rollback' ? '' : 'rollback')}><Undo2 size={15} />되돌리기</button>
              : <span className="muted dd-note">되돌릴 이전 버전이 서버에 없습니다</span>)}
            {admin && cur && cur.version !== t.floor?.version && (
              <button className={'btn' + (mode === 'floor' ? ' on' : '')} onClick={() => setMode(mode === 'floor' ? '' : 'floor')}><ShieldAlert size={15} />하한 정하기</button>
            )}
            {!canRb && <span className="muted dd-note">되돌리기는 관리자, 배포 담당만 할 수 있습니다</span>}
          </div>
        )}
        {mode === 'rollback' && <RollbackPanel key={`${t.floor?.version}:${t.candidates.join()}`} name={c.name} svcKey={c.key} t={t} onDone={done} onCancel={() => setMode('')} />}
        {mode === 'floor' && <FloorPanel svcKey={c.key} t={t} onDone={done} onCancel={() => setMode('')} />}
        {err && <div className="err">{err}</div>}
        <div className="scard-label dd-hist-label">배포 기록</div>
        <MiniGrid rows={histRows([...t.running, ...t.history])} cols={histCols} rowId={(r) => r.id} rowHeight={38} />
      </div>
    </div>
  );
}

function Detail({ r, canRollback, deployer, admin, onDone, onOpenDocs, onOpenFlow }: { r: Row; canRollback: boolean; deployer: boolean; admin: boolean; onDone: (m: string) => void; onOpenDocs: (k: string) => void; onOpenFlow: (k: string) => void }) {
  const c = r.c;
  const host = (u: string) => { try { return new URL(u).host + new URL(u).pathname.replace(/\/$/, ''); } catch { return u; } };
  const links: { icon: React.ReactNode; label: string; sub?: string; href?: string; onClick?: () => void; main?: boolean }[] = [
    { icon: <Workflow size={19} />, label: '배포 흐름에서 보기', sub: '이 서비스가 어디를 거쳐 배포되는지 전체 도식에서', onClick: () => onOpenFlow(c.key), main: true },
    ...(c.prod ? [{ icon: <RocketI size={17} />, label: '운영 사이트', sub: host(c.prod.link), href: c.prod.link }] : []),
    ...(c.testbed ? [{ icon: <FlaskConical size={17} />, label: '테스트배드', sub: host(c.testbed.link), href: c.testbed.link }] : []),
    ...(c.repo ? [{ icon: <GitBranch size={17} />, label: '저장소', sub: c.repo, href: ghRepo(c.repo) },
                  { icon: <PlayCircle size={17} />, label: 'Actions', sub: '실행 기록', href: `${ghRepo(c.repo)}/actions` }] : []),
    ...(c.docs ? [{ icon: <BookOpen size={17} />, label: 'API 문서', sub: '콘솔에서 보기', onClick: () => onOpenDocs(c.key) }] : []),
    ...(c.kind === 'store-app' ? [{ icon: <Store size={17} />, label: 'Play Console', sub: 'Google Play', href: 'https://play.google.com/console' },
                                  { icon: <Store size={17} />, label: 'App Store Connect', sub: 'Apple', href: 'https://appstoreconnect.apple.com/apps' }] : []),
  ];
  return (
    <div className="dd">
      <div className="dd-head">
        <Logo file={c.logo} name={c.name} size={44} />
        <div style={{ minWidth: 0 }}>
          <h2>{c.name}</h2>
          <div className="dd-sub"><span className="chip">{KIND_LABEL[c.kind]}</span>{r.path}</div>
        </div>
      </div>
      <div className="scard static">
        <div className="scard-head"><span className="scard-icon"><Link2 size={17} /></span><div className="scard-title">바로 가기</div></div>
        <div className="scard-body">
          <div className="dd-links">
            {links.map((l) => {
              const inner = <><span className="dd-link-ic">{l.icon}</span><span className="dd-link-txt"><b>{l.label}</b>{l.sub && <small>{l.sub}</small>}</span>{l.href ? <ExternalLink size={14} className="dd-link-ext" /> : <ChevronRight size={16} className="dd-link-ext" />}</>;
              return l.href
                ? <a key={l.label} className={'dd-link' + (l.main ? ' main' : '')} href={l.href} target="_blank" rel="noreferrer">{inner}</a>
                : <button key={l.label} className={'dd-link' + (l.main ? ' main' : '')} onClick={l.onClick}>{inner}</button>;
            })}
          </div>
          {(c.db || c.note) && (
            <dl className="lv" style={{ marginTop: 12, marginBottom: 0 }}>
              {c.db && <><dt>테스트배드 DB</dt><dd className="mono">{c.db}</dd></>}
              {c.note && <><dt>메모</dt><dd style={{ fontWeight: 500 }}>{c.note}</dd></>}
            </dl>
          )}
        </div>
      </div>
      {(['prod', 'testbed'] as Env[]).map((env) => r.tracks[env] && (
        <EnvCard key={env} c={c} t={r.tracks[env]!} canRollback={canRollback} deployer={deployer} admin={admin} onDone={onDone} />
      ))}
      {r.store && (
        <div className="scard static">
          <div className="scard-head">
            <span className="scard-icon"><Store size={17} /></span>
            <div style={{ flex: 1 }}><div className="scard-title">릴리스</div><div className="scard-sub">스토어 버전 {r.store.storeVersion ?? '없음'}{r.store.storeAt ? `, ${when(r.store.storeAt)}` : ''}</div></div>
            {r.store.last && <StateBadge s={r.store.last.state} />}
          </div>
          <div className="scard-body">
            <div className="muted dd-note" style={{ marginBottom: 10 }}>스토어 업로드는 TestFlight, Play 내부 테스트까지입니다. 출시 버튼은 스토어 콘솔에서 사람이 누릅니다.</div>
            <MiniGrid rows={histRows([...r.store.running, ...r.store.history])} cols={histCols.filter((x) => x.field !== 'version')} rowId={(x) => x.id} rowHeight={38} />
          </div>
        </div>
      )}
    </div>
  );
}

export function Deploy({ deployer, admin = false, onOpenDocs, onOpenFlow }: { deployer: boolean; admin?: boolean; onOpenDocs: (k: string) => void; onOpenFlow: (k: string) => void }) {
  const { catalog } = useCatalog();
  const [d, setD] = useState<DeployOverview | null>(null);
  const [store, setStore] = useState<StoreAppView[]>([]);
  const [apks, setApks] = useState<ApkRepo[]>([]);
  const [kind, setKind] = useState<'all' | 'backend' | 'web' | 'device-app' | 'store-app'>('all');
  const [health, setHealth] = useState<ServiceStatus[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [q, setQ] = useState('');
  const grid = useRef<AgGridReact<Row>>(null);

  const load = useCallback((refresh = false) => {
    setErr('');
    const p = api.deploy(refresh).then(setD).catch((e) => { setErr(String(e?.message || e)); throw e; });
    api.storeApps(refresh).then((r) => setStore(r.apps)).catch(() => {});
    api.apks(refresh).then((r) => setApks(r.apps)).catch(() => {});
    api.status().then((r) => setHealth(r.services)).catch(() => {});
    api.deployAudit().then((r) => setAudit(r.entries)).catch(() => {});
    return p;
  }, []);
  const poll = usePoll(load, 30000);
  // 개요에서 서비스를 누르면 그 서비스 상세를 연다
  useEffect(() => { const f = (e: Event) => { setTab('now'); setOpen((e as CustomEvent).detail); }; window.addEventListener('mxc:open-comp', f); return () => window.removeEventListener('mxc:open-comp', f); }, []);

  const rows: Row[] = useMemo(() => {
    if (!catalog) return [];
    return catalog.components
      .filter((c) => c.deployable.testbed || c.deployable.prod || c.kind === 'store-app' || c.kind === 'device-app' || c.testbed || c.prod)
      .map((c) => {
        const tracks = d?.services.find((s) => s.key === c.key)?.tracks ?? {};
        const st = store.find((s) => s.key === c.key);
        return { c, path: projectPath(catalog.roots, c.project).join(' › '), tracks, health: health.find((h) => h.key === c.key), store: st, last: lastOf(tracks), lastStore: st?.lastStore ?? null, apk: apks.find((a) => a.key === c.key) };
      });
  }, [catalog, d, store, health, apks]);
  const shown = rows.filter((r) => kind === 'all' || r.c.kind === kind);
  const count = (k: string) => rows.filter((r) => k === 'all' || r.c.kind === k).length;

  const cols: ColDef<Row>[] = useMemo(() => [
    { headerName: '서비스', pinned: 'left', minWidth: 230, flex: 1.3, valueGetter: (p) => p.data?.c.name,
      cellRenderer: (p: ICellRendererParams<Row>) => p.data && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, height: '100%' }}>
          <Logo file={p.data.c.logo} name={p.data.c.name} size={24} />
          <div style={{ lineHeight: 1.3 }}>
            <div style={{ fontWeight: 600 }}>{p.data.c.name}</div>
            <a className="muted mono" style={{ fontSize: 11 }} href={`${ghRepo(p.data.c.repo)}/actions`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{p.data.c.repo}</a>
          </div>
        </div>
      ) },
    { headerName: '프로젝트', field: 'path', minWidth: 170, flex: 1 },
    { headerName: '종류', minWidth: 100, width: 110, valueGetter: (p) => p.data && KIND_LABEL[p.data.c.kind] },
    { headerName: '운영', minWidth: 230, flex: 1.2, valueGetter: (p) => p.data?.tracks.prod?.current?.version ?? p.data?.store?.storeVersion ?? '',
      cellRenderer: (p: ICellRendererParams<Row>) => p.data && (p.data.c.kind === 'store-app' ? <StoreCell s={p.data.store} /> : p.data.c.kind === 'device-app' ? <ApkCell a={p.data.apk} /> : <TrackCell t={p.data.tracks.prod} h={p.data.health?.prod} />) },
    { headerName: '테스트배드', minWidth: 210, flex: 1.1, valueGetter: (p) => p.data?.tracks.testbed?.current?.version ?? '',
      cellRenderer: (p: ICellRendererParams<Row>) => p.data && (p.data.c.kind === 'store-app' || p.data.c.kind === 'device-app' ? <span className="muted"></span> : <TrackCell t={p.data.tracks.testbed} h={p.data.health?.testbed} />) },
    { headerName: '마지막 배포', minWidth: 160, flex: 0.9, sort: 'desc',
      valueGetter: (p) => (p.data?.c.kind === 'store-app' ? p.data?.store?.last?.at : p.data?.c.kind === 'device-app' ? p.data?.apk?.releases[0]?.date : p.data?.last?.at) ?? '',
      cellRenderer: (p: ICellRendererParams<Row>) => p.data && <LastCell r={p.data} /> },
    { headerName: '', width: 76, sortable: false, filter: false, resizable: false, pinned: 'right',
      cellRenderer: () => <button className="btn ghost" style={{ padding: '2px 9px' }}>상세</button> },
  ], []);

  const sel = rows.find((r) => r.c.key === open);
  const [tab, setTab] = useHashTab(['now', 'history', 'promote'], 'now');

  return (
    <div>
      <div className="topbar">
        <div>
          <h1><RocketIcon size={22} />배포</h1>
          <div className="sub">서비스별 지금 버전, 배포 이력, 운영 반영 예약</div>
        </div>
      </div>
      <Tabs tabs={[['now', '현황'], ['history', '이력'], ['promote', '운영 반영(예약)']]} value={tab} onChange={setTab} />
      <TabPanel k={tab}>
      {tab === 'history' && <DeployHistory />}
      {tab === 'promote' && <Promote deployer={deployer} />}
      {tab === 'now' && <>
      <Toolbar right={<>
        <button className="btn ghost" onClick={() => grid.current?.api.exportDataAsCsv({ fileName: `배포-${new Date().toISOString().slice(0, 10)}.csv` })}>CSV</button>
        <RefreshBar poll={poll} />
      </>}>
        <div className="seg">
          {([['all', '전체', Layers], ['backend', '서버', ServerIcon], ['web', '웹', Globe], ['device-app', '기기앱', Smartphone], ['store-app', '부모앱', Store]] as const).map(([k, l, I]) => (
            <button key={k} className={'segbtn' + (kind === k ? ' on' : '')} onClick={() => setKind(k)}><I size={14} />{l} <span className="muted">{count(k)}</span></button>
          ))}
        </div>
        <input placeholder="검색" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 200 }} />
      </Toolbar>
      {err && <div className="panel err">{err}</div>}
      {msg && <div className="panel" style={{ marginBottom: 14, borderColor: 'var(--green)' }}>{msg}</div>}
      {d && d.failures.length > 0 && (
        <div className="fail-strip">
          <div className="fail-head"><AlertTriangle size={16} />해결 안 된 배포 실패 {d.failures.length}건</div>
          {d.failures.slice(0, 4).map((f) => (
            <div key={f.url} className="fail-row">
              {catalog?.components.find((c) => c.key === f.key) && <Logo file={catalog.components.find((c) => c.key === f.key)!.logo} name={f.service} size={18} />}
              <b>{catalog?.components.find((c) => c.key === f.key)?.name ?? f.service}</b>
              <span className={'envchip ' + f.env}>{ENV_LABEL[f.env as Env]}</span>
              <span className="muted">{when(f.at)}, {lasting(f.at)}</span>
              <a className="btn ghost sm" style={{ marginLeft: 'auto' }} href={f.url} target="_blank" rel="noreferrer">#{f.number} 로그</a>
            </div>
          ))}
        </div>
      )}
      <div style={{ height: 80 + Math.max(rows.length, 1) * 54, maxHeight: 760, marginBottom: 14 }}>
        <AgGridReact<Row>
          ref={grid} theme={gridTheme} localeText={localeKo} rowData={shown} columnDefs={cols} defaultColDef={defaultColDef}
          rowHeight={54} quickFilterText={q} getRowId={(p) => p.data.c.key} loading={!catalog || (!d && !err)}
          onRowClicked={(e) => { if (!(e.event?.target as HTMLElement)?.closest('a')) setOpen(e.data!.c.key); }}
          rowStyle={{ cursor: 'pointer' }} suppressCellFocus
        />
      </div>

      {d && (
        <>
          <Section icon={ClipboardList} title="콘솔에서 바꾼 기록">
            {audit.length === 0 ? <div className="muted">없음</div> : audit.slice(0, 20).map((a) => (
              <div key={a.at + a.target} className="kv">
                <span className="k" style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>{when(a.at)} <User login={a.login} size={16} /> {a.action} · {a.target}</span>
                <span className={'v ' + (a.ok ? '' : 'red')}>{a.detail}{a.url && <>, <a href={a.url} target="_blank" rel="noreferrer">실행</a></>}</span>
              </div>
            ))}
          </Section>
        </>
      )}
      </>}
      </TabPanel>
      {sel && (
        <Drawer width={720} onClose={() => setOpen(null)}>
          <Detail r={sel} canRollback={!!d?.canRollback} deployer={deployer} admin={admin} onOpenDocs={onOpenDocs} onOpenFlow={onOpenFlow}
            onDone={(m) => { setOpen(null); setMsg(m); setTimeout(() => load(true), 3000); }} />
        </Drawer>
      )}
    </div>
  );
}
