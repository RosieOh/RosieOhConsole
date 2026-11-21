import { LogBox } from './LogBox';
import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion';
import { Activity, AlertTriangle, CalendarClock, CheckCircle2, ChevronDown, ChevronRight, Cpu, FolderKanban, History, Rocket, Server, Smartphone, XCircle } from 'lucide-react';
import { User } from '../users';
import { StatusBadge } from './Apks';
import { MiniGrid } from './MiniGrid';
import { Modal } from './Modal';
import type { ColDef, ICellRendererParams } from 'ag-grid-community';
import {
  api, ActiveRun, ApkRepo, CatalogComponent, CatalogNode, DeployOverview, EnvStatus, KIND_LABEL, RunnerAlert, Schedule, ServerView, ServiceStatus, StoreAppView,
  flowApi, promoteApi, serversApi,
} from '../api';
import { useCatalog } from '../catalog';
import { lasting, when } from '../grid';
import { Poll, RefreshBar, usePoll } from '../poll';
import { Logo } from './Logo';
import { byCatalog } from './Servers';

// 개요 — 위젯 대시보드. 핵심 숫자 · 주의 필요/배포 중 · 서버/최근 배포/APK · 프로젝트별 상태 표. 여백은 최소로
type Go = (page: string) => void;
const ENVS = [['testbed', '테스트배드'], ['prod', '운영']] as const;
const envState = (s?: EnvStatus) => (!s ? 'none' : !s.checked_at ? 'unknown' : s.up ? 'up' : 'down');

interface Data {
  health: Record<string, ServiceStatus>; deploy: DeployOverview | null; store: StoreAppView[]; apks: ApkRepo[];
  runs: ActiveRun[]; servers: ServerView[]; runnerAlerts: RunnerAlert[]; schedules: Schedule[]; updated: string; failed: boolean;
}

function useData(): { d: Data; poll: Poll } {
  const [d, setD] = useState<Data>({ health: {}, deploy: null, store: [], apks: [], runs: [], servers: [], runnerAlerts: [], schedules: [], updated: '', failed: false });
  const set = (p: Partial<Data>) => setD((x) => ({ ...x, ...p }));
  const slow = (force = false) => {
    api.deploy(force).then((r) => set({ deploy: r })).catch(() => {});
    api.storeApps(force).then((r) => set({ store: r.apps })).catch(() => {});
    api.apks(force).then((r) => set({ apks: r.apps })).catch(() => {});
    serversApi.list().then((r) => set({ servers: r.servers })).catch(() => {});
    api.runnerAlerts().then((r) => set({ runnerAlerts: r.alerts })).catch(() => {});
    promoteApi.candidates().then((r) => set({ schedules: r.schedules })).catch(() => {});
  };
  // 상태·진행 중 배포는 10초, 나머지는 1분. 새로고침을 누르면 둘 다
  const poll = usePoll((force) => {
    if (force) slow(true);
    return Promise.all([
      api.status().then((r) => set({ health: Object.fromEntries(r.services.map((s) => [s.key, s])) })),
      flowApi.live().then((r) => set({ runs: r.runs })).catch(() => {}),
    ]);
  }, 10000);
  useEffect(() => { slow(); const t = setInterval(() => slow(), 60000); return () => clearInterval(t); }, []);   // eslint-disable-line
  return { d, poll };
}

function Widget({ icon: I, title, span = 4, more, onMore, children, tone, flush }: {
  icon: any; title: React.ReactNode; span?: number; more?: string; onMore?: () => void; children: React.ReactNode; tone?: 'bad' | 'warn'; flush?: boolean;
}) {
  return (
    <section className={'wd' + (tone ? ' ' + tone : '')} style={{ gridColumn: `span ${span}` }}>
      <header className="wd-head">
        <span className="wd-icon"><I size={14} /></span><span className="wd-title">{title}</span>
        {onMore && <button className="wd-more" onClick={onMore}>{more ?? '전체 보기'}<ChevronRight size={13} /></button>}
      </header>
      <div className={'wd-body' + (flush ? ' flush' : '')}>{children}</div>
    </section>
  );
}

