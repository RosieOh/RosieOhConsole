// 되돌리기 목록의 버전 설명 — 버전(커밋 12자)만으로는 무슨 기능이었는지 모른다.
// 실행 목록(최신부터)에서 성공한 버전 순서를 보고, 그 버전 바로 전에 떠 있던 버전을 찾는다.

/** v 바로 전에 성공한 다른 버전 — 없으면 null */
export function previousVersion(entries: { state: string; version?: string | null }[], v: string): string | null {
  const order: string[] = [];
  for (const e of entries) if (e.state === 'success' && e.version && !order.includes(e.version)) order.push(e.version);
  const i = order.indexOf(v);
  return i >= 0 ? order[i + 1] ?? null : null;
}

/** 릴리스 PR 제목("릴리스: …")은 변경 내용이 아니라서 뺀다 */
export const isReleaseTitle = (title: string) => /^릴리스\s*[:：]/.test(title);
