// 손봐야 할 배포 실패 — 시간이 아니라 해결 여부로 본다.
// 실행 목록(entries)은 실행 번호 큰 것(최신)부터. 취소·건너뜀은 결과로 치지 않는다.
type Run = { id: number; state: string; at: string };
const decided = (s: string) => s === 'success' || s === 'failure';

/** 마지막 결과가 실패면 그 실행 — 뒤에 성공이 없으니 아직 안 고친 것 */
export function openFailure<T extends Run>(entries: T[]): T | null {
  const last = entries.find((e) => decided(e.state));
  return last?.state === 'failure' ? last : null;
}

/** 실패 실행마다 그 뒤 처음 성공한 시각 — 해결 안 됐으면 없음 */
export function resolvedAt(entries: Run[]): Map<number, string> {
  const out = new Map<number, string>();
  let nextSuccess: string | null = null;
  for (const e of entries) {
    if (e.state === 'success') nextSuccess = e.at;
    else if (e.state === 'failure' && nextSuccess) out.set(e.id, nextSuccess);
  }
  return out;
}
