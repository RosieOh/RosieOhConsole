import { LogBox } from './LogBox';
import { User, Users } from '../users';
import { useMemo, useRef, useState } from 'react';
import { RefreshBar, usePoll } from '../poll';
import { ClipboardList } from 'lucide-react';
import { Section } from './Section';
import { hashParam } from './Tabs';
import { useEffect } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, ICellRendererParams } from 'ag-grid-community';
import { AuditEntry, HistoryRow, flowApi, promoteApi } from '../api';
import { useCatalog } from '../catalog';
import { defaultColDef, gridTheme, localeKo, when } from '../grid';
import { Drawer } from './Drawer';
import { Logo } from './Logo';

// 배포 이력 — 모든 서비스·환경을 한 표로. 실패한 줄은 "실패 단계 로그"로 그 단계 로그만 바로 본다
const ENV: Record<string, string> = { testbed: '테스트배드', prod: '운영', release: '부모앱 릴리스', apk: '기기앱 APK' };
const STATE: Record<string, [string, string]> = { success: ['성공', 'green'], failure: ['실패', 'red'], cancelled: ['취소', 'muted'], running: ['실행 중', 'amber'], skipped: ['건너뜀', 'muted'] };
const fmtSec = (s: number | null) => (s == null ? '' : s < 60 ? `${s}초` : `${Math.floor(s / 60)}분 ${s % 60}초`);

