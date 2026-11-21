import { User, Users } from '../users';
import { useMemo, useState } from 'react';
import { RefreshBar, usePoll } from '../poll';
import { CalendarClock, Clock, GitCommit, ListChecks, Package, ShieldCheck } from 'lucide-react';
import { Section } from './Section';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, ICellRendererParams } from 'ag-grid-community';
import { PromoteItem, Schedule, promoteApi } from '../api';
import { useCatalog } from '../catalog';
import { defaultColDef, gridTheme, localeKo, when } from '../grid';
import { Drawer } from './Drawer';
import { Logo } from './Logo';

// 운영 반영 — 테스트배드에서 지켜본 버전을 정한 시각에 운영으로(관리자·배포 담당)
const ago = (iso?: string | null) => {
  if (!iso) return '';
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 60 ? `${m}분` : m < 1440 ? `${Math.floor(m / 60)}시간 ${m % 60}분` : `${Math.floor(m / 1440)}일 ${Math.floor((m % 1440) / 60)}시간`;
};
const METHOD: Record<string, string> = { 'merge-push': 'main 머지 = 배포', 'merge-dispatch': 'main 머지 → kamal-prod 배포' };
const SSTATE: Record<string, [string, string]> = { scheduled: ['예약됨', 'amber'], running: ['실행 중', 'amber'], done: ['완료', 'green'], failed: ['실패', 'red'], cancelled: ['취소', 'muted'] };
const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