const rise = { hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 380, damping: 30 } } } as const;
const stagger = { hidden: {}, show: { transition: { staggerChildren: 0.05 } } } as const;

/** 파스텔 숫자 타일(#131) — 레퍼런스의 큰 숫자 칸 */
function Tile({ icon: I, label, value, sub, color, kind, onClick }: { icon: any; label: string; value: React.ReactNode; sub?: React.ReactNode; color: string; kind: string; onClick?: () => void }) {
  return (
    <motion.button variants={rise} whileHover={{ y: -4, scale: 1.015 }} whileTap={{ scale: 0.98 }} className={'tile ' + color + ' k-' + kind} onClick={onClick}>
      <span className="tile-ic"><I size={20} strokeWidth={1.9} /></span>
      <span className="tile-v">{value}</span>
      <span className="tile-l">{label}</span>
      <span className="tile-s">{sub ?? ' '}</span>
    </motion.button>
  );
}

const PctCell = ({ pct }: { pct: number }) => <span className="cell" style={{ width: '100%' }}><span className="mbar wide"><i style={{ width: `${Math.min(100, pct)}%`, background: pct >= 90 ? 'var(--red)' : pct >= 75 ? 'var(--amber)' : 'var(--green)' }} /></span><span style={{ width: 34, textAlign: 'right', fontSize: 12, fontWeight: 600, color: pct >= 75 ? (pct >= 90 ? 'var(--red)' : 'var(--amber)') : 'var(--text-2)' }}>{Math.round(pct)}%</span></span>;
export const EnvChip = ({ env }: { env: string }) => <span className={'envchip ' + env}>{env === 'prod' ? '운영' : env === 'testbed' ? '테스트배드' : env}</span>;
const Dot = ({ s }: { s?: EnvStatus }) => { const st = envState(s); return st === 'none' ? null : <span className={'dot ' + (st === 'up' ? 'up' : st === 'down' ? 'down' : 'unknown')} title={s?.error || ''} />; };
const Bar = ({ pct }: { pct: number }) => <span className="mbar"><i style={{ width: `${Math.min(100, pct)}%`, background: pct >= 90 ? 'var(--red)' : pct >= 75 ? 'var(--amber)' : 'var(--green)' }} /></span>;

function EnvCell({ c, env, d }: { c: CatalogComponent; env: 'testbed' | 'prod'; d: Data }) {
  const h = d.health[c.key]?.[env];
  const cur = d.deploy?.services.find((s) => s.key === c.key)?.tracks[env]?.current;
  if (env === 'prod' && c.kind === 'store-app') { const st = d.store.find((x) => x.key === c.key); return <span className="cell">스토어 <b className="mono">{st?.storeVersion ?? ''}</b></span>; }
  if (env === 'prod' && c.kind === 'device-app') { const a = d.apks.find((x) => x.key === c.key)?.releases[0]; return a ? <span className="cell"><b className="mono">{a.tag}</b><StatusBadge s={a.status} compact /></span> : <span className="muted"></span>; }
  if (!h && !cur) return <span className="muted"></span>;
  return <span className="cell"><Dot s={h} />{cur ? <a className="mono" href={cur.url} target="_blank" rel="noreferrer">{cur.version?.slice(0, 7)}</a> : <span className="muted"></span>}</span>;
}

