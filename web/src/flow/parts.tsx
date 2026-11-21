import { BaseEdge, EdgeProps, Handle, Position, getBezierPath } from '@xyflow/react';
import type { ActiveRun, CatalogComponent, EnvStatus } from '../api';
import { KIND_LABEL, LANE_COLOR } from '../api';
import { Logo } from '../components/Logo';
import { ToggleRight } from 'lucide-react';

const H = { opacity: 0, width: 6, height: 6, border: 'none' } as const;

// 문제 말풍선 — 노드 위에 떠서 무엇이 잘못됐는지, 누르면 로그
function Bubble({ data }: { data: any }) {
  if (!data.alert) return null;
  return (
    <button className="fx-bubble" onClick={(e) => { e.stopPropagation(); data.onAlert?.(data.alert); }}>
      <span className="fx-bubble-ic">!</span>{data.alert.text}{data.alert.run && <u>로그 보기</u>}
    </button>
  );
}

// 배포 갈래 선 — 움직이는 점(실행 중), 실선(지나온 단계), 점선(남은 단계), 흐림(관계없음)
export function LaneEdge(p: EdgeProps) {
  const [path] = getBezierPath(p);
  const d: any = p.data || {};
  const color = d.color || 'var(--edge)';
  const state: 'idle' | 'dim' | 'focus' | 'past' | 'active' | 'next' | 'fail' = d.state || 'idle';
  const style: React.CSSProperties = {
    stroke: state === 'fail' ? 'var(--red)' : state === 'idle' ? 'var(--edge)' : state === 'dim' ? 'var(--edge-dim)' : color,
    strokeWidth: state === 'active' ? 3 : state === 'past' || state === 'focus' ? 2.2 : 1.3,
    strokeDasharray: state === 'next' ? '6 5' : d.dashed ? '3 4' : undefined,
    opacity: state === 'dim' ? 0.5 : 1,
  };
  return (
    <>
      <BaseEdge id={p.id} path={path} style={style} />
      {state === 'active' && [0, 0.33, 0.66].map((b) => (
        <circle key={b} r={4.5} fill={color} style={{ filter: `drop-shadow(0 0 4px ${color})` }}>
          <animateMotion dur="1.4s" begin={`${b * 1.4}s`} repeatCount="indefinite" path={path} />
        </circle>
      ))}
      {d.label && (state === 'active' || state === 'focus') && (
        <text>
          <textPath href={`#${p.id}`} startOffset="50%" textAnchor="middle" style={{ fontSize: 10, fill: color }} dy={-5}>{d.label}</textPath>
        </text>
      )}
    </>
  );
}

// 기능 스위치 배지 — 기본값과 다르게 켜 둔 스위치 수, 누르면 기능 스위치 화면
function FlagBadge({ data }: { data: any }) {
  const f: { env: 'prod' | 'testbed'; on: number }[] | undefined = data.flags;
  if (!f?.length) return null;
  const text = f.map((x) => `${x.env === 'prod' ? '운영' : '테스트배드'} ${x.on}`).join(', ');
  return (
    <button className={'fx-flag' + (f.some((x) => x.env === 'prod') ? ' prod' : '')} title={`켜 둔 기능 스위치, ${text}`}
      onClick={(e) => { e.stopPropagation(); data.onOpenFlags?.(); }}>
      <ToggleRight size={12} />{text}
    </button>
  );
}

const dot = (s?: EnvStatus) => (!s || !s.checked_at ? 'unknown' : s.up ? 'up' : 'down');

export function CompNode({ data }: { data: any }) {
  const c: CatalogComponent = data.comp;
  const run: ActiveRun | undefined = data.run;
  const st: { testbed?: EnvStatus; prod?: EnvStatus } = data.health || {};
  const color = run ? LANE_COLOR[run.lane] : undefined;
  const failed = run && run.state === 'failure';
  const ok = run && run.state === 'success';
  return (
    <div className={'fx-comp' + (data.alert ? ' alerting' : '') + (data.dim ? ' dim' : '') + (data.focus ? ' focus' : '') + (run?.state === 'running' ? ' running' : '') + (failed ? ' failed' : '') + (ok ? ' ok' : '') + (data.rel ? ' rel-' + data.rel : '')}
      style={color ? ({ '--lane': color } as any) : undefined}>
      <Bubble data={data} />
      <FlagBadge data={data} />
      <Handle type="target" position={Position.Left} style={H} />
      <Handle type="source" position={Position.Right} style={H} />
      <Logo file={c.logo} name={c.name} size={22} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="fx-title">{c.name}</div>
        {run ? (
          <div className="fx-sub" style={{ color: failed ? 'var(--red)' : color }}>
            {failed ? `실패: ${run.stage.failedStep ?? ''}` : ok ? '완료' : `${run.stage.done}/${run.stage.total}, ${run.stage.current ?? '대기'}`}
          </div>
        ) : <div className="fx-sub">{KIND_LABEL[c.kind]}{data.relLabel ? `, ${data.relLabel}` : ''}</div>}
        {run?.state === 'running' && <div className="fx-bar"><span style={{ width: `${Math.round((run.stage.done / Math.max(1, run.stage.total)) * 100)}%`, background: color }} /></div>}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {st.testbed && <span className={'dot ' + dot(st.testbed)} title={`테스트배드 ${dot(st.testbed)}`} />}
        {st.prod && <span className={'dot ' + dot(st.prod)} title={`운영 ${dot(st.prod)}`} />}
      </div>
    </div>
  );
}

const ICON: Record<string, string> = {
  github: '⎇', runner: '⚙', registry: '▣', release: '⬇', decide: '◇', server: '▤', ota: '⚡', store: '🛒', human: '✋', device: '📱', db: '⛁', redis: '◆', external: '☁',
};

export function InfraNode({ data }: { data: any }) {
  return (
    <div className={'fx-infra k-' + data.kind + (data.alert ? ' alerting' : '') + (data.dim ? ' dim' : '') + (data.active ? ' active' : '') + (data.focus ? ' focus' : '')} style={data.color ? ({ '--lane': data.color } as any) : undefined}
      title={data.sub}>
      <Bubble data={data} />
      <Handle type="target" position={Position.Left} style={H} />
      <Handle type="source" position={Position.Right} style={H} />
      <span className="fx-icon">{ICON[data.kind] ?? '•'}</span>
      <div style={{ minWidth: 0 }}>
        <div className="fx-title">{data.label}{data.discovered && <span className="muted" style={{ fontWeight: 400 }}>, 자동</span>}</div>
        <div className="fx-sub">{data.sub}</div>
      </div>
    </div>
  );
}

export function ProjectNode({ data }: { data: any }) {
  return (
    <div className={'fx-project' + (data.dim ? ' dim' : '')}>
      <div className="fx-project-head"><Logo file={data.logo} name={data.label} size={16} />{data.label}</div>
    </div>
  );
}

export function GroupLabel({ data }: { data: any }) {
  return <div className={'fx-grouplabel' + (data.dim ? ' dim' : '')}><Logo file={data.logo} name={data.name} size={14} />{data.label}</div>;
}

export const nodeTypes = { comp: CompNode, infra: InfraNode, project: ProjectNode, grouplabel: GroupLabel };
export const edgeTypes = { lane: LaneEdge };
