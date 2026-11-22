// 업무보드 — GitHub 이슈·PR 에서 카드를 만든다(순수 함수, 시험: api/test/board.test.mjs)
//   단계: 사람이 붙인 '단계/<이름>' 라벨이 이긴다(manual). 없으면 기록으로 짐작한다(derivedStage)
//   깃발: 막힘(라벨) · CI 실패 · 충돌 · 수정 요청 · 재작업(다시 열림). 지연(마일스톤 마감 지남)·정체(7일 움직임 없음)는 따로

export const STAGES = ['intake', 'planned', 'started', 'review', 'ready_to_merge', 'awaiting_deploy', 'deployed', 'done', 'cancelled'] as const;
export type Stage = typeof STAGES[number];
export const STAGE_KO: Record<Stage | 'unstaged', string> = {
  intake: '접수', planned: '계획', started: '착수', review: '리뷰 중', ready_to_merge: '머지 대기',
  awaiting_deploy: '배포 대기', deployed: '운영 반영', done: '완료', cancelled: '취소', unstaged: '미분류',
};
export const STAGE_LABEL = (s: Stage) => `단계/${STAGE_KO[s]}`;
export const BLOCKED_LABEL = '막힘';
export const STAGE_COLOR: Record<Stage, string> = {
  intake: 'c5c9d1', planned: 'a7c6d8', started: 'ffd05c', review: '8fd2ff', ready_to_merge: '6ff0ea',
  awaiting_deploy: 'ffb066', deployed: '3df5b0', done: 'b78cff', cancelled: '8a8f99',
};
const BY_LABEL = new Map(STAGES.map((s) => [STAGE_LABEL(s), s] as const));
const STALE_MS = 7 * 86400_000;

export interface GqlPr {
  number: number; state: 'OPEN' | 'CLOSED' | 'MERGED'; isDraft: boolean; merged: boolean;
  reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null; mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
  commits?: { nodes: { commit: { statusCheckRollup: { state: string } | null } }[] };
}
export interface GqlIssue {
  number: number; title: string; url: string; state: 'OPEN' | 'CLOSED'; stateReason: string | null;
  createdAt: string; updatedAt: string; closedAt: string | null;
  assignees: { nodes: { login: string }[] }; labels: { nodes: { name: string }[] };
  milestone: { title: string; dueOn: string | null } | null;
  closedByPullRequestsReferences?: { nodes: GqlPr[] };
}

export interface Card {
  repo: string; number: number; title: string; url: string; assignees: string[]; milestone: string;
  due: string | null; overdue: boolean; stale: boolean; flags: string[];
  stage: Stage | 'unstaged'; human: Stage | null; manual: boolean; derivedStage: Stage | null; prevStage: Stage | null;
  evidence: string[]; disagree: boolean; dupStage: boolean; updatedAt: string; closedAt: string | null;
}

/** 기록으로 짐작한 단계와 그 근거 */
export function derive(i: GqlIssue): { stage: Stage; evidence: string[] } {
  if (i.state === 'CLOSED') {
    return i.stateReason === 'NOT_PLANNED' ? { stage: 'cancelled', evidence: ['이슈 닫힘(계획 안 함)'] } : { stage: 'done', evidence: ['이슈 닫힘(완료)'] };
  }
  const prs = i.closedByPullRequestsReferences?.nodes ?? [];
  const merged = prs.find((p) => p.merged);
  if (merged) return { stage: 'awaiting_deploy', evidence: [`PR #${merged.number} 머지됨, 이슈는 열려 있음`] };
  const open = prs.filter((p) => p.state === 'OPEN');
  const ready = open.find((p) => !p.isDraft && p.reviewDecision === 'APPROVED');
  if (ready) return { stage: 'ready_to_merge', evidence: [`PR #${ready.number} 승인됨`] };
  const review = open.find((p) => !p.isDraft);
  if (review) return { stage: 'review', evidence: [`PR #${review.number} 리뷰 중`] };
  const draft = open.find((p) => p.isDraft);
  if (draft) return { stage: 'started', evidence: [`PR #${draft.number} 초안`] };
  if (i.milestone || i.assignees.nodes.length) return { stage: 'planned', evidence: [i.milestone ? `마일스톤 ${i.milestone.title}` : '담당자 있음'] };
  return { stage: 'intake', evidence: ['담당자·마일스톤·PR 없음'] };
}

export function toCard(repo: string, i: GqlIssue, now = Date.now()): Card {
  const labels = i.labels.nodes.map((l) => l.name);
  const humans = labels.map((l) => BY_LABEL.get(l)).filter((s): s is Stage => !!s);
  const human = humans[0] ?? null;
  const d = derive(i);
  const prs = i.closedByPullRequestsReferences?.nodes ?? [];
  const live = prs.filter((p) => p.state === 'OPEN');
  const flags: string[] = [];
  if (labels.includes(BLOCKED_LABEL)) flags.push('blocked');
  if (i.state === 'OPEN') {
    if (live.some((p) => ['FAILURE', 'ERROR'].includes(p.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state ?? ''))) flags.push('ci_failed');
    if (live.some((p) => p.mergeable === 'CONFLICTING')) flags.push('conflict');
    if (live.some((p) => p.reviewDecision === 'CHANGES_REQUESTED')) flags.push('changes_requested');
    if (i.stateReason === 'REOPENED') flags.push('reopened');
  }
  const due = i.milestone?.dueOn ?? null;
  return {
    repo, number: i.number, title: i.title, url: i.url,
    assignees: i.assignees.nodes.map((a) => a.login), milestone: i.milestone?.title ?? '',
    due, overdue: i.state === 'OPEN' && !!due && Date.parse(due) < now,
    stale: i.state === 'OPEN' && now - Date.parse(i.updatedAt) > STALE_MS,
    flags, stage: human ?? d.stage, human, manual: !!human, derivedStage: d.stage, prevStage: null,
    evidence: human ? [`라벨 ${STAGE_LABEL(human)}`, ...d.evidence] : d.evidence,
    disagree: !!human && human !== d.stage, dupStage: humans.length > 1,
    updatedAt: i.updatedAt, closedAt: i.closedAt,
  };
}

/** 라벨 바꾸기 — 단계 라벨을 모두 빼고 to 하나만(to 가 null 이면 기록 따르기) */
export function stageLabels(current: string[], to: Stage | null): string[] {
  const rest = current.filter((l) => !BY_LABEL.has(l));
  return to ? [...rest, STAGE_LABEL(to)] : rest;
}

/** 주간보고 자동 초안 — 저장소(=프로젝트) 하나의 이번 주 */
export function draftReport(cards: Card[], since: number): string {
  const doneNow = cards.filter((c) => c.stage === 'done' && c.closedAt && Date.parse(c.closedAt) >= since);
  const doing = cards.filter((c) => ['started', 'review', 'ready_to_merge', 'awaiting_deploy', 'deployed'].includes(c.stage));
  const next = cards.filter((c) => ['intake', 'planned'].includes(c.stage));
  const line = (c: Card) => `- ${c.title} (#${c.number})${c.flags.includes('blocked') ? ' [막힘]' : ''}`;
  return [
    '[실적]', ...(doneNow.length ? doneNow.map(line) : ['- 없음']),
    '[진행]', ...(doing.length ? doing.map((c) => `${line(c)} — ${STAGE_KO[c.stage as Stage]}`) : ['- 없음']),
    '[계획]', ...(next.length ? next.slice(0, 10).map(line) : ['- 없음']),
  ].join('\n');
}
