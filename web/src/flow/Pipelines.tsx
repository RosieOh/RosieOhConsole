import { Fragment, useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, Clock, ExternalLink, GitCommitHorizontal, Globe, Hammer, Loader2, Minus, Rocket, X } from 'lucide-react';
import { EnvStatus, PipeStage, Pipeline, StageState, api, flowApi } from '../api';
import { RefreshBar, usePoll } from '../poll';
import { Logo } from '../components/Logo';

// 배포 흐름 — 배포되는 서비스마다 한 줄: 커밋 → 빌드 → 배포 → 사이트. 도는 배포는 위로 올라와 단계마다 움직인다
const PROVIDER: Record<Pipeline['provider'], string> = { pages: 'GitHub Pages', vercel: 'Vercel', actions: 'GitHub Actions' };
const STAGE_ICON = { commit: GitCommitHorizontal, build: Hammer, deploy: Rocket, site: Globe };

/** "3분 전", "2일 전" */
export function ago(iso?: string | null, now = Date.now()) {
  if (!iso) return '';
  const s = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (s < 60) return '방금';
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}일 전`;
  return new Date(iso).toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' });
}
/** 두 시각 사이 — "1분 12초" */
export function span(from?: string | null, to?: string | null, now = Date.now()) {
  if (!from) return '';
  const s = Math.max(0, Math.round(((to ? Date.parse(to) : now) - Date.parse(from)) / 1000));
  return s < 60 ? `${s}초` : `${Math.floor(s / 60)}분 ${s % 60}초`;
}

/** 진행 중 → 실패 → 최근 배포 순 */
export function order(list: Pipeline[]) {
  const failed = (p: Pipeline) => p.stages.build.state === 'failed' || p.stages.deploy.state === 'failed';
  const rank = (p: Pipeline) => (p.active ? 0 : failed(p) ? 1 : 2);
  return [...list].sort((a, b) => rank(a) - rank(b) || (Date.parse(b.lastDeployAt || '') || 0) - (Date.parse(a.lastDeployAt || '') || 0));
}

/** 사이트 단계 — 콘솔의 운영 헬스(/status)로 */
function siteStage(p: Pipeline, h?: EnvStatus): PipeStage {
  if (p.active) return { state: 'idle', title: '사이트', detail: '배포 뒤 확인', url: p.site };
  if (!h) return { state: 'idle', title: '사이트', detail: p.site ? '확인 전' : '주소 없음', url: p.site };
  return { state: h.up ? 'done' : 'failed', title: '사이트', detail: h.up ? `열림${h.latency_ms ? ` · ${h.latency_ms}ms` : ''}` : `안 열림${h.error ? ` · ${h.error}` : ''}`, url: p.site || h.link, at: h.checked_at };
}

function StateIcon({ state }: { state: StageState }) {
  const I = state === 'done' ? Check : state === 'failed' ? X : state === 'running' ? Loader2 : state === 'queued' ? Clock : Minus;
  return <I size={14} strokeWidth={2.6} className={state === 'running' ? 'spin' : undefined} />;
}

function Step({ id, s, now }: { id: keyof typeof STAGE_ICON; s: PipeStage; now: number }) {
  const I = STAGE_ICON[id];
  const time = s.state === 'running' || s.state === 'queued' ? (s.at ? `${span(s.at, null, now)}째` : '')
    : s.endedAt ? `${ago(s.endedAt, now)}${s.at ? ` · ${span(s.at, s.endedAt)}` : ''}` : s.at ? ago(s.at, now) : '';
  const body = (
    <>
      <span className="pipe-ico"><StateIcon state={s.state} /></span>
      <span className="pipe-txt">
        <b><I size={13} />{s.title}</b>
        {s.detail ? <small title={s.detail}>{s.detail}</small> : null}
        {time ? <small className="muted">{time}</small> : null}
      </span>
    </>
  );
  return s.url
    ? <a className={`pipe-step s-${s.state}`} href={s.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{body}</a>
    : <div className={`pipe-step s-${s.state}`}>{body}</div>;
}

/** 단계 사이 선 — 앞이 끝나고 뒤가 도는 중이면 흐른다 */
function linkState(prev: StageState, cur: StageState) {
  if (cur === 'failed') return 'failed';
  if (cur === 'running' || cur === 'queued') return 'flow';
  if (prev === 'done' && cur === 'done') return 'done';
  return 'idle';
}

function PipeCard({ p, health, open, onToggle, focused, now }: { p: Pipeline; health?: EnvStatus; open: boolean; onToggle: () => void; focused: boolean; now: number }) {
  const steps: [keyof typeof STAGE_ICON, PipeStage][] = [['commit', p.stages.commit], ['build', p.stages.build], ['deploy', p.stages.deploy], ['site', siteStage(p, health)]];
  const failed = p.stages.build.state === 'failed' || p.stages.deploy.state === 'failed';
  const head = p.active ? <span className="pipe-badge run"><Loader2 size={12} className="spin" />진행 중</span>
    : failed ? <span className="pipe-badge fail"><X size={12} />실패</span>
    : p.lastDeployAt ? <span className="muted">최근 배포 {ago(p.lastDeployAt, now)}</span> : <span className="muted">배포 기록 없음</span>;
  return (
    <div id={`pipe-${p.key}`} className={`pipe${p.active ? ' is-active' : ''}${failed ? ' is-failed' : ''}${focused ? ' is-focus' : ''}`}>
      <button className="pipe-head" onClick={onToggle} aria-expanded={open}>
        <Logo file={p.logo} name={p.name} size={28} />
        <span className="pipe-name">
          <b>{p.name}</b>
          <small>{PROVIDER[p.provider]} · {p.repo.split('/').pop()}</small>
        </span>
        <span className="pipe-state">{head}</span>
        {p.site ? <a className="pipe-site" href={p.site} target="_blank" rel="noreferrer" title={p.site} onClick={(e) => e.stopPropagation()}><ExternalLink size={14} /></a> : null}
        <ChevronDown size={16} className={`pipe-chev${open ? ' open' : ''}`} />
      </button>
      <div className="pipe-steps">
        {steps.map(([id, s], i) => (
          <Fragment key={id}>
            {i > 0 ? <span className={`pipe-link l-${linkState(steps[i - 1][1].state, s.state)}`} /> : null}
            <Step id={id} s={s} now={now} />
          </Fragment>
        ))}
      </div>
      {p.error ? <div className="pipe-err">{p.error}</div> : null}
      {open ? (
        <div className="pipe-hist">
          <div className="pipe-hist-title">최근 배포</div>
          {p.history.length ? p.history.map((h) => (
            <div key={h.id} className="pipe-hist-row">
              <span className={`pipe-dot s-${h.state}`} />
              <code>{h.sha}</code>
              <span className="pipe-hist-msg" title={h.message}>{h.message}</span>
              <span className="muted">{ago(h.at, now)}{h.endedAt ? ` · ${span(h.at, h.endedAt)}` : ''}</span>
              {h.url ? <a href={h.url} target="_blank" rel="noreferrer">기록</a> : <span />}
            </div>
          )) : <div className="muted">아직 배포 기록이 없습니다</div>}
          <a className="pipe-more" href={`https://github.com/${p.repo}/deployments`} target="_blank" rel="noreferrer">GitHub 에서 전체 배포 기록 <ExternalLink size={12} /></a>
        </div>
      ) : null}
    </div>
  );
}

