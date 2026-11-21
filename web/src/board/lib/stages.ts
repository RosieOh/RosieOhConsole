import type { ColumnKey, Stage } from './types';

/** 서버 src/stage.js 와 같은 값이어야 한다 — stages.test.ts 가 확인한다 */
export const STAGES: Stage[] = ['intake', 'planned', 'started', 'review', 'ready_to_merge', 'awaiting_deploy', 'deployed', 'done', 'cancelled'];

export const STAGE_KO: Record<ColumnKey, string> = {
  intake: '접수', planned: '계획', started: '착수', review: '리뷰 중', ready_to_merge: '머지 대기',
  awaiting_deploy: '배포 대기', deployed: '운영 반영', done: '완료', cancelled: '취소', unstaged: '미분류',
};

export const FLAG_KO: Record<string, string> = {
  blocked: '막힘', ci_failed: 'CI 실패', conflict: '충돌',
  changes_requested: '수정 요청', reopened: '재작업', overdue: '지연', stale: '정체',
};

/** 파이프라인을 따라 회색 → 노랑 → 파랑 → 청록 → 주황 → 초록 → 보라(완료).
 *  콘솔이 밝은·어두운 두 테마라 실제 값은 CSS 변수(--stage-*, board.css)에 있고
 *  여기 값은 CSS 를 못 읽을 때(테스트·서버 렌더)의 대비책이다(#148). */
export const STAGE_COLOR: Record<ColumnKey, string> = {
  intake: '#7fa6bf', planned: '#a7c6d8', started: '#ffd05c', review: '#8fd2ff',
  ready_to_merge: '#6ff0ea', awaiting_deploy: '#ffb066', deployed: '#3df5b0',
  done: '#b78cff', cancelled: '#5b7d95', unstaged: '#ff5d8f',
};

/** --stage-* 를 읽어 둔다. 테마를 바꾸면 비운다 — 입자 캔버스가 hex 를 쓴다. */
const cache = new Map<string, string>();
if (typeof MutationObserver === 'function' && typeof document !== 'undefined') {
  new MutationObserver(() => cache.clear())
    .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}

export const STAGE_PROGRESS: Partial<Record<ColumnKey, number>> = {
  intake: 0, planned: 0, started: 0.25, review: 0.5, ready_to_merge: 0.75, awaiting_deploy: 0.88, deployed: 1,
};

export const NEEDS_CHECK_TIP =
  '지연, 막힘, CI 실패, 충돌, 수정 요청, 재작업 중 하나라도 있는 업무. 정체(7일간 움직임 없음)는 넣지 않습니다';

export const colorOf = (s: string | null | undefined) => {
  const k = (s || 'intake') as ColumnKey;
  const fallback = STAGE_COLOR[k] || STAGE_COLOR.intake;
  if (typeof getComputedStyle !== 'function') return fallback;
  let v = cache.get(k);
  if (v === undefined) {
    v = getComputedStyle(document.documentElement).getPropertyValue(`--stage-${k}`).trim();
    cache.set(k, v);
  }
  return v || fallback;
};
export const ko = (s: string | null | undefined) => (s ? STAGE_KO[s as ColumnKey] || s : '');
