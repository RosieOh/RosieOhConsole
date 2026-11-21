import clsx from 'clsx';
import type { Card, Me } from '../lib/types';
import { NEEDS_CHECK_TIP } from '../lib/stages';
import { kstShort } from '../lib/format';
import { Icon, Logo, type IconName } from './Icons';
import { Avatar } from './Avatar';
import { Picker } from '../../components/Picker';

export type View = 'all' | 'mine' | 'risk' | 'unlinked';

interface Props {
  cards: Card[]; me: Me; view: View; who: string; repo: string; batchAt: string | null;
  counts: { all: number; mine: number; risk: number; unlinked: number };
  onView: (v: View) => void; onWho: (w: string) => void; onRepo: (r: string) => void;
  onViewers: () => void; onRepos: () => void;
}

function NavButton({ icon, label, n, pressed, tip, onClick }: { icon: IconName; label: string; n?: number | string; pressed?: boolean; tip?: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={pressed} data-tip={tip}
      className={clsx('board-navbtn', pressed && 'on')}>
      <span className="board-navbtn-ic"><Icon name={icon} size={15} /></span>
      {label}
      {n !== undefined && n !== '' && <span className="board-navbtn-n">{n}</span>}
    </button>
  );
}

function Section({ icon, title, children }: { icon: IconName; title: string; children: React.ReactNode }) {
  return (
    <nav aria-label={title} className="board-sec">
      <h4><Icon name={icon} size={14} />{title}</h4>
      {children}
    </nav>
  );
}

/** 왼쪽 사이드바 — 보기, 담당, 저장소, 관리(관리자만) */
export function Sidebar({ cards, me, view, who, repo, batchAt, counts, onView, onWho, onRepo, onViewers, onRepos }: Props) {
  const people: Record<string, number> = {};
  for (const c of cards) for (const a of c.assignees) people[a] = (people[a] || 0) + 1;
  const repos = [...new Set(cards.map((c) => c.repo))].sort();
  return (
    <aside className="side board-side" aria-label="보기와 필터">
      <div className="board-brand">
        <Logo /><span>업무 보드<small>GitHub</small></span>
      </div>
      <nav aria-label="보기" className="board-nav">
        <NavButton icon="all" label="모든 업무" n={counts.all} pressed={view === 'all'} onClick={() => onView('all')} />
        <NavButton icon="mine" label="내 업무" n={me.login ? counts.mine : ''} pressed={view === 'mine'} onClick={() => onView('mine')} />
        <NavButton icon="risk" label="확인 필요" n={counts.risk || ''} pressed={view === 'risk'} tip={NEEDS_CHECK_TIP} onClick={() => onView('risk')} />
        <NavButton icon="unlinked" label="미연결 작업" n={counts.unlinked || ''} pressed={view === 'unlinked'} tip="이슈 번호 없이 진행 중인 PR, 브랜치, 보드와 주간보고에 안 잡힙니다" onClick={() => onView('unlinked')} />
      </nav>
      <Section icon="people" title="담당">
        {Object.keys(people).sort().map((p) => (
          <button key={p} type="button" aria-pressed={who === p} onClick={() => onWho(who === p ? '' : p)}
            className={clsx('board-navbtn', who === p && 'on')}>
            <Avatar login={p} size={18} ring="transparent" /><span>{p}</span><span className="board-navbtn-n">{people[p]}</span>
          </button>
        ))}
      </Section>
      <Section icon="repo" title="저장소">
        <Picker label="저장소" placeholder="저장소 전체" value={repo} onChange={onRepo} side
          options={repos.map((r) => ({ value: r, label: r }))} />
      </Section>
      {me.admin && (
        <Section icon="gear" title="관리">
          <NavButton icon="shield" label="열람 권한" onClick={onViewers} />
          <NavButton icon="repo" label="저장소" onClick={onRepos} />
        </Section>
      )}
      <div className="board-foot">
        {cards.length}건, {batchAt ? `판정 기준 ${kstShort(batchAt)}` : '판정 결과 없음, 막힘, CI 실패는 아직'}
      </div>
    </aside>
  );
}
