import type { Card, Stage } from './types';

/** 한국 시간 "09-24 17:00" */
export function kstShort(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(new Date(iso).getTime() + 9 * 3600000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

/** "10-08 10일 남음" / "오늘" / "2일 지남" */
export function dueText(due: string, now = Date.now()): string {
  const days = Math.round((new Date(due).getTime() - now) / 86400000);
  const when = kstShort(due).slice(0, 5);
  if (days < 0) return `${when} ${-days}일 지남`;
  if (days === 0) return `${when} 오늘`;
  return `${when} ${days}일 남음`;
}

/** 지연·경고가 하나라도 있으면 '확인 필요' (정체는 넣지 않는다) */
export const needsCheck = (c: Pick<Card, 'overdue' | 'flags'>) => c.overdue || c.flags.length > 0;

/**
 * 되돌리기 방법. 옮기기 전에 사람 단계가 없던 카드(기록을 따르던 카드)는
 * 같은 칸으로 '옮기는' 게 아니라 사람 단계를 떼서 다시 기록을 따르게 해야 한다.
 */
export function undoPlan({ from, prevHuman }: { from: string; prevHuman: Stage | null }):
  { path: '/api/follow' } | { path: '/api/move'; to: string } {
  if (!prevHuman || from === 'unstaged') return { path: '/api/follow' };
  return { path: '/api/move', to: from };
}

/** 담당자 오브 — 아이디마다 정해진 색 세 개와 빛의 위치 (같은 사람은 늘 같은 모양) */
export function orbBackground(login: string): string {
  const PAL = ['#8187ff', '#26b5ce', '#4cb782', '#f2c94c', '#f2994a', '#f2555a', '#b18cf5', '#4ea7fc', '#5ee0c1', '#ff8fd6', '#9bd46a', '#ffb86b'];
  let h = 2166136261;
  for (const ch of String(login)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  const next = () => { h = (Math.imul(h, 1664525) + 1013904223) >>> 0; return h; };
  const c1 = PAL[next() % PAL.length];
  let c2 = PAL[next() % PAL.length]; if (c2 === c1) c2 = PAL[(PAL.indexOf(c1) + 5) % PAL.length];
  let c3 = PAL[next() % PAL.length]; if (c3 === c1 || c3 === c2) c3 = PAL[(PAL.indexOf(c2) + 3) % PAL.length];
  const ang = next() % 360, x1 = 20 + (next() % 30), y1 = 15 + (next() % 30), x2 = 55 + (next() % 30), y2 = 55 + (next() % 30);
  return `radial-gradient(circle at ${x1}% ${y1}%, rgba(255,255,255,.55), transparent 28%),`
    + `radial-gradient(circle at ${x1}% ${y1}%, ${c1}, transparent 62%),`
    + `radial-gradient(circle at ${x2}% ${y2}%, ${c2}, transparent 68%),`
    + `conic-gradient(from ${ang}deg, ${c3}, ${c1}, ${c2}, ${c3})`;
}

export const repoShort = (repo: string) => String(repo).split('/').pop() || repo;
export const cardKey = (c: { repo: string; number: number }) => `${c.repo}#${c.number}`;
