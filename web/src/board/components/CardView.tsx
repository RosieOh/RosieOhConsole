import type { CSSProperties } from 'react';
import clsx from 'clsx';
import type { Card } from '../lib/types';
import { FLAG_KO, colorOf, ko } from '../lib/stages';
import { dueText, needsCheck, repoShort } from '../lib/format';
import { StageRing } from './StageRing';
import { Avatar } from './Avatar';

/** 카드 딱지 — 빨강(급함)·노랑(주의)·보라(사람 판단) */
export function cardChips(c: Card): Array<[string, 'd' | 'w' | 'b' | '']> {
  return [
    ...(c.overdue ? [['지연', 'd']] as const : []),
    ...(c.stale ? [['정체', 'w']] as const : []),
    ...c.flags.map((f) => [FLAG_KO[f] || f, f === 'blocked' || f === 'ci_failed' ? 'd' : 'w'] as [string, 'd' | 'w']),
    ...(c.manual ? [['사람이 정함', 'b']] as const : []),
    ...(c.disagree && c.derivedStage ? [[`기록: ${ko(c.derivedStage)}`, 'b']] as const : []),
    ...(c.dupStage ? [['단계 라벨 2개', '']] as const : []),
  ] as Array<[string, 'd' | 'w' | 'b' | '']>;
}

/** 카드 겉모습 — 칸 안의 카드와 끌고 다니는 유령 카드가 같이 쓴다 */
export function CardView({ card: c, ghost, className, style }: { card: Card; ghost?: boolean; className?: string; style?: CSSProperties }) {
  const chips = cardChips(c);
  return (
    <div style={{ '--c': colorOf(c.stage), ...style } as CSSProperties}
      className={clsx('board-card', ghost ? 'board-card-ghost' : needsCheck(c) && 'board-card-risk', className)}>
      <div className="board-card-top">
        <a href={c.url} target="_blank" rel="noopener" onPointerDown={(e) => e.stopPropagation()}
          className="board-card-ref">{repoShort(c.repo)}#{c.number}</a>
        {/* 겹쳐 놓고 링으로 떼어 놨었다 — 담당자가 하나면 링이 그냥 테두리로만
            보인다. 작은 틈으로 떼고 링은 뺀다(#148) */}
        <span className="board-card-orbs">
          {c.assignees.length ? c.assignees.slice(0, 3).map((a) => <Avatar key={a} login={a} ring="transparent" />) : <Avatar ring="transparent" />}
        </span>
      </div>
      <div className="board-card-main">
        <StageRing stage={c.stage} />
        <span className="board-card-title">{c.title}</span>
      </div>
      {(chips.length > 0 || c.due) && (
        <div className="board-card-chips">
          {chips.map(([t, k]) => <span key={t} className={clsx('board-chip', k && `board-chip-${k}`)}>{t}</span>)}
          {c.due && <span className={clsx('board-card-due', c.overdue && 'od')}>{dueText(c.due)}</span>}
        </div>
      )}
    </div>
  );
}
