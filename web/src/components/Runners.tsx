import { AlertTriangle as AlertIco, Cpu as CpuIco } from 'lucide-react';
import { ghRepo } from '../github';
import { Cpu as CpuIcon } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { RefreshBar, usePoll } from '../poll';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, ICellRendererParams } from 'ag-grid-community';
import { api, RunnerInfo, RunnersView, RunnerUsage } from '../api';
import { defaultColDef, gridTheme, localeKo, when } from '../grid';
import { Drawer } from './Drawer';
import { Logo } from './Logo';

// 러너 — 어디에 있는 무엇이고, 어느 서비스의 어떤 작업을 받고, 지금 상태가 어떤지
const dur = (sec: number | null) => (sec === null ? '없음' : sec < 60 ? `${sec}초` : sec < 3600 ? `${Math.round(sec / 60)}분` : `${(sec / 3600).toFixed(1)}시간`);
const pct = (r: number) => `${(r * 100).toFixed(r >= 0.995 || r < 0.1 ? 0 : 1)}%`;

function State({ r }: { r: RunnerInfo }) {
  if (r.disabled) return <span className="chip amber">사용 중지</span>;
  if (r.status === 'offline') return <span className="chip red">● 꺼짐</span>;
  if (r.busy || r.stats.active.length) return <span className="chip amber">● 작업 중</span>;
  return <span className="chip green">● 대기</span>;
}

// 사용처 — 서비스(구성요소) 로고들
function Services({ uses, max = 6, wrap = true }: { uses: RunnerUsage[]; max?: number; wrap?: boolean }) {
  const seen = new Map<string, { name: string; logo: string | null }>();
  for (const u of uses) {
    if (u.components.length) for (const c of u.components) seen.set(c.key, c);
    else seen.set('repo:' + u.repo, { name: u.repo, logo: null });
  }
  const list = [...seen.values()];
  if (!list.length) return <span className="muted">쓰는 워크플로 없음</span>;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexWrap: wrap ? 'wrap' : 'nowrap' }} title={list.map((x) => x.name).join(', ')}>
      {list.slice(0, max).map((x) => <Logo key={x.name} file={x.logo} name={x.name} size={18} />)}
      <span className="muted" style={{ fontSize: 11.5, marginLeft: 4 }}>{list.length}개 서비스{list.length > max ? ` (+${list.length - max})` : ''}</span>
    </span>
  );
}

