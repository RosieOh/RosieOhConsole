import { Fragment, useState } from 'react';
import { motion } from 'framer-motion';
import type { Card } from '../lib/types';
import { FLAG_KO, ko } from '../lib/stages';
import { kstShort } from '../lib/format';
import { Icon } from './Icons';
import { Scrim, useEscape, Portal } from './Overlay';
import { StageRing } from './StageRing';

/** 카드 상세 — 단계·담당·마감·경고·근거, 막힘 표시, 기록 따르기 */
export function Drawer({ card: c, can, denyReason, onClose, onBlocked, onFollow }: {
  card: Card; can: boolean; denyReason: string; onClose: () => void;
  onBlocked: () => Promise<void>; onFollow: () => Promise<void>;
}) {
  useEscape(onClose);
  const [busy, setBusy] = useState(false);
  const blocked = c.flags.includes('blocked');
  const flags = [...(c.overdue ? ['지연'] : []), ...(c.stale ? ['정체'] : []), ...c.flags.map((f) => FLAG_KO[f] || f)];
  const run = (fn: () => Promise<void>) => async () => { setBusy(true); try { await fn(); } finally { setBusy(false); } };
  const rows: Array<[string, React.ReactNode]> = [
    ['단계', <span className="board-inline"><StageRing stage={c.stage} size={13} />{ko(c.stage)}
      {c.manual && ', 사람이 정함'}{c.disagree && c.derivedStage && `, 기록상 ${ko(c.derivedStage)}`}
      {c.prevStage && c.prevStage !== c.stage && `, 지난주 ${ko(c.prevStage)}`}</span>],
    ['담당', c.assignees.join(', ') || '담당 없음'],
    ['마일스톤', c.milestone || '없음'],
    ['마감', c.due ? `${kstShort(c.due).slice(0, 5)}${c.overdue ? ' (지남)' : ''}` : '없음'],
    ['경고', flags.join(', ') || '없음'],
    ['근거', c.evidence.join('  ') || '판정 결과 없음'],
  ];
  return (
    <>
      <Scrim onClose={onClose} />
      <Portal><motion.aside role="dialog" aria-label={c.title}
        className="board-pop board-drawer"
        initial={{ x: 40, opacity: 0, scale: 0.98 }} animate={{ x: 0, opacity: 1, scale: 1 }} exit={{ x: 30, opacity: 0 }}
        transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1] }}>
        <button type="button" onClick={onClose} aria-label="닫기" className="board-x"><Icon name="close" size={14} /></button>
        <div className="board-drawer-ref">{c.repo}#{c.number}</div>
        <h3>{c.title}</h3>
        <a className="board-drawer-link" href={c.url} target="_blank" rel="noopener">GitHub 에서 열기</a>
        <div className="board-drawer-acts">
          <button type="button" className="btn" disabled={!can || busy} title={can ? undefined : denyReason} onClick={run(onBlocked)} autoFocus>
            {blocked ? '막힘 해제' : '막힘 표시'}
          </button>
          {c.human && can && (
            <button type="button" className="btn" disabled={busy} title="사람이 정한 단계를 떼고 커밋, PR 기록을 따르게 합니다" onClick={run(onFollow)}>기록 따르기</button>
          )}
        </div>
        <dl className="board-kv">
          {rows.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}
        </dl>
      </motion.aside></Portal>
    </>
  );
}