export function DeployHistory() {
  const { catalog, comp } = useCatalog();
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [env, setEnv] = useState('');
  const [log, setLog] = useState<{ row: HistoryRow; data?: { step: string | null; log: string }; err?: string } | null>(null);
  const grid = useRef<AgGridReact<HistoryRow>>(null);
  const poll = usePoll(() => promoteApi.history().then((r) => { setRows(r.rows); setAudit(r.audit); }).catch((e) => { setErr(String(e?.message || e)); throw e; }), 60000);

  const proj = (key: string) => {
    const c = comp(key);
    if (!c || !catalog) return '';
    let name = '';
    const walk = (l: typeof catalog.roots, path: string[]) => { for (const n of l) { if (n.id === c.project) name = [...path, n.name].join(' › '); walk(n.children, [...path, n.name]); } };
    walk(catalog.roots, []);
    return name;
  };
  const shown = (rows ?? []).filter((r) => !env || r.env === env);
  // 다른 화면에서 "이 실행"으로 넘어왔으면 그 줄로 스크롤하고 깜박여 표시, 실패면 로그도 연다
  const [focusRun] = useState(() => Number(hashParam('run')) || null);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focusRun || focused || !rows || !grid.current?.api) return;
    const row = rows.find((r) => r.runId === focusRun);
    if (!row) return;
    setFocused(true);
    setTimeout(() => {
      const node = grid.current!.api.getRowNode(row.id);
      if (!node) return;
      grid.current!.api.ensureNodeVisible(node, 'middle');
      node.setSelected(true);
      grid.current!.api.flashCells({ rowNodes: [node], flashDuration: 1600, fadeDuration: 800 });
      if (row.state === 'failure') openLog(row);
    }, 300);
  }, [rows, focusRun, focused]);   // eslint-disable-line
  const openLog = (row: HistoryRow) => {
    setLog({ row });
    flowApi.stepLog(row.repo, row.runId!).then((d) => setLog({ row, data: d })).catch((e) => setLog({ row, err: String(e?.message || e) }));
  };

  const cols: ColDef<HistoryRow>[] = useMemo(() => [
    { headerName: '시각', field: 'at', width: 140, sort: 'desc', valueFormatter: (p) => when(p.value) },
    { headerName: '서비스', minWidth: 190, flex: 1, valueGetter: (p) => comp(p.data!.comp)?.name ?? p.data!.comp,
      cellRenderer: (p: ICellRendererParams<HistoryRow>) => { const c = comp(p.data!.comp); return <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><Logo file={c?.logo} name={c?.name ?? p.data!.comp} size={18} />{c?.name ?? p.data!.comp}</span>; } },
    { headerName: '프로젝트', minWidth: 160, flex: 0.9, valueGetter: (p) => proj(p.data!.comp) },
    { headerName: '환경', width: 120, valueGetter: (p) => ENV[p.data!.env] },
    { headerName: '동작', width: 110, field: 'kind' },
    { headerName: '버전', width: 130, field: 'version', cellClass: 'mono' },
    { headerName: '결과', width: 150, valueGetter: (p) => STATE[p.data!.state]?.[0] ?? p.data!.state,
      cellRenderer: (p: ICellRendererParams<HistoryRow>) => { const [t, c] = STATE[p.data!.state] ?? [p.data!.state, 'muted']; return <span style={{ display: 'inline-flex', gap: 4 }}><span className={'chip ' + c}>{t}{p.data!.warn ? ' ⚠' : ''}</span>{p.data!.resolved && <span className="chip green" title={`${when(p.data!.resolved)} 성공`}>해결됨</span>}</span>; } },
    { headerName: '누가', width: 140, field: 'actor', cellRenderer: (p: ICellRendererParams<HistoryRow>) => <User login={p.data!.actor} /> },
    { headerName: '걸린 시간', width: 110, valueGetter: (p) => p.data!.sec, valueFormatter: (p) => fmtSec(p.value) },
    { headerName: '로그', width: 170, sortable: false, filter: false,
      cellRenderer: (p: ICellRendererParams<HistoryRow>) => (
        <span style={{ display: 'inline-flex', gap: 6 }}>
          <a href={p.data!.url} target="_blank" rel="noreferrer">{p.data!.number ? `#${p.data!.number}` : '열기'} ↗</a>
          {p.data!.state === 'failure' && p.data!.runId && <button className="linklike red" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }} onClick={() => openLog(p.data!)}>실패 단계 로그</button>}
        </span>
      ) },
  ], [catalog]);   // eslint-disable-line

  const fails7 = (rows ?? []).filter((r) => r.state === 'failure' && Date.now() - Date.parse(r.at) < 7 * 86400_000).length;
  const open = (rows ?? []).filter((r) => r.state === 'failure' && (r.env === 'testbed' || r.env === 'prod') && !r.resolved).length;
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <div className="seg">
          {[['', '전체'], ['prod', '운영'], ['testbed', '테스트배드'], ['release', '부모앱'], ['apk', 'APK']].map(([k, l]) => (
            <button key={k} className={'segbtn' + (env === k ? ' on' : '')} onClick={() => setEnv(k)}>{l}</button>
          ))}
        </div>
        <input placeholder="검색" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 220 }} />
        <button className="btn ghost" onClick={() => grid.current?.api.exportDataAsCsv({ fileName: `배포이력-${new Date().toISOString().slice(0, 10)}.csv` })}>CSV</button>
        <span className="muted" style={{ fontSize: 12 }}>{rows ? `${rows.length}건, 최근 7일 실패 ${fails7}건 (해결 안 됨 ${open}건)` : ''}</span>
        <span style={{ marginLeft: 'auto' }}><RefreshBar poll={poll} /></span>
      </div>
      {err && <div className="panel err">{err}</div>}
      <div style={{ height: 600 }}>
        <AgGridReact<HistoryRow> ref={grid} theme={gridTheme} localeText={localeKo} rowData={shown} columnDefs={cols} defaultColDef={defaultColDef}
          rowHeight={40} quickFilterText={q} rowClassRules={{ 'row-bad': (p) => p.data?.state === 'failure' }} getRowId={(p) => p.data.id} rowSelection={{ mode: 'singleRow', checkboxes: false, enableClickSelection: true }} loading={!rows && !err} pagination paginationPageSize={50} paginationPageSizeSelector={[50, 100, 200]} suppressCellFocus />
      </div>
      <div style={{ marginTop: 14 }} />
      <Section icon={ClipboardList} title="콘솔에서 한 일(되돌리기, 운영 반영)">
        {audit.length === 0 ? <div className="muted">없음</div> : audit.slice(0, 40).map((a) => (
          <div key={a.at + a.target + a.action} className="kv">
            <span className="k" style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>{when(a.at)} <User login={a.login} /> {a.action} · {a.target}</span>
            <span className={'v ' + (a.ok ? '' : 'red')}>{a.detail}{a.url && <>, <a href={a.url} target="_blank" rel="noreferrer">실행</a></>}</span>
          </div>
        ))}
      </Section>
      {log && (
        <Drawer onClose={() => setLog(null)}>
          <h2>{comp(log.row.comp)?.name ?? log.row.comp}, #{log.row.number}, {log.data?.step ?? '실패 단계'}</h2>
          <div className="muted" style={{ fontSize: 12, margin: '6px 0 10px' }}>{ENV[log.row.env]}, {log.row.kind}, {when(log.row.at)}, <User login={log.row.actor} size={16} /></div>
          {log.err && <div className="err">{log.err}</div>}
          {!log.data && !log.err && <div className="muted">불러오는 중…</div>}
          {log.data && (log.data.log ? <LogBox text={log.data.log} maxHeight="calc(100vh - 170px)" /> : <div className="muted">로그가 없습니다. GitHub 에서 확인하세요.</div>)}
          <a className="btn ghost" href={log.row.url} target="_blank" rel="noreferrer" style={{ marginTop: 10, display: 'inline-block' }}>GitHub 에서 전체 로그 ↗</a>
        </Drawer>
      )}
    </div>
  );
}
