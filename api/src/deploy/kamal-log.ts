// 배포 탭 — Actions 실행 로그에서 "무엇을 어디에 올렸나"를 읽는다.
// Kamal 은 배포·되돌리기 때 컨테이너를 <service>-web-<destination>-<버전12> 이름으로 띄운다(로그에 --name 으로 찍힘).
// 템플릿이 달라도(그랜드 자체 워크플로·공용 템플릿·되돌리기) 이 이름은 같아서 한 규칙으로 읽힌다.
// check 처럼 아무것도 안 올린 실행엔 이 이름이 없다 → 배포로 치지 않는다.

export interface KamalTarget { kamal: string; dest: string; version: string; ok?: boolean }   // ok: 그 대상을 올린 작업(job)이 성공했나
export interface RunReading { targets: KamalTarget[]; action: 'deploy' | 'rollback' }

const NAME = /--name ([a-z0-9][a-z0-9_-]*?)-web-([a-z0-9]+)-([0-9a-f]{12})\b/g;

export function readKamalLog(log: string, workflowPath = ''): RunReading {
  const seen = new Map<string, KamalTarget>();
  for (const m of log.matchAll(NAME)) seen.set(`${m[1]}/${m[2]}`, { kamal: m[1], dest: m[2], version: m[3] });   // 같은 대상은 마지막 것
  const rollback = /▶ kamal rollback\b/.test(log) || /^rollback/.test(workflowPath.replace(/^.*\//, ''));
  return { targets: [...seen.values()], action: rollback ? 'rollback' : 'deploy' };
}

/** 실행 하나 = 작업(job) 여러 개. 대상의 성공 여부는 실행 전체가 아니라 그 대상을 올린 작업으로 본다
 *  (테스트 작업이 실패해도 배포 작업은 성공하는 저장소가 있다 — 실행 결과만 보면 "실패"로 보인다) */
export function readKamalJobs(jobs: { log: string; ok: boolean }[], workflowPath = ''): RunReading {
  const targets = new Map<string, KamalTarget>();
  let rollback = false;
  for (const j of jobs) {
    const r = readKamalLog(j.log, workflowPath);
    rollback ||= r.action === 'rollback';
    for (const t of r.targets) targets.set(`${t.kamal}/${t.dest}`, { ...t, ok: j.ok });
  }
  return { targets: [...targets.values()], action: rollback ? 'rollback' : 'deploy' };
}

export const VERSION_RE = /^[0-9a-f]{12}$/;

/** 되돌리기 워크플로 입력 — {version}·{confirm} 만 채운다 */
export function fillInputs(tpl: Record<string, string>, v: { version: string; confirm: string }) {
  return Object.fromEntries(Object.entries(tpl).map(([k, x]) => [k, x.replace('{version}', v.version).replace('{confirm}', v.confirm)]));
}
