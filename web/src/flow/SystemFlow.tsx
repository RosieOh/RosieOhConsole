import { LogBox } from '../components/LogBox';
import { User, Users } from '../users';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Background, BackgroundVariant, Controls, ReactFlow, ReactFlowProvider, ViewportPortal, useReactFlow, type Edge, type Node } from '@xyflow/react';
import { Boxes, Cloud, Cpu, Database, Download, GitBranch, Server as ServerIco, Store as StoreIco, Target, Zap, Activity, CheckCircle2, ChevronDown, Crosshair, History, Link2, Maximize2, MousePointerClick, Play, Search, X, XCircle } from 'lucide-react';
import { StepBar, StepState } from './steps';
import '@xyflow/react/dist/style.css';
import { ActiveRun, FlagSummary, FlowGraph, KIND_LABEL, LANE_COLOR, LANE_NAME, LaneKind, ServiceStatus, api, flowApi, projectPath } from '../api';
import { when } from '../grid';
import { RefreshBar, usePoll } from '../poll';
import { Drawer } from '../components/Drawer';
import { Logo } from '../components/Logo';
import { SEG_OF_STAGE, layout, segments } from './layout';
import { edgeTypes, nodeTypes } from './parts';

// 전체 도식 — 모든 프로젝트·러너·산출물·서버·스토어·데이터를 한 장에. 배포가 돌면 그 갈래가 이 도식 위에서 움직인다.
// 서비스를 고르면 그 서비스의 갈래와 연관 서비스(쓰는 것·이걸 쓰는 것)가 밝아지고 나머지는 흐려진다(잘라 내지 않는다).
type EdgeState = 'idle' | 'dim' | 'focus' | 'past' | 'active' | 'next' | 'fail';
const RANK: Record<EdgeState, number> = { idle: 0, dim: 0, focus: 1, next: 2, past: 3, fail: 4, active: 5 };
const DEP = '#0891b2', USER = '#e11d48';

interface Demo { comp: string; lane: LaneKind; index: number; branch?: 'ota' | 'store'; failAt?: number; step?: string | null; run?: ActiveRun }

export function SystemFlow(props: { mode: 'deploy' | 'architecture'; initialFocus?: string; onOpenFlags?: () => void }) {
  return <ReactFlowProvider><SystemFlowInner {...props} /></ReactFlowProvider>;
}

// 흐름 따라가기 — 지금 움직이는 구간으로 화면을 옮기고(확대), 다 끝나면 전체로 돌아온다. 도식은 늘 전체가 그려져 있다.
// 범위는 배치 좌표(layout)로 직접 계산한다 — 라이브러리가 노드 크기를 재기 전이면 엉뚱한 곳(빈 화면)으로 갈 수 있다
type Rect = { x: number; y: number; width: number; height: number };
function Camera({ rect, all, follow, home, placed, focusRect }: { rect: Rect | null; all: Rect | null; follow: boolean; home: number; placed: { x: number; y: number; w: number; h: number }[]; focusRect: Rect | null }) {
  const rf = useReactFlow();
  // 안전장치 — 1초마다 화면 안에 노드가 하나라도 보이는지 본다. 없으면(빈 화면) 고른 경로나 전체로 되돌린다
  useEffect(() => {
    const t = setInterval(() => {
      const el = document.querySelector('.fx-canvas') as HTMLElement | null;
      if (!el || !placed.length) return;
      const v = rf.getViewport();
      const bad = ![v.x, v.y, v.zoom].every(Number.isFinite) || v.zoom <= 0;
      const x1 = -v.x / v.zoom, y1 = -v.y / v.zoom, x2 = x1 + el.clientWidth / v.zoom, y2 = y1 + el.clientHeight / v.zoom;
      const any = !bad && placed.some((p) => p.x + p.w > x1 && p.x < x2 && p.y + p.h > y1 && p.y < y2);
      if (!any) { const r = focusRect ?? all; if (r) void rf.fitBounds(r, { duration: 400, padding: focusRect ? 0.3 : 0.04 }); }
    }, 1000);
    return () => clearInterval(t);
  }, [placed, focusRect, all]);   // eslint-disable-line
  const key = rect ? `${Math.round(rect.x)},${Math.round(rect.y)},${Math.round(rect.width)},${Math.round(rect.height)}` : '';
  const [was, setWas] = useState(false);
  const ok = (r: Rect | null) => !!r && [r.x, r.y, r.width, r.height].every(Number.isFinite) && r.width > 0 && r.height > 0;
  useEffect(() => {
    if (!follow) return;
    // 끝나면 마지막 화면·확대 그대로 둔다(전체로 돌아가지 않는다 — "전체 보기"로만)
    if (ok(rect)) { void rf.fitBounds(rect!, { duration: 900, padding: 0.35 }); setWas(true); }
  }, [key, follow]);   // eslint-disable-line
  useEffect(() => { if (home && ok(all)) void rf.fitBounds(all!, { duration: 700, padding: 0.04 }); }, [home]);   // eslint-disable-line
  // 처음: 따라갈 구간이 있으면 거기로, 없으면 전체(한 번만 — 다른 맞추기가 덮어쓰지 않게)
  useEffect(() => {
    const t = setTimeout(() => { if (follow && ok(rect)) void rf.fitBounds(rect!, { padding: 0.35 }); else if (ok(all)) void rf.fitBounds(all!, { padding: 0.04 }); }, 60);
    return () => clearTimeout(t);
  }, [ok(all)]);   // eslint-disable-line
  return null;
}