function ProjectWidget({ n, path, d, onOpen, open }: { n: CatalogNode; path: string; d: Data; onOpen: (k: string) => void; open: boolean }) {
  const envs = n.components.flatMap((c) => ENVS.map(([e]) => envState(d.health[c.key]?.[e]))).filter((x) => x !== 'none');
  const down = envs.includes('down');
  return (
    <section className={'wd' + (down ? ' bad' : '') + (open ? '' : ' folded')} style={{ gridColumn: 'span 4' }}>
      <header className="wd-head">
        <Logo file={n.logo} name={n.name} size={22} />
        <span style={{ minWidth: 0 }}><span className="wd-title">{n.name}</span><span className="wd-eyebrow">{path}</span></span>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          {down ? <span className="chip red"><XCircle size={11} />문제</span> : envs.length ? <span className="chip green">{envs.filter((x) => x === 'up').length}/{envs.length} 정상</span> : null}
        </span>
      </header>
      <div className={'wd-fold' + (open ? ' open' : '')}>
        <div className="wd-fold-in">
      <MiniGrid<CatalogComponent> rows={n.components} rowId={(c) => c.key} onRow={(c) => onOpen(c.key)}
        rowBad={(c) => d.health[c.key]?.testbed?.up === false || d.health[c.key]?.prod?.up === false} cols={[
        { headerName: '서비스', flex: 1.25, minWidth: 128, valueGetter: (p) => p.data?.name, cellRenderer: (p: ICellRendererParams<CatalogComponent>) => {
          const c = p.data!; const run = d.runs.find((r) => r.comps.includes(c.key) && r.state === 'running');
          return <span className="cname"><Logo file={c.logo} name={c.name} size={18} /><span>{c.name}</span>{run && <Activity size={12} color="var(--amber)" />}</span>; } },
        { headerName: '테스트배드', flex: 0.85, minWidth: 92, valueGetter: (p) => d.deploy?.services.find((x) => x.key === p.data?.key)?.tracks.testbed?.current?.version ?? '', cellRenderer: (p: ICellRendererParams<CatalogComponent>) => <EnvCell c={p.data!} env="testbed" d={d} /> },
        { headerName: '운영', flex: 1.45, minWidth: 148, valueGetter: (p) => d.deploy?.services.find((x) => x.key === p.data?.key)?.tracks.prod?.current?.version ?? '', cellRenderer: (p: ICellRendererParams<CatalogComponent>) => <EnvCell c={p.data!} env="prod" d={d} /> },
      ]} />
        </div>
      </div>
    </section>
  );
}

