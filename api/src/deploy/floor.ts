// 되돌리기 하한 — 데이터 형식을 바꾼 배포 뒤에는 새 형식을 못 읽는 옛 버전으로 되돌리면 장애가 난다.
// 관리자가 서비스·환경마다 "이 버전보다 먼저 배포된 버전으로는 되돌리지 않음"을 정한다.
// 버전(커밋 12자)은 순서가 없으므로 그 버전이 처음 성공한 실행 번호(runId)를 기준으로 삼는다.
export interface Floor { version: string; runId: number; reason: string; by: string; at: string }

/** 후보 버전마다 막힌 이유 — 처음 성공한 실행이 하한 실행보다 앞서면 막는다 */
export function blockedBy(entries: { id: number; state: string; version?: string | null }[], candidates: string[], floor: Floor | null): Record<string, string> {
  if (!floor) return {};
  const first = new Map<string, number>();
  for (const e of entries) if (e.state === 'success' && e.version) first.set(e.version, Math.min(first.get(e.version) ?? Infinity, e.id));
  const out: Record<string, string> = {};
  for (const v of candidates) if (v !== floor.version && (first.get(v) ?? Infinity) < floor.runId) out[v] = floor.reason;
  return out;
}

/** 하한으로 정할 수 있는 실행 — 그 버전이 처음 성공한 실행 */
export function firstRunOf(entries: { id: number; state: string; version?: string | null }[], version: string): number | null {
  let id: number | null = null;
  for (const e of entries) if (e.state === 'success' && e.version === version && (id === null || e.id < id)) id = e.id;
  return id;
}