export function Promote({ deployer }: { deployer: boolean }) {
  const { comp } = useCatalog();
  const [d, setD] = useState<{ items: PromoteItem[]; schedules: Schedule[]; canRun: boolean } | null>(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState<PromoteItem | null>(null);
  const [showLog, setShowLog] = useState<Schedule | null>(null);
  const load = () => promoteApi.candidates().then(setD).catch((e) => setErr(String(e?.message || e)));
  const poll = usePoll(load, 20000);

  const cols: ColDef<PromoteItem>[] = useMemo(() => [
    { headerName: '서비스', minWidth: 200, flex: 1.1, valueGetter: (p) => p.data!.name, pinned: 'left',
      cellRenderer: (p: ICellRendererParams<PromoteItem>) => <span style={{ display: 'inline-flex', gap: 7, alignItems: 'center' }}><Logo file={comp(p.data!.key)?.logo} name={p.data!.name} size={20} /><b>{p.data!.name}</b></span> },
    { headerName: '올릴 버전', minWidth: 200, flex: 1, valueGetter: (p) => p.data!.version,
      cellRenderer: (p: ICellRendererParams<PromoteItem>) => {
        const it = p.data!;
        if (it.error) return <span className="red">{it.error}</span>;
        const h = it.testbedHealth;
        return (
          <div style={{ lineHeight: 1.3, paddingTop: 6 }}>
            <span className="mono" style={{ fontWeight: 600 }}>{it.version ?? ''}</span> <span className="muted" style={{ fontSize: 11 }}>{it.plan.source === 'testbed' ? '테스트배드' : 'dev 끝'}</span>
            <div style={{ fontSize: 11 }}>
              {it.plan.source === 'testbed' && it.testbedAt && <span className="muted">올라간 지 {ago(it.testbedAt)}</span>}
              {h && h.up !== null && <span className={h.up ? 'green' : 'red'}>, {h.up ? `정상 ${ago(h.since)}째` : `DOWN ${ago(h.since)}째`}{h.downs24h ? `, 24시간 DOWN ${h.downs24h}번` : ''}</span>}
            </div>
          </div>
        );
      } },
    { headerName: '운영 지금', minWidth: 150, flex: 0.8, valueGetter: (p) => p.data!.prodVersion ?? p.data!.mainSha,
      cellRenderer: (p: ICellRendererParams<PromoteItem>) => (
        <div style={{ lineHeight: 1.3, paddingTop: 6 }}>
          <span className="mono">{p.data!.plan.lane === 'prod' ? (p.data!.prodVersion ?? '') : `main ${p.data!.mainSha ?? ''}`}</span>
          {p.data!.prodRunning && <span className="chip amber" style={{ marginLeft: 6 }}>실행 중</span>}
          <div className="muted" style={{ fontSize: 11 }}>{p.data!.prodAt ? when(p.data!.prodAt) : ''}</div>
        </div>
      ) },
    { headerName: '들어갈 변경', minWidth: 120, width: 130, valueGetter: (p) => p.data!.aheadCount ?? 0,
      cellRenderer: (p: ICellRendererParams<PromoteItem>) => (p.data!.aheadCount ? <span>{p.data!.aheadCount}개{p.data!.mainOnly ? <span className="amber" title="main 에만 있는 커밋도 함께 나갑니다"> +main {p.data!.mainOnly}</span> : null}</span> : <span className="muted">없음(같음)</span>) },
    { headerName: '방식', minWidth: 170, flex: 0.8, valueGetter: (p) => METHOD[p.data!.plan.method] },
    { headerName: '', width: 150, sortable: false, filter: false, pinned: 'right',
      cellRenderer: (p: ICellRendererParams<PromoteItem>) => {
        const it = p.data!;
        const busy = d?.schedules.some((s) => s.comp === it.key && (s.state === 'scheduled' || s.state === 'running'));
        return <button className="btn primary" style={{ padding: '3px 10px' }} disabled={!deployer || !d?.canRun || !it.aheadCount || !!busy || !!it.error} title={!deployer ? '관리자, 배포 담당만' : busy ? '이미 예약이 있습니다' : !it.aheadCount ? '올릴 변경이 없습니다' : ''} onClick={() => setOpen(it)}>운영 반영 예약</button>;
      } },
  ], [d]);   // eslint-disable-line

  return (
    <div>
      <div className="toolbar"><div className="toolbar-l muted" style={{ fontSize: 12.5 }}>예약 시각에 다시 확인한 뒤 운영에 반영합니다. 조건이 맞지 않으면 진행하지 않습니다.</div><div className="toolbar-r"><RefreshBar poll={poll} /></div></div>
      {err && <div className="panel err">{err}</div>}
      {d && !d.canRun && <div className="panel amber" style={{ marginBottom: 12 }}>예약을 실행할 수 없습니다(콘솔 설정 필요).</div>}
      <div style={{ height: Math.min(80 + (d?.items.length ?? 6) * 52, 720) }}>
        <AgGridReact<PromoteItem> theme={gridTheme} localeText={localeKo} rowData={d?.items ?? []} columnDefs={cols} defaultColDef={defaultColDef} rowHeight={52}
          getRowId={(p) => p.data.key} loading={!d && !err} suppressCellFocus />
      </div>

      <div style={{ marginTop: 14 }} />
      <Section icon={CalendarClock} title="예약">
        {(d?.schedules ?? []).length === 0 && <div className="muted">없음</div>}
        {(d?.schedules ?? []).map((s) => {
          const [t, c] = SSTATE[s.state];
          const c0 = comp(s.comp);
          return (
            <div key={s.id} className="kv" style={{ alignItems: 'center' }}>
              <span className="k" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Logo file={c0?.logo} name={c0?.name ?? s.comp} size={16} />{c0?.name ?? s.comp}, <span className="mono">{s.version}</span>, {when(s.at)} <User login={s.by} size={16} />
              </span>
              <span className="v" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span className={'chip ' + c}>{t}</span>
                <span className="muted" style={{ fontSize: 11, maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.result ?? s.log[s.log.length - 1]?.msg}</span>
                {s.pr && <a href={s.pr.url} target="_blank" rel="noreferrer">PR #{s.pr.number}</a>}
                {s.run && <a href={s.run.url} target="_blank" rel="noreferrer">실행</a>}
                <button className="btn ghost" style={{ padding: '2px 8px' }} onClick={() => setShowLog(s)}>기록</button>
                {s.state === 'scheduled' && deployer && <button className="btn ghost" style={{ padding: '2px 8px', color: 'var(--red)' }} onClick={async () => { try { await promoteApi.cancel(s.id); } catch (e: any) { setErr(String(e?.message || e)); } await load(); }}>취소</button>}
              </span>
            </div>
          );
        })}
      </Section>

      {open && <Drawer onClose={() => setOpen(null)}><ScheduleForm it={open} onDone={async () => { setOpen(null); await load(); }} /></Drawer>}
      {showLog && (
        <Drawer onClose={() => setShowLog(null)}>
          <h2>{comp(showLog.comp)?.name ?? showLog.comp}, {showLog.version}</h2>
          <div className="muted" style={{ fontSize: 12, margin: '6px 0 12px' }}>{METHOD[showLog.plan.method]}, 예약 {when(showLog.at)}, <User login={showLog.by} size={16} /></div>
          {showLog.log.map((l, i) => <div key={i} className="kv"><span className="k">{when(l.at)}</span><span className={'v ' + (l.ok === false ? 'red' : l.ok ? 'green' : '')} style={{ fontFamily: 'var(--sans)' }}>{l.msg}</span></div>)}
        </Drawer>
      )}
    </div>
  );
}

function ScheduleForm({ it, onDone }: { it: PromoteItem; onDone: () => void }) {
  const { comp } = useCatalog();
  const [at, setAt] = useState(localInput(new Date(Date.now() + 5 * 60000)));
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const quick = (label: string, d: Date) => <button key={label} className="btn ghost" style={{ padding: '2px 8px' }} onClick={() => setAt(localInput(d))}>{label}</button>;
  const today = (h: number) => { const d = new Date(); d.setHours(h, 0, 0, 0); if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1); return d; };
  async function go() {
    setBusy(true); setErr('');
    try { await promoteApi.schedule({ comp: it.key, version: it.version!, at: new Date(at).toISOString(), confirm }); onDone(); }
    catch (e: any) { setErr(String(e?.message || e)); } finally { setBusy(false); }
  }
  const steps = it.plan.method === 'merge-dispatch'
    ? ['다시 검사', `릴리스 PR(${it.version} → main)`, 'mx/issue-link 확인 뒤 머지', 'kamal-prod deploy 실행', '실행 지켜보기, 운영 버전, 헬스 확인']
    : ['다시 검사', `릴리스 PR(${it.version} → main)`, 'mx/issue-link 확인 뒤 머지 = 배포 시작', `${it.plan.watch} 지켜보기`, it.plan.lane === 'prod' ? '운영 버전, 헬스 확인' : '릴리스 결과 확인'];
  return (
    <div>
      <h2><Logo file={comp(it.key)?.logo} name={it.name} size={28} />{it.name} 운영 반영 예약</h2>
      <div className="sec">
        <h3><Package size={14} />올릴 것</h3>
        <div className="kv"><span className="k">버전</span><span className="v">{it.version} ({it.plan.source === 'testbed' ? '테스트배드에 떠 있는 것' : 'dev 끝'})</span></div>
        <div className="kv"><span className="k">운영 지금</span><span className="v">{it.prodVersion ?? `main ${it.mainSha}`}</span></div>
        {!!it.mainOnly && <div className="amber" style={{ fontSize: 12, marginTop: 6 }}>⚠ main 에만 있는 커밋 {it.mainOnly}개도 함께 나갑니다(운영 핫픽스 등).</div>}
      </div>
      <div className="sec">
        <h3><GitCommit size={14} />들어갈 변경 {it.aheadCount}개</h3>
        <div style={{ maxHeight: 220, overflow: 'auto' }}>
          {it.ahead?.map((c) => <div key={c.sha} className="kv"><span className="k mono" style={{ fontSize: 11 }}>{c.sha}</span><span className="v" style={{ fontFamily: 'var(--sans)', fontSize: 12 }}>{c.message}<span className="muted">, {c.author}</span></span></div>)}
        </div>
      </div>
      <div className="sec">
        <h3><ListChecks size={14} />순서</h3>
        <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.7 }}>{steps.map((s) => <li key={s}>{s}</li>)}</ol>
      </div>
      <div className="sec">
        <h3><Clock size={14} />언제</h3>
        <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} style={{ width: 240 }} />
        <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
          {quick('지금', new Date(Date.now() + 30000))}{quick('10분 뒤', new Date(Date.now() + 600000))}{quick('오늘, 다음 18:00', today(18))}{quick('내일 10:00', (() => { const d = today(10); if (d.getDate() === new Date().getDate()) d.setDate(d.getDate() + 1); return d; })())}
        </div>
      </div>
      <div className="sec">
        <h3><ShieldCheck size={14} />확인</h3>
        <input placeholder={`"${it.plan.confirm}" 를 그대로 입력`} value={confirm} onChange={(e) => setConfirm(e.target.value)} style={{ width: 280 }} />
      </div>
      {err && <div className="err">{err}</div>}
      <button className="btn primary" style={{ marginTop: 14 }} disabled={busy || confirm !== it.plan.confirm || !at} onClick={go}>{busy ? '예약 중…' : `${new Date(at).toLocaleString('ko-KR')} 에 운영 반영`}</button>
    </div>
  );
}