function AttentionModal({ a, d, comp, onClose, go, onOpenComp }: { a: any; d: Data; comp: (k: string) => CatalogComponent | undefined; onClose: () => void; go: (p: string) => void; onOpenComp: (k: string) => void }) {
  const c = a.key ? comp(a.key) : undefined;
  const [log, setLog] = useState<{ step: string | null; log: string } | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (a.kind === 'fail' && c?.repo) flowApi.stepLog(c.repo, a.fail.id).then(setLog).catch((e) => setErr(String(e?.message || e)));
  }, []);   // eslint-disable-line
  const h = a.key ? d.health[a.key]?.[a.env as 'prod' | 'testbed'] : undefined;
  const p: ServerView["probe"] = a.server?.probe ?? null;
  const mem = p?.mem.total ? (1 - p.mem.available / p.mem.total) * 100 : 0;
  return (
    <Modal width={720} onClose={onClose}
      icon={c ? <Logo file={c.logo} name={c.name} size={34} /> : <span className={'wd-icon'} style={{ width: 34, height: 34 }}><Server size={18} /></span>}
      title={a.kind === 'fail' ? `${c?.name ?? a.key} 배포 실패` : a.kind === 'down' ? `${c?.name ?? a.key} 장애` : a.server?.name}
      footer={<>
        {a.kind === 'fail' && <a className="btn ghost" href={a.fail.url} target="_blank" rel="noreferrer">GitHub 실행 ↗</a>}
        {a.kind === 'fail' && <button className="btn" onClick={() => go('flow')}>배포 흐름에서 보기</button>}
        {a.kind === 'fail' && <button className="btn primary" onClick={() => go(a.page)}>배포 이력에서 보기</button>}
        {a.kind === 'down' && h?.link && <a className="btn ghost" href={h.link} target="_blank" rel="noreferrer">주소 열기 ↗</a>}
        {a.kind === 'down' && <button className="btn primary" onClick={() => onOpenComp(a.key)}>배포 상세 보기</button>}
        {a.kind === 'server' && <button className="btn primary" onClick={() => go(a.page)}>서버 상세 보기</button>}
      </>}>
      {a.kind === 'fail' && (
        <>
          <dl className="lv">
            <dt>환경</dt><dd><EnvChip env={a.env} /></dd>
            <dt>실행</dt><dd>#{a.fail.number}, {a.fail.workflow}</dd>
            <dt>시각</dt><dd>{when(a.fail.at)}</dd>
            <dt>누가</dt><dd><User login={a.fail.actor} size={18} /></dd>
            <dt>실패 단계</dt><dd className="red">{log ? (log.step ?? '단계 정보 없음') : '읽는 중…'}</dd>
          </dl>
          {err && <div className="err">{err}</div>}
          {log && (log.log ? <LogBox text={log.log} maxHeight={360} /> : <div className="muted">이 실행에는 잘라 볼 로그가 없습니다. GitHub 에서 확인하세요.</div>)}
        </>
      )}
      {a.kind === 'down' && (
        <dl className="lv">
          <dt>환경</dt><dd><EnvChip env={a.env} /></dd>
          <dt>오류</dt><dd className="red">{h?.error ?? '응답이 정상이 아닙니다'}</dd>
          <dt>응답 시간</dt><dd>{typeof h?.latency_ms === 'number' ? `${h.latency_ms}ms` : ''}</dd>
          <dt>DB, Redis</dt><dd>{[h?.db_status && `DB ${h.db_status}`, h?.redis_status && `Redis ${h.redis_status}`].filter(Boolean).join(', ') || ''}</dd>
          <dt>확인 시각</dt><dd>{when(h?.checked_at)}</dd>
          <dt>주소</dt><dd>{h?.link ? <a href={h.link} target="_blank" rel="noreferrer">{h.link}</a> : ''}</dd>
        </dl>
      )}
      {a.kind === 'server' && (
        <>
          <div className="scard-alert bad" style={{ marginTop: 0, marginBottom: 12 }}>{a.server.alerts.map((x: any) => <div key={x.text}>{x.text}</div>)}</div>
          {p && (
            <div className="metrics">
              <div className="metric"><div className="metric-label">CPU 부하</div><div className="metric-value">{Math.round((p.load[1] / p.cpus) * 100)}%</div><div className="metric-detail">{p.load[1]} / {p.cpus}코어</div></div>
              <div className="metric"><div className="metric-label">메모리</div><div className="metric-value">{Math.round(mem)}%</div></div>
              <div className="metric"><div className="metric-label">디스크</div><div className="metric-value">{Math.max(0, ...p.disks.map((x: { pct: number }) => x.pct))}%</div></div>
            </div>
          )}
          <dl className="lv"><dt>점검</dt><dd>{when(a.server.at)}</dd><dt>서비스</dt><dd>{a.server.services.map((x: any) => comp(x.comp)?.name ?? x.comp).join(', ')}</dd></dl>
        </>
      )}
    </Modal>
  );
}

function projects(roots: CatalogNode[], path: string[] = []): { n: CatalogNode; path: string }[] {
  const out: { n: CatalogNode; path: string }[] = [];
  for (const x of roots) {
    if (x.type === 'project') out.push({ n: x, path: path.join(' › ') });
    else out.push(...projects(x.children, [...path, x.name]));
  }
  return out;
}

