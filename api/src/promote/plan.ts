// 운영 승격 — 어떤 방식으로 운영에 올리나(구성요소별). 실행기는 이 계획대로만 움직인다.
//   merge-push   main 머지 = 운영 배포(main push 로 도는 deploy 워크플로·앱 릴리스)
//   merge-dispatch  main 머지 뒤 kamal-prod deploy 를 부른다
import type { ComponentDef } from '../catalog/types.js';

export type Method = 'merge-push' | 'merge-dispatch';
export interface Plan {
  method: Method;
  source: 'testbed' | 'dev';          // 무엇을 올리나 — 테스트배드에 떠 있는 버전 / dev 끝(테스트배드가 없으면)
  watch: string;                      // 머지·실행 뒤 지켜볼 워크플로
  dispatch?: { workflow: string; ref: string; inputs: Record<string, string> };
  confirm: string;                    // 예약할 때 직접 입력해야 하는 이름
  lane: 'prod' | 'apk' | 'store';
}

export function planOf(c: ComponentDef): Plan | null {
  const prod = c.deploy?.prod;
  if (prod?.environment) return null;   // Pages·Vercel — 기본 브랜치 push 가 곧 배포, 콘솔이 올릴 일이 없다
  if (prod) {
    const kamalProd = prod.workflows.includes('kamal-prod.yml');
    const extra = Object.fromEntries(Object.entries(prod.rollback?.inputs ?? {}).filter(([k]) => !['action', 'confirm', 'version'].includes(k)));
    return {
      method: kamalProd ? 'merge-dispatch' : 'merge-push',
      source: c.deploy?.testbed ? 'testbed' : 'dev',
      watch: kamalProd ? 'kamal-prod.yml' : prod.workflows[0],
      dispatch: kamalProd ? { workflow: 'kamal-prod.yml', ref: 'main', inputs: { ...extra, action: 'deploy', confirm: prod.kamal } } : undefined,
      confirm: prod.rollback?.confirm ?? prod.kamal,
      lane: 'prod',
    };
  }
  if (c.kind === 'store-app' && c.store) return { method: 'merge-push', source: 'dev', watch: c.store.workflow, confirm: c.repo, lane: 'store' };
  if (c.kind === 'device-app') return { method: 'merge-push', source: 'dev', watch: 'release-apk.yml', confirm: c.repo, lane: 'apk' };
  return null;
}

/** 커밋 메시지들에서 이슈 번호(#12) — 릴리스 PR 본문에 넣어 이슈와 잇는다 */
export function issueRefs(messages: string[]): number[] {
  const out = new Set<number>();
  for (const m of messages) for (const x of m.matchAll(/(?:^|[\s(\['"])#(\d{1,6})\b/g)) out.add(Number(x[1]));
  return [...out].sort((a, b) => a - b).slice(0, 30);
}

/** 예약 시각 검사 — 지금보다 1분 이전은 안 되고, 14일 넘게 뒤도 안 된다 */
export function checkAt(iso: string, now = Date.now()): string | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '시각이 올바르지 않습니다';
  if (t < now - 60_000) return '지난 시각입니다';
  if (t > now + 14 * 86400_000) return '14일 안으로만 예약할 수 있습니다';
  return null;
}