const boundsOf = (list: { x: number; y: number; w: number; h: number }[]): Rect | null => {
  if (!list.length) return null;
  const x1 = Math.min(...list.map((p) => p.x)), y1 = Math.min(...list.map((p) => p.y));
  const x2 = Math.max(...list.map((p) => p.x + p.w)), y2 = Math.max(...list.map((p) => p.y + p.h));
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
};

function SystemFlowInner({ mode, initialFocus, onOpenFlags }: { mode: 'deploy' | 'architecture'; initialFocus?: string; onOpenFlags?: () => void }) {
  const [g, setG] = useState<FlowGraph | null>(null);
  const [runs, setRuns] = useState<ActiveRun[]>([]);
  const [health, setHealth] = useState<Record<string, ServiceStatus>>({});
  const [flags, setFlags] = useState<FlagSummary>({});
  const [focus, setFocus] = useState<string | null>(initialFocus ?? null);
  const [showRel, setShowRel] = useState(mode === 'architecture');
  const [demo, setDemo] = useState<Demo | null>(null);
  const [err, setErr] = useState('');
  const [logOf, setLogOf] = useState<{ run: ActiveRun; step?: string } | null>(null);
  const [follow, setFollow] = useState(mode === 'deploy');
  const [lane, setLane] = useState<LaneKind | null>(null);
  const [home, setHome] = useState(0);

  useEffect(() => {
    const load = () => flowApi.graph().then(setG).catch((e) => setErr(String(e?.message || e)));
    load(); const t = setInterval(load, 60000); return () => clearInterval(t);
  }, []);
  const livePoll = usePoll(() => flowApi.live().then((r) => setRuns(r.runs)), 2500);
  useEffect(() => {
    const load = () => api.status().then((r) => setHealth(Object.fromEntries(r.services.map((s) => [s.key, s])))).catch(() => {});
    load(); const t = setInterval(load, 15000); return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const load = () => api.flagSummary().then(setFlags).catch(() => {});   // 못 읽으면 배지만 안 보인다
    load(); const t = setInterval(load, 30000); return () => clearInterval(t);
  }, []);
  // 흐름 재생(설명용) — 고른 서비스의 갈래를 단계마다 1.6초씩
  useEffect(() => {
    if (!demo || !g) return;
    const n = g.stages[demo.lane].length;
    if (demo.failAt !== undefined && demo.index >= demo.failAt) return;   // 실제로 실패한 단계에서 멈춘다(말풍선 유지)
    const t = setTimeout(() => setDemo(demo.index + 1 < n ? { ...demo, index: demo.index + 1 } : null), 1600);
    return () => clearTimeout(t);
  }, [demo, g]);

  const lay = useMemo(() => (g ? layout(g) : null), [g]);

  const view = useMemo(() => {
    if (!g || !lay) return { nodes: [] as Node[], edges: [] as Edge[], liveNodes: new Map<string, string[]>(), activeIds: [] as string[], focusIds: [] as string[] };
    // 지금 움직이는 갈래 — 실제 실행 + 재생
    const moving: { comp: string; lane: LaneKind; index: number; state: string; branch?: 'ota' | 'store'; failed?: boolean; step?: string | null; run?: ActiveRun }[] = [];
    // 재생 → 실행 중 → 막 끝난 것 순서로(같은 서비스·갈래면 앞의 것이 이긴다)
    if (demo) { const f = demo.failAt !== undefined && demo.index >= demo.failAt; moving.push({ comp: demo.comp, lane: demo.lane, index: demo.index, state: f ? 'failure' : 'running', failed: f, step: demo.step, run: demo.run, branch: demo.lane === 'store' ? 'ota' : undefined }); }
    const ordered = [...runs].sort((a, b) => Number(b.state === 'running') - Number(a.state === 'running'));
    for (const r of ordered) for (const comp of r.comps) moving.push({ comp, lane: r.lane, index: r.stage.index, state: r.state, branch: r.stage.branch, failed: r.state === 'failure', step: r.stage.failedStep, run: r });

    const rels = g.relations;
    const deps = new Set(focus ? rels.filter((r) => r.from === `comp:${focus}`).map((r) => r.to) : []);
    const users = new Set(focus ? rels.filter((r) => r.to === `comp:${focus}`).map((r) => r.from) : []);
    const focusLaneNodes = new Set<string>();
    if (focus) for (const l of g.lanes) if (l.comp === focus) for (const s of l.path) for (const id of s.split('|')) focusLaneNodes.add(id);
    const activeNodes = new Map<string, string>();     // 지금 지나는 노드 → 색
    const liveNodes = new Map<string, string[]>();     // 실행별 지금 지나는 노드(로그 카드 위치)
    const alerts = new Map<string, { text: string; run?: ActiveRun; step?: string }>();   // 문제가 난 노드 → 말풍선

    // 선분 상태
    const edgeState = new Map<string, { a: string; b: string; state: EdgeState; color: string; label?: string }>();
    const put = (a: string, b: string, state: EdgeState, color: string, label?: string) => {
      const k = `${a}->${b}`;
      const cur = edgeState.get(k);
      if (!cur || RANK[state] > RANK[cur.state]) edgeState.set(k, { a, b, state, color, label: label ?? cur?.label });
    };
    for (const l of g.lanes) {
      const segs = segments(l.path);
      const m = moving.find((x) => x.comp === l.comp && x.lane === l.lane);
      const color = LANE_COLOR[l.lane];
      for (const [a, b, i] of segs) {
        let st: EdgeState = focus ? 'dim' : 'idle';
        if (focus === l.comp) st = 'focus';
        if (m) {
          // 부모앱: 판정 뒤에는 고른 갈래(OTA/스토어)만
          const offBranch = l.lane === 'store' && m.branch && ((a === 'v:decide' && !b.includes(m.branch === 'ota' ? 'ota' : 'stores')) || (m.branch === 'ota' && a === 'infra:stores') || (m.branch === 'store' && a === 'infra:ota'));
          // 모르는 갈래가 와도 화면이 멈추지 않게 첫 선분으로 본다(#182)
          const segOf = SEG_OF_STAGE[l.lane] ?? [0];
          const s = segOf[Math.min(m.index, segOf.length - 1)];
          if (offBranch) st = 'dim';
          else if (m.state === 'success') st = 'past';
          else if (m.failed) { st = i < s ? 'past' : i === s ? 'fail' : 'dim'; if (i === s && !alerts.has(b)) alerts.set(b, { text: `실패: ${m.step ?? '단계'}`, run: m.run, step: m.step ?? undefined }); }
          else st = i < s ? 'past' : i === s ? 'active' : 'next';
          if (st === 'active') { activeNodes.set(b, color); activeNodes.set(a, color); if (m.run) { const k = m.run.repo + '#' + m.run.id; liveNodes.set(k, [...(liveNodes.get(k) || []), a, b]); } }
        }
        put(a, b, st, color, i === 0 ? LANE_NAME[l.lane] : undefined);
      }
    }
    for (const m of moving) {
      const h = health[m.comp];
      const env = m.lane === 'prod' ? 'prod' : m.lane === 'testbed' ? 'testbed' : null;
      const st = env && (h as any)?.[env];
      if (st?.checked_at && !st.up) alerts.set(`comp:${m.comp}`, { text: `${env === 'prod' ? '운영' : '테스트배드'} 헬스 장애${st.error ? ` (${st.error})` : ''}` });
    }
    const edges: Edge[] = [...edgeState.values()].map((e) => ({
      id: `${e.a}->${e.b}`, source: e.a, target: e.b, type: 'lane', zIndex: RANK[e.state],
      data: { state: e.state, color: e.color, label: e.label },
    }));
    // 연관 관계 — 고른 서비스(또는 배포 중인 서비스)의 것은 늘, 나머지는 "연관 관계 표시"일 때만
    const hot = new Set([focus, ...moving.map((m) => m.comp)].filter(Boolean).map((k) => `comp:${k}`));
    for (const r of rels) {
      const mine = hot.has(r.from) || hot.has(r.to);
      if (!mine && !showRel) continue;
      const color = r.from === `comp:${focus}` ? DEP : r.to === `comp:${focus}` ? USER : 'var(--violet)';
      edges.push({ id: `rel:${r.id}`, source: r.from, target: r.to, type: 'lane', zIndex: mine ? 3 : 0,
        data: { state: mine ? 'focus' : focus ? 'dim' : 'idle', color, dashed: true } });
    }

    const nodes: Node[] = lay.placed.map((p) => {
      const base = { id: p.id, position: { x: p.x, y: p.y }, draggable: false, selectable: p.kind === 'comp' };
      if (p.kind === 'project') return { ...base, type: 'project', zIndex: -1, style: { width: p.w, height: p.h }, data: { label: p.label, logo: p.data?.logo, dim: !!focus } };
      if (p.kind === 'grouplabel') return { ...base, type: 'grouplabel', data: { ...p.data, label: p.label, dim: !!focus } };
      if (p.kind === 'comp') {
        const key = p.id.slice(5);
        const run = runs.find((r) => r.comps.includes(key) && r.state === 'running') ?? runs.find((r) => r.comps.includes(key));
        const demoRun = demo?.comp === key ? undefined : undefined;
        const rel = deps.has(p.id) ? 'dep' : users.has(p.id) ? 'user' : undefined;
        return { ...base, type: 'comp', style: { width: p.w }, data: {
          comp: p.data.comp, run: run ?? demoRun, health: health[key], flags: flags[key], onOpenFlags, focus: focus === key, alert: alerts.get(p.id), onAlert: (a: any) => a?.run && setLogOf({ run: a.run, step: a.step }),
          dim: !!focus && focus !== key && !rel, rel, relLabel: rel === 'dep' ? '쓰는 것' : rel === 'user' ? `${g.components.find((c) => c.key === focus)?.name} 를 씀` : undefined,
        } };
      }
      const lit = activeNodes.get(p.id);
      return { ...base, type: 'infra', style: { width: p.w }, data: {
        kind: p.kind, label: p.label, sub: p.sub, discovered: p.data?.discovered, active: !!lit, color: lit, alert: alerts.get(p.id), onAlert: (a: any) => a?.run && setLogOf({ run: a.run, step: a.step }),
        focus: !!focus && (focusLaneNodes.has(p.id) || deps.has(p.id)), dim: !!focus && !focusLaneNodes.has(p.id) && !deps.has(p.id),
      } };
    });
    return { nodes, edges, liveNodes, activeIds: [...new Set([...activeNodes.keys(), ...alerts.keys()])].sort(), focusIds: [...focusLaneNodes, ...(focus ? [`comp:${focus}`] : [])] };
  }, [g, lay, runs, health, flags, focus, showRel, demo]);

  const focusIds = view.focusIds;
  const focusComp = g?.components.find((c) => c.key === focus);
  const lanesOfFocus = g?.lanes.filter((l) => l.comp === focus) ?? [];
  const running = runs.filter((r) => r.state === 'running');
  const recent = runs.filter((r) => r.state !== 'running');
  const nameOf = (k: string) => g?.components.find((c) => c.key === k);
  const curLane: LaneKind | null = focus ? (lane && lanesOfFocus.some((l) => l.lane === lane) ? lane : (running.find((r) => r.comps.includes(focus))?.lane ?? lanesOfFocus[0]?.lane ?? null)) : null;
  const pick = (k: string | null, l?: LaneKind) => { setFocus(k); setLane(l ?? null); setDemo(null); };

  // 단계 막대 — 재생 > 실행 중 > 막 끝난 배포 > 대기
  const bar = (() => {
    if (!g || !focus || !curLane) return null;
    const labels = g.stages[curLane].map((x) => x.label);
    const n = labels.length;
    const live = runs.find((r) => r.comps.includes(focus) && r.lane === curLane && r.state === 'running');
    const last = runs.find((r) => r.comps.includes(focus) && r.lane === curLane && r.state !== 'running');
    const color = LANE_COLOR[curLane];
    const fill = (idx: number, fail = false, allDone = false): StepState[] => labels.map((_, i) => (allDone || i < idx ? 'done' : i === idx ? (fail ? 'fail' : 'now') : 'next'));
    if (demo && demo.comp === focus && demo.lane === curLane) { const f = demo.failAt !== undefined && demo.index >= demo.failAt; return { labels, color, states: fill(demo.index, f), caption: f ? <><XCircle size={15} color="var(--red)" />재생: 마지막 배포는 여기서 실패했습니다, {demo.step} {demo.run && <button className="btn ghost sm" onClick={() => setLogOf({ run: demo.run!, step: demo.step ?? undefined })}>로그 보기</button>}</> : <><Play size={15} />재생 중{demo.run ? ', 마지막 실제 배포를 따라갑니다' : ', 단계 설명'}</> }; }
    if (live) return { labels, color, states: fill(live.stage.index), caption: <><span className="live"><i />진행 중</span>{live.stage.current ?? ''}, #{live.number}, <User login={live.actor} size={16} /> <a href={live.url} target="_blank" rel="noreferrer">GitHub ↗</a></> };
    if (last) return { labels, color, states: last.state === 'success' ? fill(n, false, true) : fill(last.stage.index, true),
      caption: last.state === 'success' ? <><CheckCircle2 size={15} color="var(--green)" />방금 끝남, {when(last.endedAt ?? last.startedAt)}, <User login={last.actor} size={16} /></> : <><XCircle size={15} color="var(--red)" />실패: {last.stage.failedStep} <button className="btn ghost sm" onClick={() => setLogOf({ run: last })}>로그 보기</button></> };
    return { labels, color, states: labels.map(() => 'next' as StepState), caption: <span className="muted">진행 중인 배포 없음, 재생을 누르면 단계를 따라가 봅니다</span> };
  })();

  return (
    <div className="fx-page">
      {mode === 'deploy' && g && (
        <div className="fx-pick">
          <ServicePicker g={g} value={focus} running={running} onPick={(k) => pick(k)} />
          {focusComp && lanesOfFocus.length > 1 && (
            <div className="seg">
              {lanesOfFocus.map((l) => <button key={l.id} className={'segbtn' + (curLane === l.lane ? ' on' : '')} onClick={() => { setLane(l.lane); setDemo(null); }}><i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: LANE_COLOR[l.lane] }} />{LANE_NAME[l.lane]}</button>)}
            </div>
          )}
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            <button className={'btn sm' + (follow ? ' primary' : '')} onClick={() => setFollow(!follow)} title="움직이는 구간으로 화면 이동"><Crosshair size={14} />따라가기</button>
            <button className="btn sm" onClick={() => setHome((x) => x + 1)}><Maximize2 size={14} />전체 보기</button>
          </span>
        </div>
      )}
      {mode === 'deploy' && bar && focus && curLane && (
        <StepBar lane={curLane} labels={bar.labels} states={bar.states} color={bar.color} caption={bar.caption}
          playing={!!demo && !(demo.failAt !== undefined && demo.index >= demo.failAt)} onPlay={() => { const last = runs.find((x) => x.comps.includes(focus) && x.lane === curLane && x.state !== 'running'); setDemo({ comp: focus, lane: curLane, index: 0, ...(last?.state === 'failure' ? { failAt: last.stage.index, step: last.stage.failedStep, run: last } : last ? { run: last } : {}) }); }} />
      )}

      <div className="fx-wrap">
        <div className="fx-canvas">
          {err && <div className="panel err">{err}</div>}
          {!g && !err && <div className="skeleton" style={{ position: 'absolute', inset: 12 }} />}
          {g && (
            <ReactFlow nodes={view.nodes} edges={view.edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
              minZoom={0.15} maxZoom={1.6} proOptions={{ hideAttribution: true }} nodesConnectable={false} elementsSelectable
              onNodeClick={(_, n) => { if (n.type === 'comp') { const k = n.id.slice(5); pick(focus === k ? null : k); } }}
              onPaneClick={() => pick(null)}>
              <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} color="var(--canvas-dot)" />
              <Controls showInteractive={false} />
              {(() => {
                const live = running.find((r) => focus && r.comps.includes(focus)) ?? running[0];
                if (!live || !lay) return null;
                const ids = view.liveNodes.get(live.repo + '#' + live.id) ?? [];
                const ps = (lay.placed ?? []).filter((p) => ids.includes(p.id) && !p.id.startsWith('comp:'));
                const at = ps.sort((a, b) => b.x - a.x)[0] ?? (lay.placed ?? []).find((p) => p.id === `comp:${live.comps[0]}`);
                return at ? <LiveLog run={live} x={at.x + at.w + 18} y={at.y - 8} color={LANE_COLOR[live.lane]} onOpen={() => setLogOf({ run: live, step: live.stage.current ?? undefined })} /> : null;
              })()}
              <Camera placed={lay?.placed ?? []} focusRect={boundsOf((lay?.placed ?? []).filter((p) => focusIds.includes(p.id)))} rect={(() => { const r = boundsOf((lay?.placed ?? []).filter((p) => (view.activeIds.length ? view.activeIds : focusIds).includes(p.id))); return r && running.length ? { ...r, width: r.width + 420, height: Math.max(r.height, 260) } : r; })()} all={boundsOf(lay?.placed ?? [])} follow={follow} home={home} />
              {mode === 'architecture' && (
                <div className="fx-cam">
                  <button className="btn sm" onClick={() => setHome((x) => x + 1)}><Maximize2 size={14} />전체 보기</button>
                </div>
              )}
              <div className="fx-legend2">
                {(Object.keys(LANE_COLOR) as LaneKind[]).map((l) => <span key={l}><i style={{ background: LANE_COLOR[l] }} />{LANE_NAME[l]}</span>)}
                <span><i style={{ background: DEP }} />쓰는 것</span><span><i style={{ background: USER }} />이걸 쓰는 서비스</span>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}><input type="checkbox" style={{ width: 'auto' }} checked={showRel} onChange={(e) => setShowRel(e.target.checked)} />연결 모두</label>
              </div>
            </ReactFlow>
          )}
          {g && mode === 'deploy' && !focus && running.length === 0 && (
            <div className="fx-hint"><div>
              <MousePointerClick size={28} color="var(--accent)" />
              <h4>서비스를 고르세요</h4>
              <div className="muted" style={{ fontSize: 13 }}>위의 "서비스 고르기"나 도식의 서비스를 누르면 그 서비스가 어떤 단계를 거쳐 서버에 올라가는지 보여 줍니다. 배포가 진행 중이면 자동으로 따라갑니다.</div>
            </div></div>
          )}
        </div>

        <aside className="fx-side">
          <div style={{ marginBottom: 12 }}><RefreshBar poll={livePoll} live /></div>
          <div className="side-title"><Activity size={15} />지금 진행 중 {running.length > 0 && <span className="chip amber">{running.length}</span>}</div>
          {running.length === 0 && <div className="muted" style={{ fontSize: 13, padding: '6px 2px 12px' }}>진행 중인 배포가 없습니다</div>}
          {running.map((r) => <LiveCard key={r.repo + r.id} r={r} g={g} nameOf={nameOf} onPick={(k) => pick(k, r.lane)} onLog={(step) => setLogOf({ run: r, step })} />)}
          {recent.length > 0 && <div className="side-title" style={{ marginTop: 14 }}><History size={15} />최근 끝난 배포</div>}
          {recent.map((r) => {
            const c = nameOf(r.comps[0]);
            return (
              <div key={r.repo + r.id} className="runrow" onClick={() => pick(r.comps[0], r.lane)}>
                {r.state === 'success' ? <CheckCircle2 size={16} color="var(--green)" /> : <XCircle size={16} color="var(--red)" />}
                {c && <Logo file={c.logo} name={c.name} size={18} />}
                <span style={{ fontWeight: 600 }}>{c?.name ?? r.comps[0]}</span>
                <span className={'envchip ' + r.lane}>{LANE_NAME[r.lane]}</span>
                <span className="muted" style={{ marginLeft: 'auto', fontSize: 12 }}>{when(r.endedAt ?? r.startedAt)}</span>
              </div>
            );
          })}
          {focusComp && g && (
            <Impacts comp={focus!} g={g} health={health} deploying={running.some((r) => r.comps.includes(focus!))} />
          )}
        </aside>
      </div>

      {logOf && (
        <Drawer onClose={() => setLogOf(null)}>
          <StepLog run={logOf.run} step={logOf.step} />
        </Drawer>
      )}
    </div>
  );
}