export function Overview({ go, onOpenComp }: { go: Go; onOpenComp: (k: string) => void }) {
  // 프로젝트 표를 한 번에 접었다 편다 — 프로젝트가 많으면 개요가 길어진다.
  // 카드마다 따로 접는 게 아니라 일괄. 선택은 기기에 남는다.
  const [projOpen, setProjOpen] = useState(() => {
    try { return localStorage.getItem('mxc.ov.projects') !== '0'; } catch { return true; }
  });
  const toggleProjects = () => setProjOpen((v) => {
    try { localStorage.setItem('mxc.ov.projects', v ? '0' : '1'); } catch { /* 저장 안 돼도 된다 */ }
    return !v;
  });
  const { catalog, error, rank } = useCatalog();
  const { d, poll } = useData();
  const envAll = Object.values(d.health).flatMap((s) => ENVS.map(([e]) => ({ s: s[e], key: s.key, e }))).filter((x) => x.s);
  const down = envAll.filter((x) => x.s!.checked_at && !x.s!.up);
  const running = d.runs.filter((r) => r.state === 'running');
  const fails = d.deploy?.failures ?? [];
  const svAlerts = d.servers.flatMap((s) => s.alerts.filter((a) => !/점검 전|아직 점검/.test(a.text)).map((a) => ({ ...a, server: s.name })));
  const scheduled = d.schedules.filter((s) => s.state === 'scheduled' || s.state === 'running');
  const comp = (k: string) => catalog?.components.find((c) => c.key === k);
  const name = (k: string) => comp(k)?.name ?? k;
  const recentDeploys = useMemo(() => (d.deploy?.services ?? []).flatMap((s) => (['prod', 'testbed'] as const).flatMap((e) => (s.tracks[e]?.history ?? []).map((h) => ({ ...h, key: s.key, env: e }))))
    .sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 7), [d.deploy]);

  const serverCols: ColDef<ServerView>[] = [
    { headerName: '서버', flex: 1.3, minWidth: 110, valueGetter: (p) => p.data?.name, cellRenderer: (p: ICellRendererParams<ServerView>) => { const s = p.data!; return <span className="cname"><span className={'dot ' + (s.alerts.some((a) => a.level === 'bad') ? 'down' : s.probe ? 'up' : 'unknown')} /><span>{s.short ?? s.name}</span></span>; } },
    { headerName: 'CPU', flex: 1, minWidth: 80, valueGetter: (p) => (p.data?.probe ? (p.data.probe.load[1] / p.data.probe.cpus) * 100 : -1), cellRenderer: (p: ICellRendererParams<ServerView>) => (p.value >= 0 ? <PctCell pct={p.value} /> : '') },
    { headerName: '메모리', flex: 1, minWidth: 80, valueGetter: (p) => (p.data?.probe?.mem.total ? (1 - p.data.probe.mem.available / p.data.probe.mem.total) * 100 : -1), cellRenderer: (p: ICellRendererParams<ServerView>) => (p.value >= 0 ? <PctCell pct={p.value} /> : '') },
    { headerName: '디스크', flex: 1, minWidth: 80, valueGetter: (p) => (p.data?.probe ? Math.max(0, ...p.data.probe.disks.map((x) => x.pct)) : -1), cellRenderer: (p: ICellRendererParams<ServerView>) => (p.value >= 0 ? <PctCell pct={p.value} /> : '') },
  ];
  type Att = { tone: 'bad' | 'warn'; text: string; kind: 'down' | 'fail' | 'server' | 'runner'; key?: string; env?: string; fail?: (typeof fails)[number]; server?: ServerView; page: string };
  const attention: Att[] = useMemo(() => [
    ...down.map((x) => ({ tone: 'bad' as const, kind: 'down' as const, key: x.key, env: x.e, text: `${name(x.key)} ${x.e === 'prod' ? '운영' : '테스트배드'} 장애${x.s!.error ? ` (${x.s!.error})` : ''}`, page: 'deploy' })),
    ...d.servers.flatMap((sv) => sv.alerts.filter((a) => a.level === 'bad' && !/점검 전|아직 점검/.test(a.text)).map((a) => ({ tone: 'bad' as const, kind: 'server' as const, server: sv, text: `${sv.name}: ${a.text}`, page: `servers?open=${sv.id}` }))),
    ...d.runnerAlerts.filter((a) => a.level === 'red').map((a) => ({ tone: 'bad' as const, kind: 'runner' as const, text: `러너: ${a.text}`, page: 'runners' })),
    ...fails.slice(0, 5).map((f) => ({ tone: 'warn' as const, kind: 'fail' as const, fail: f, key: f.key, env: f.env, text: `${name(f.key)} ${f.env === 'prod' ? '운영' : '테스트배드'} 배포 실패, ${lasting(f.at)}`, page: `deploy/history?run=${f.id}` })),
    ...d.servers.flatMap((sv) => sv.alerts.filter((a) => a.level === 'warn' && !/점검 전|아직 점검/.test(a.text)).map((a) => ({ tone: 'warn' as const, kind: 'server' as const, server: sv, text: `${sv.name}: ${a.text}`, page: `servers?open=${sv.id}` }))),
  ], [d, catalog]);   // eslint-disable-line
  const [att, setAtt] = useState<Att | null>(null);
  const [desk, setDesk] = useState<'sched' | 'recent' | 'apk'>('recent');
  const apkTone = (st?: string) => (st === 'knox' ? 'lime' : st === 'qa' ? 'yellow' : 'lilac');
  const KIND_TXT: Record<Att['kind'], string> = { down: '장애', server: '서버', runner: '러너', fail: '배포 실패' };

  return (
    <div className="ov2">
      <div className="ov2-main">
        <div className="topbar">
          <div><h1>개요</h1><div className="sub">지금 살펴볼 것을 한곳에</div></div>
          <RefreshBar poll={poll} />
        </div>
        {error && <div className="panel err">{error}</div>}

        <motion.div className="tiles" variants={stagger} initial="hidden" animate="show">
          <Tile kind="pulse" icon={Activity} color={down.length ? 'pink' : 'blue'} label="서비스 상태" value={envAll.length ? <>{envAll.length - down.length}<small>/{envAll.length}</small></> : '…'} sub={down.length ? `${down.length}곳 장애` : '모두 정상'} onClick={() => go('deploy')} />
          <Tile kind="launch" icon={Rocket} color={running.length ? 'lime' : 'dashed'} label="배포 중" value={running.length} sub={running.length ? running.map((r) => name(r.comps[0])).join(', ') : '없음'} onClick={() => go('flow')} />
          <Tile kind={fails.length ? 'fail' : 'ok'} icon={fails.length ? XCircle : CheckCircle2} color={fails.length ? 'pink' : 'lime'} label="해결 안 된 실패" value={fails.length} sub={fails[0] ? name(fails[0].key) : '없음'} onClick={() => go('deploy/history')} />
          <Tile kind="stack" icon={Server} color={svAlerts.length ? 'yellow' : 'mint'} label="서버 경고" value={svAlerts.length} sub={svAlerts[0] ? svAlerts[0].server : `${d.servers.length}대 정상`} onClick={() => go('servers')} />
          <Tile kind="chip" icon={Cpu} color={d.runnerAlerts.length ? 'yellow' : 'lilac'} label="러너" value={d.runnerAlerts.length || '정상'} sub={d.runnerAlerts[0]?.text ?? '모두 켜짐'} onClick={() => go('runners')} />
          <Tile kind="clock" icon={CalendarClock} color={scheduled.length ? 'blue' : 'dashed'} label="운영 반영 예약" value={scheduled.length} sub={scheduled[0] ? `${name(scheduled[0].comp)}, ${when(scheduled[0].at)}` : '없음'} onClick={() => go('deploy/promote')} />
        </motion.div>

        <div className="ov2-sec"><span>주의 필요</span><span className="ov2-count">{attention.length}</span>
          {running.length > 0 && <button className="btn sm" style={{ marginLeft: 'auto' }} onClick={() => go('flow')}><Activity size={13} />배포 {running.length}건 진행 중</button>}
        </div>
        <motion.div className="queue" variants={stagger} initial="hidden" animate="show">
          {attention.length === 0 && (
            <motion.div variants={rise} className="qcard lime ok"><CheckCircle2 size={20} /><div><b>문제 없음</b><div className="muted">장애, 실패, 경고가 하나도 없습니다</div></div></motion.div>
          )}
          {attention.slice(0, 9).map((a, i) => {
            const c = a.key ? comp(a.key) : undefined;
            const tone = a.tone === 'bad' ? 'pink' : 'yellow';
            return (
              <motion.button key={i} variants={rise} whileHover={{ y: -4 }} className={'qcard ' + (i % 3 === 0 ? tone : '')} onClick={() => (a.kind === 'runner' ? go(a.page) : setAtt(a))}>
                <span className={'qcard-kind ' + tone}>{a.tone === 'bad' ? <XCircle size={13} /> : <AlertTriangle size={13} />}</span>
                <span className="qcard-title">{c ? <><Logo file={c.logo} name={c.name} size={18} />{c.name}</> : a.server ? (a.server.short ?? a.server.name) : '러너'}</span>
                <span className="qcard-text">{a.text}</span>
                <span className="qcard-foot">
                  <span className={'qpill ' + tone}>{KIND_TXT[a.kind]}{a.env ? `, ${a.env === 'prod' ? '운영' : '테스트배드'}` : ''}</span>
                  <span className="qgo"><ChevronRight size={15} /></span>
                </span>
              </motion.button>
            );
          })}
        </motion.div>

        {running.length > 0 && (
          <div className="ov2-running">
            {running.slice(0, 4).map((r) => {
              const c = comp(r.comps[0]);
              return (
                <button key={r.repo + r.id} className="runpill" onClick={() => go('flow')}>
                  {c && <Logo file={c.logo} name={c.name} size={18} />}<b>{c?.name ?? r.comps[0]}</b>
                  <span className="muted">{r.lane === 'prod' ? '운영' : r.lane === 'testbed' ? '테스트배드' : r.lane === 'apk' ? 'APK' : r.lane === 'apptest' ? '테스트 빌드' : '부모앱'}</span>
                  <span className="mbar wide"><motion.i initial={{ width: 0 }} animate={{ width: `${Math.round(((r.stage.index + 0.5) / 5) * 100)}%` }} style={{ background: 'var(--text)' }} /></span>
                  <span className="muted" style={{ fontSize: 12 }}>{r.stage.current ?? ''}</span>
                </button>
              );
            })}
          </div>
        )}

        <div className="dash ov2-dash">
          <Widget icon={Server} title="서버 자원" span={12} onMore={() => go('servers')} flush>
            <MiniGrid<ServerView> rows={d.servers.slice().sort(byCatalog(rank, comp))} rowId={(x) => x.id} onRow={(x) => go(`servers?open=${x.id}`)} rowHeight={34} cols={serverCols} />
          </Widget>
          <button className="dash-sec dash-sec-fold" onClick={toggleProjects} aria-expanded={projOpen}>
            <FolderKanban size={18} strokeWidth={2} />프로젝트
            <span className="dash-sec-act">{projOpen ? '모두 접기' : '모두 펴기'}
              <ChevronDown size={15} className="wd-fold-chev" style={{ transform: projOpen ? undefined : 'rotate(-90deg)' }} />
            </span>
          </button>
          {!catalog && [0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ gridColumn: 'span 4', height: 200 }} />)}
          {catalog && projects(catalog.roots).map(({ n, path }) => <ProjectWidget key={n.id} n={n} path={path} d={d} onOpen={onOpenComp} open={projOpen} />)}
        </div>
      </div>

      <aside className="ov2-desk">
        <div className="desk-head"><b>운영 데스크</b><span className="muted">예약 {scheduled.length}, APK {d.apks.length}</span></div>
        <LayoutGroup id="desk">
          <div className="desk-tabs">
            {([['recent', '최근 배포'], ['sched', '예약'], ['apk', 'APK']] as const).map(([k, l]) => (
              <button key={k} className={'desk-tab' + (desk === k ? ' on' : '')} onClick={() => setDesk(k)}>
                {desk === k && <motion.span layoutId="desk-tab-bg" className="desk-tab-bg" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
                <span>{l}</span>
              </button>
            ))}
          </div>
        </LayoutGroup>
        <AnimatePresence mode="wait">
          <motion.div key={desk} className="desk-list" variants={stagger} initial="hidden" animate="show" exit={{ opacity: 0, transition: { duration: 0.1 } }}>
            {desk === 'recent' && recentDeploys.map((h) => {
              const c = comp(h.key); const bad = h.state === 'failure';
              return (
                <motion.button key={`${h.key}:${h.env}:${h.id}`} variants={rise} whileHover={{ y: -3 }} className={'dcard ' + (bad ? 'pink' : h.env === 'prod' ? 'mint' : 'blue')} onClick={() => onOpenComp(h.key)}>
                  <span className="dcard-top"><span className="dcard-ic">{bad ? <XCircle size={13} /> : <CheckCircle2 size={13} />}</span><EnvChip env={h.env} /><span className="dcard-when">{when(h.at)}</span></span>
                  <span className="dcard-title">{c && <Logo file={c.logo} name={c.name} size={18} />}{c?.name ?? h.key}</span>
                  <span className="dcard-foot"><User login={h.actor} size={16} /><span className="mono muted" style={{ marginLeft: 'auto' }}>{String((h as any).version ?? '').slice(0, 7)}</span></span>
                </motion.button>
              );
            })}
            {desk === 'sched' && (scheduled.length ? scheduled.map((x) => {
              const c = comp(x.comp);
              return (
                <motion.button key={x.id} variants={rise} whileHover={{ y: -3 }} className="dcard yellow" onClick={() => go('deploy/promote')}>
                  <span className="dcard-top"><span className="dcard-ic"><CalendarClock size={13} /></span><b style={{ fontSize: 12 }}>운영 반영</b><span className="dcard-when">{when(x.at)}</span></span>
                  <span className="dcard-title">{c && <Logo file={c.logo} name={c.name} size={18} />}{c?.name ?? x.comp}</span>
                  <span className="dcard-foot"><User login={x.by} size={16} /><span className="mono muted" style={{ marginLeft: 'auto' }}>{x.version?.slice(0, 7)}</span></span>
                </motion.button>
              );
            }) : <motion.div variants={rise} className="dcard empty">예약된 운영 반영이 없습니다</motion.div>)}
            {desk === 'apk' && d.apks.map((a) => {
              const r = a.releases[0];
              return (
                <motion.button key={a.key} variants={rise} whileHover={{ y: -3 }} className={'dcard ' + apkTone(r?.status)} onClick={() => go('apks')}>
                  <span className="dcard-top"><span className="dcard-ic"><Smartphone size={13} /></span>{r && <StatusBadge s={r.status} />}<span className="dcard-when mono">{r?.tag ?? ''}</span></span>
                  <span className="dcard-title"><Logo file={a.logo} name={a.name} size={18} />{a.name}</span>
                  {(a.tests?.length ?? 0) > 0 && <span className="dcard-foot muted">테스트용 {a.tests!.length}개</span>}
                </motion.button>
              );
            })}
          </motion.div>
        </AnimatePresence>
      </aside>
      {att && <AttentionModal a={att} d={d} comp={comp} onClose={() => setAtt(null)} go={(p) => { setAtt(null); go(p); }} onOpenComp={(k) => { setAtt(null); onOpenComp(k); }} />}
    </div>
  );
}