function Detail({ r }: { r: RunnerInfo }) {
  const byRepo = new Map<string, RunnerUsage[]>();
  for (const u of r.uses) byRepo.set(u.repo, [...(byRepo.get(u.repo) || []), u]);
  const s = r.stats;
  return (
    <div>
      <h2>{r.name} <State r={r} /></h2>
      <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>{r.where}, {r.kind}{r.guess && ' (이름, 라벨로 추정)'}</div>
      {r.note && <div style={{ marginTop: 8, fontSize: 12.5 }}>{r.note}</div>}
      {r.alerts.map((a) => <div key={a} className="panel" style={{ marginTop: 10, borderColor: 'var(--red)', color: 'var(--red)' }}>{a}</div>)}
      {r.spof.length > 0 && (
        <div className="panel" style={{ marginTop: 10, borderColor: 'rgba(245,166,35,0.5)' }}>
          <b className="amber">대체 러너 없음</b>, {r.spof.join(', ')}
        </div>
      )}
      <div className="sec">
        <h3>상태</h3>
        <div className="kv"><span className="k">라벨</span><span className="v">{r.labels.join(', ')}</span></div>
        {r.capacity && <div className="kv"><span className="k">동시 작업</span><span className="v">{r.capacity}</span></div>}
        <div className="kv"><span className="k">가동률(관찰 시작 {r.uptime ? when(r.uptime.since) : ''})</span><span className="v">{r.uptime ? pct(r.uptime.ratio) : ''}</span></div>
        <div className="kv"><span className="k">최근 24시간</span><span className="v">{s.count24h}개, 성공 {s.success24h}, 실패 {s.failure24h}, 평균 {dur(s.avgSec24h)}</span></div>
        <div className="kv"><span className="k">마지막 작업</span><span className="v">{s.lastJob ? <a href={s.lastJob.url} target="_blank" rel="noreferrer">{s.lastJob.repo}, {s.lastJob.name} ↗</a> : ''} {s.lastAt && <span className="muted">{when(s.lastAt)}</span>}</span></div>
      </div>
      {s.active.length > 0 && (
        <div className="sec">
          <h3>지금 하는 작업</h3>
          {s.active.map((j) => <div key={j.id} className="kv"><span className="k">{j.repo}, {j.name}</span><span className="v"><span className="muted">{when(j.started)}부터</span> <a href={j.url} target="_blank" rel="noreferrer">로그 ↗</a></span></div>)}
        </div>
      )}
      <div className="sec">
        <h3>받는 작업</h3>
        {!r.uses.length && <div className="muted">이 러너 라벨을 쓰는 워크플로가 없습니다(개인 빌드, 예비).</div>}
        {[...byRepo.entries()].map(([repo, us]) => (
          <div key={repo} style={{ padding: '7px 0', borderTop: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              {us[0].components.map((c) => <span key={c.key} style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}><Logo file={c.logo} name={c.name} size={16} />{c.name}</span>)}
              <a className="muted mono" style={{ fontSize: 11 }} href={`${ghRepo(repo)}/actions`} target="_blank" rel="noreferrer">{repo} ↗</a>
            </div>
            {us.map((u) => (
              <div key={u.file + u.job} className="muted" style={{ fontSize: 11.5, marginTop: 3, paddingLeft: 4 }}>
                {u.workflow} ({u.file}) › {u.job}{u.via && <span>, 공용 템플릿 {u.via}</span>}, 언제: {u.triggers.join(', ') || ''}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function Runners() {
  const [d, setD] = useState<RunnersView | null>(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback((refresh = false) => { setErr(''); return api.runners(refresh).then(setD).catch((e) => { setErr(String(e?.message || e)); throw e; }); }, []);
  const poll = usePoll(load, 30000);

  const cols: ColDef<RunnerInfo>[] = useMemo(() => [
    { headerName: '러너', pinned: 'left', minWidth: 220, flex: 1.1, field: 'name',
      cellRenderer: (p: ICellRendererParams<RunnerInfo>) => p.data && (
        <div style={{ lineHeight: 1.3, paddingTop: 6 }}>
          <div style={{ fontWeight: 600 }}>{p.data.name}</div>
          <div className="muted" style={{ fontSize: 11 }}>{p.data.labels.join(', ')}</div>
        </div>
      ) },
    { headerName: '상태', width: 110, valueGetter: (p) => (p.data?.status === 'offline' ? '꺼짐' : p.data?.busy ? '작업 중' : '대기'),
      cellRenderer: (p: ICellRendererParams<RunnerInfo>) => p.data && <div style={{ display: 'flex', alignItems: 'center', height: '100%' }}><State r={p.data} /></div> },
    { headerName: '어디, 무엇', minWidth: 240, flex: 1.4, valueGetter: (p) => `${p.data?.where} ${p.data?.kind}`,
      cellRenderer: (p: ICellRendererParams<RunnerInfo>) => p.data && (
        <div style={{ lineHeight: 1.3, paddingTop: 6 }}>
          <div>{p.data.kind}{p.data.guess && <span className="muted" title="이름, 라벨로 추정"> (추정)</span>}</div>
          <div className="muted" style={{ fontSize: 11 }}>{p.data.where}</div>
        </div>
      ) },
    { headerName: '쓰는 서비스', minWidth: 300, flex: 1.5, valueGetter: (p) => p.data?.uses.length ?? 0,
      cellRenderer: (p: ICellRendererParams<RunnerInfo>) => p.data && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, height: '100%' }}>
          <Services uses={p.data.uses} max={5} wrap={false} />
          {p.data.spof.length > 0 && <span className="chip amber" style={{ whiteSpace: 'nowrap' }} title={`대신 받을 러너 없음: ${p.data.spof.join(', ')}`}>단일 장애점</span>}
        </div>
      ) },
    { headerName: '24시간', width: 150, valueGetter: (p) => p.data?.stats.count24h ?? 0,
      cellRenderer: (p: ICellRendererParams<RunnerInfo>) => p.data && (
        <div style={{ lineHeight: 1.3, paddingTop: 6 }}>
          <div>{p.data.stats.count24h}개{p.data.stats.failure24h > 0 && <span className="red">, 실패 {p.data.stats.failure24h}</span>}</div>
          <div className="muted" style={{ fontSize: 11 }}>평균 {dur(p.data.stats.avgSec24h)}</div>
        </div>
      ) },
    { headerName: '마지막 작업', width: 150, valueGetter: (p) => p.data?.stats.lastAt ?? '', sort: 'desc',
      cellRenderer: (p: ICellRendererParams<RunnerInfo>) => p.data && (p.data.stats.active[0]
        ? <a className="amber" href={p.data.stats.active[0].url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>실행 중 ↗</a>
        : <span className="muted">{when(p.data.stats.lastAt) || ''}</span>) },
    { headerName: '가동률', width: 100, valueGetter: (p) => p.data?.uptime?.ratio ?? -1,
      cellRenderer: (p: ICellRendererParams<RunnerInfo>) => p.data && (p.data.uptime ? <span className={p.data.uptime.ratio < 0.95 ? 'amber' : ''}>{pct(p.data.uptime.ratio)}</span> : <span className="muted"></span>) },
  ], []);

  const sel = d?.runners.find((r) => r.name === open);
  const live = d?.runners.filter((r) => r.uses.length) ?? [];

  return (
    <div>
      <div className="topbar">
        <div>
          <h1><CpuIcon size={22} />러너</h1>
          <div className="sub">
            {d ? `러너 ${d.runners.length}대, 사용 중 ${live.length}대, 대기 작업 ${d.queue.count}개, 갱신 ${when(d.updatedAt)}` : '\u00a0'}
            {d?.source === 'org' && <span className="amber">, 일부 러너가 빠져 있음</span>}
          </div>
        </div>
        <RefreshBar poll={poll} />
      </div>
      {err && <div className="panel err">{err}</div>}
      {d?.error && <div className="panel amber" style={{ marginBottom: 12 }}>{d.error}</div>}
      {d?.alerts.map((a) => <div key={a.text} className="panel" style={{ marginBottom: 10, borderColor: a.level === 'red' ? 'var(--red)' : 'rgba(245,166,35,0.6)' }}><span className={a.level}>{a.text}</span></div>)}

      {/* 한눈에 — 작업을 받는 러너마다 카드 */}
      <div className="sv-grid" style={{ marginBottom: 14 }}>
        {live.map((r) => {
          const bad = r.status === 'offline';
          return (
            <article key={r.name} className={'scard' + (bad ? ' bad' : r.spof.length ? '' : '')} onClick={() => setOpen(r.name)}>
              <header className="scard-head">
                <span className="scard-icon"><CpuIco size={18} /></span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="scard-title">{r.kind}</div>
                  <div className="scard-sub mono">{r.name}</div>
                </div>
                <State r={r} />
              </header>
              <div className="scard-body">
                <div className="metrics">
                  <div className="metric"><div className="metric-label">24시간 작업</div><div className="metric-value">{r.stats.count24h}</div><div className="metric-detail">평균 {dur(r.stats.avgSec24h)}</div></div>
                  <div className="metric"><div className="metric-label">가동률</div><div className="metric-value">{r.uptime ? pct(r.uptime.ratio) : ''}</div><div className="metric-detail">7일</div></div>
                  <div className="metric"><div className="metric-label">마지막 작업</div><div className="metric-value" style={{ fontSize: 15, marginTop: 6 }}>{when(r.stats.lastAt) || ''}</div></div>
                </div>
                <dl className="lv"><dt>위치</dt><dd>{r.where}</dd><dt>라벨</dt><dd className="mono" style={{ fontWeight: 500 }}>{r.labels.join(', ')}</dd></dl>
                <div className="scard-label">받는 서비스 {r.uses.length}</div>
                <Services uses={r.uses} max={12} />
                {r.spof.length > 0 && <div className="scard-alert warn"><div><AlertIco size={14} />대체 러너 없음: 꺼지면 서비스 {r.spof.length}개 작업이 멈춥니다</div></div>}
              </div>
            </article>
          );
        })}
      </div>

      <div style={{ height: Math.min(80 + (d?.runners.length ?? 4) * 50, 600), marginBottom: 14 }}>
        <AgGridReact<RunnerInfo> theme={gridTheme} localeText={localeKo} rowData={d?.runners ?? []} columnDefs={cols} defaultColDef={defaultColDef}
          rowHeight={50} getRowId={(p) => String(p.data.id)} loading={!d && !err} suppressCellFocus rowStyle={{ cursor: 'pointer' }}
          onRowClicked={(e) => { if (!(e.event?.target as HTMLElement)?.closest('a')) setOpen(e.data!.name); }} />
      </div>

      {d && d.queue.count > 0 && (
        <div className="panel" style={{ marginBottom: 14 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>대기 작업 {d.queue.count}개, 최장 {dur(d.queue.oldestSec)}</div>
          {d.queue.jobs.map((j) => <div key={j.id} className="kv"><span className="k">{j.repo}, {j.name}, 라벨 {j.labels.join(', ')}</span><span className="v"><span className="muted">{when(j.created)}</span> <a href={j.url} target="_blank" rel="noreferrer">↗</a></span></div>)}
        </div>
      )}
      {d && d.orphans.length > 0 && (
        <div className="panel" style={{ marginBottom: 14, borderColor: 'rgba(245,166,35,0.5)' }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>받을 러너가 없는 작업</div>
          {d.orphans.map((o) => <div key={o.repo + o.file + o.job} className="kv"><span className="k">{o.repo}, {o.workflow} › {o.job}</span><span className="v">라벨 {o.labels.join(', ')}</span></div>)}
        </div>
      )}

      {sel && <Drawer onClose={() => setOpen(null)}><Detail r={sel} /></Drawer>}
    </div>
  );
}