function ServicePicker({ g, value, running, onPick }: { g: FlowGraph; value: string | null; running: ActiveRun[]; onPick: (k: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const cur = g.components.find((c) => c.key === value);
  const withLanes = g.components.filter((c) => g.lanes.some((l) => l.comp === c.key));
  const groups = new Map<string, typeof withLanes>();
  for (const c of withLanes) { const k = projectPath(g.projects, c.project).join(' › '); groups.set(k, [...(groups.get(k) || []), c]); }
  useEffect(() => {
    if (!open) return;
    const f = () => setOpen(false);
    window.addEventListener('click', f);
    return () => window.removeEventListener('click', f);
  }, [open]);
  return (
    <div className="picker" onClick={(e) => e.stopPropagation()}>
      <button className="btn picker-btn" onClick={() => setOpen(!open)}>
        {cur ? <><Logo file={cur.logo} name={cur.name} size={22} />{cur.name}</> : <><Search size={16} />서비스 고르기</>}
        <ChevronDown size={16} className="chev" />
      </button>
      {open && (
        <div className="picker-pop">
          {value && <button className="picker-item" onClick={() => { onPick(null); setOpen(false); }}><X size={16} />선택 해제(전체 보기)</button>}
          {[...groups.entries()].map(([k, list]) => (
            <div key={k}>
              <div className="picker-grp">{k}</div>
              {list.map((c) => {
                const live = running.find((r) => r.comps.includes(c.key));
                return (
                  <button key={c.key} className={'picker-item' + (value === c.key ? ' on' : '')} onClick={() => { onPick(c.key); setOpen(false); }}>
                    <Logo file={c.logo} name={c.name} size={22} />{c.name}
                    {live && <span className="chip amber run"><Activity size={11} />배포 중</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LiveCard({ r, g, nameOf, onPick, onLog }: { r: ActiveRun; g: FlowGraph | null; nameOf: (k: string) => any; onPick: (k: string) => void; onLog: (step?: string) => void }) {
  const color = LANE_COLOR[r.lane];
  const c = nameOf(r.comps[0]);
  const pct = Math.round(((r.stage.index + 0.5) / Math.max(1, g?.stages[r.lane].length ?? 5)) * 100);
  return (
    <div className="fx-run" style={{ borderColor: color, cursor: 'pointer' }} onClick={() => onPick(r.comps[0])}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {c && <Logo file={c.logo} name={c.name} size={22} />}
        <b>{r.comps.map((k) => nameOf(k)?.name ?? k).join(', ')}</b>
        <span className={'envchip ' + r.lane} style={{ marginLeft: 'auto' }}>{LANE_NAME[r.lane]}</span>
      </div>
      <div className="prog"><span style={{ width: `${pct}%`, background: color }} /></div>
      <div style={{ fontSize: 12.5 }}>{g?.stages[r.lane][r.stage.index]?.label}<span className="muted">, {r.stage.current ?? '대기 중'}</span></div>
      {g && (() => { const us = g.relations.filter((x) => r.comps.some((k) => x.to === `comp:${k}`)); return us.length ? (
        <div className="impact-line"><span className="muted">영향 예정 {us.length}</span>{us.slice(0, 8).map((x) => { const c = g.components.find((y) => `comp:${y.key}` === x.from); return c ? <span key={x.id} className="chip amber" title={c.name}><Logo file={c.logo} name={c.name} size={14} />{c.name}</span> : null; })}</div>
      ) : null; })()}
      <div className="muted" style={{ fontSize: 12, marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>#{r.number}, <User login={r.actor} size={16} />, {when(r.startedAt)}
        <button className="btn ghost sm" style={{ marginLeft: 'auto' }} onClick={(e) => { e.stopPropagation(); onLog(r.stage.current ?? undefined); }}>로그</button>
      </div>
    </div>
  );
}

// 영향 범위 — 서비스(로고) · 인프라(종류 아이콘) + 종류 라벨 + 상태 배지
const KIND_ICON: Record<string, [any, string]> = {
  db: [Database, 'DB'], redis: [Zap, 'Redis'], external: [Cloud, '외부 서비스'], server: [ServerIco, '서버'], ota: [Zap, 'OTA'], store: [StoreIco, '스토어'],
  registry: [Boxes, '이미지 저장소'], runner: [Cpu, '러너'], github: [GitBranch, 'GitHub'], release: [Download, 'APK 릴리스'],
};
type Impact = 'pending' | 'up' | 'down' | 'none';
const IMPACT: Record<Impact, [string, string]> = { pending: ['영향 예정', 'amber'], up: ['정상', 'green'], down: ['장애', 'red'], none: ['상태 없음', ''] };

export function impactOf(key: string, health: Record<string, ServiceStatus>, deploying: boolean): Impact {
  if (deploying) return 'pending';
  const h = health[key];
  if (!h) return 'none';
  const envs = (['prod', 'testbed'] as const).map((e) => h[e]).filter((x) => x?.checked_at);
  if (!envs.length) return 'none';
  return envs.some((x) => !x!.up) ? 'down' : 'up';
}

function RelItem({ id, g, impact, via }: { id: string; g: FlowGraph; impact?: Impact; via?: string }) {
  const c = id.startsWith('comp:') ? g.components.find((x) => `comp:${x.key}` === id) : undefined;
  const n = [...g.infra, ...g.virtual].find((x) => x.id === id);
  const [I, kindLabel] = c ? [null, KIND_LABEL[c.kind]] : (KIND_ICON[n?.kind ?? 'external'] ?? KIND_ICON.external);
  return (
    <div className="rel-item" title={via}>
      {c ? <Logo file={c.logo} name={c.name} size={22} /> : <span className="rel-ic">{I && <I size={14} />}</span>}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="rel-name">{c?.name ?? n?.name ?? id}</div>
        <div className="rel-kind">{kindLabel}{n?.sub ? `, ${n.sub}` : ''}</div>
      </div>
      {impact && impact !== 'none' && <span className={'chip ' + IMPACT[impact][1]}>{IMPACT[impact][0]}</span>}
    </div>
  );
}

function Impacts({ comp, g, health, deploying }: { comp: string; g: FlowGraph; health: Record<string, ServiceStatus>; deploying: boolean }) {
  const users = g.relations.filter((r) => r.to === `comp:${comp}`);
  const deps = g.relations.filter((r) => r.from === `comp:${comp}`);
  const self = g.components.find((c) => c.key === comp)!;
  return (
    <div className="fx-focus">
      <div className="side-title"><Target size={15} />배포 영향 범위</div>
      <div className="impact-sum">
        <Logo file={self.logo} name={self.name} size={20} /><b>{self.name}</b><span>배포 시 영향 {users.length}곳</span>{deploying && <span className="chip amber" style={{ marginLeft: 'auto' }}>배포 중</span>}
      </div>
      <div className="rel-group-title" style={{ color: USER }}>이 서비스를 쓰는 곳 {users.length}</div>
      {users.length === 0 && <div className="muted" style={{ fontSize: 13, padding: '4px 2px' }}>없음</div>}
      {users.map((r) => <RelItem key={r.id} id={r.from} g={g} via={r.via} impact={impactOf(r.from.slice(5), health, deploying)} />)}
      <div className="rel-group-title" style={{ color: DEP, marginTop: 12 }}>이 서비스가 쓰는 것 {deps.length}</div>
      {deps.map((r) => <RelItem key={r.id} id={r.to} g={g} via={r.via} impact={r.to.startsWith('comp:') ? impactOf(r.to.slice(5), health, false) : undefined} />)}
    </div>
  );
}

// 진행 중 로그 카드 — 움직이는 노드 바로 옆(도식 좌표라 확대·이동을 따라간다). 3초마다
function LiveLog({ run, x, y, color, onOpen }: { run: ActiveRun; x: number; y: number; color: string; onOpen: () => void }) {
  const [d, setD] = useState<{ step: string | null; stepStarted: string | null; lines: string[] } | null>(null);
  const [, tick] = useState(0);
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => { if (body.current) body.current.scrollTop = body.current.scrollHeight; }, [d]);
  useEffect(() => {
    let alive = true;
    const f = () => flowApi.tail(run.repo, run.id).then((x) => alive && setD(x)).catch(() => {});
    f(); const t = setInterval(f, 3000); const t2 = setInterval(() => tick((n) => n + 1), 1000);
    return () => { alive = false; clearInterval(t); clearInterval(t2); };
  }, [run.repo, run.id]);
  const sec = d?.stepStarted ? Math.max(0, Math.round((Date.now() - Date.parse(d.stepStarted)) / 1000)) : null;
  return (
    <ViewportPortal>
      <div className="livelog" style={{ transform: `translate(${x}px, ${y}px)`, '--lane': color } as any} onClick={(e) => e.stopPropagation()}>
        <div className="livelog-head"><span className="spin-dot" /><b>{d?.step ?? run.stage.current ?? '준비 중'}</b>{sec !== null && <span className="muted">{sec < 60 ? `${sec}초` : `${Math.floor(sec / 60)}분 ${sec % 60}초`}</span>}</div>
        <div className="livelog-body" ref={body}>
          {!d && <div className="muted">로그를 불러오는 중…</div>}
          {d?.lines.map((l, i) => <div key={i} className={/\b(ERROR|Error|FAIL|failed|Exception)\b/.test(l) ? 'err-line' : /\b(WARN|warning)\b/i.test(l) ? 'warn-line' : ''}>{l}</div>)}
        </div>
        <div className="livelog-foot"><button className="btn ghost sm" onClick={onOpen}>지금 단계 로그</button><a className="btn ghost sm" href={run.url} target="_blank" rel="noreferrer">전체 로그 ↗</a></div>
      </div>
    </ViewportPortal>
  );
}

function StepLog({ run, step }: { run: ActiveRun; step?: string }) {
  const [d, setD] = useState<{ job: string | null; step: string | null; log: string } | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { flowApi.stepLog(run.repo, run.id, step).then(setD).catch((e) => setErr(String(e?.message || e))); }, [run, step]);
  return (
    <div>
      <h2>{run.repo} #{run.number}, {d?.step ?? step ?? '실패 단계'}</h2>
      <div className="muted" style={{ fontSize: 12, margin: '6px 0 10px' }}>{run.title}</div>
      {err && <div className="err">{err}</div>}
      {!d && !err && <div className="muted">불러오는 중…</div>}
      {d && (d.log ? <LogBox text={d.log} maxHeight="calc(100vh - 160px)" /> : <div className="muted">로그가 없습니다. GitHub 에서 확인하세요.</div>)}
      <a className="btn ghost" href={run.url} target="_blank" rel="noreferrer" style={{ marginTop: 10, display: 'inline-block' }}>GitHub 에서 전체 로그 ↗</a>
    </div>
  );
}