export function Pipelines({ focus }: { focus?: string }) {
  const [data, setData] = useState<{ at: string; pipelines: Pipeline[]; error?: string } | null>(null);
  const [err, setErr] = useState('');
  const [health, setHealth] = useState<Record<string, EnvStatus | undefined>>({});
  const [open, setOpen] = useState<Set<string>>(() => new Set(focus ? [focus] : []));
  const [now, setNow] = useState(Date.now());
  const active = !!data?.pipelines.some((p) => p.active);

  // 도는 배포가 있으면 3초, 없으면 20초마다(서버는 GitHub 을 60초/5초 간격으로만 본다)
  const poll = usePoll((force) => flowApi.pipelines(force).then((d) => { setData(d); setErr(''); }).catch((e) => { setErr(String(e?.message || e)); throw e; }), active ? 3000 : 20000, [active]);
  useEffect(() => {
    const load = () => api.status().then((r) => setHealth(Object.fromEntries(r.services.map((s) => [s.key, s.prod])))).catch(() => {});
    load(); const t = setInterval(load, 30000); return () => clearInterval(t);
  }, []);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), active ? 1000 : 30000); return () => clearInterval(t); }, [active]);
  useEffect(() => {
    if (!focus || !data) return;
    document.getElementById(`pipe-${focus}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [focus, !!data]);   // eslint-disable-line

  const list = useMemo(() => order(data?.pipelines ?? []), [data]);
  const running = list.filter((p) => p.active);
  const rest = list.filter((p) => !p.active);
  const failedN = list.filter((p) => !p.active && (p.stages.build.state === 'failed' || p.stages.deploy.state === 'failed')).length;
  const toggle = (k: string) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const card = (p: Pipeline) => <PipeCard key={p.key} p={p} health={health[p.key]} open={open.has(p.key)} onToggle={() => toggle(p.key)} focused={focus === p.key} now={now} />;

  return (
    <div className="pipes">
      <div className="pipes-bar">
        <span className="pipes-sum">
          {data ? <>배포되는 서비스 <b>{list.length}</b>개{running.length ? <> · 진행 중 <b className="blue">{running.length}</b></> : null}{failedN ? <> · 실패 <b className="red">{failedN}</b></> : null}</> : '불러오는 중'}
        </span>
        <RefreshBar poll={poll} live />
      </div>
      {err || data?.error ? <div className="pipe-banner">{err || data?.error}</div> : null}
      {running.length ? <section><h3 className="pipes-h">진행 중</h3>{running.map(card)}</section> : null}
      {rest.length ? <section>{running.length ? <h3 className="pipes-h">서비스</h3> : null}{rest.map(card)}</section> : null}
      {data && !list.length ? (
        <div className="pipe-empty">
          <Rocket size={22} />
          <b>배포되는 서비스가 없습니다</b>
          <span className="muted">GitHub Deployments 환경(GitHub Pages·Vercel 등)이 있는 구성요소가 여기에 나옵니다 — <code>api/src/catalog/defaults.ts</code> 의 <code>LIVE</code></span>
        </div>
      ) : null}
    </div>
  );
}
