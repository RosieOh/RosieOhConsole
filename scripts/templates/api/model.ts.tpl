// __TITLE__ — 화면에 내주는 모양과 순수 함수. 서비스(GitHub·파일)와 떨어뜨려 두면 시험이 쉽다(test/__NAME__.test.mjs)
// 모양을 바꾸면 web/src/api.ts 의 __PASCAL__Item·__PASCAL__View 도 같이 바꾼다.
export interface __PASCAL__Item { id: string; name: string; note?: string; updatedAt?: string }
export interface __PASCAL__View { items: __PASCAL__Item[]; updatedAt: string }

export const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** 이름 순, 같은 이름은 id 순 */
export function toView(items: __PASCAL__Item[], now = new Date()): __PASCAL__View {
  return {
    items: [...items].sort((a, b) => a.name.localeCompare(b.name, 'ko') || a.id.localeCompare(b.id)),
    updatedAt: now.toISOString(),
  };
}

/** 화면이 보낸 값 검사 — 틀리면 이유, 맞으면 null */
export function invalid(b: Partial<__PASCAL__Item>): string | null {
  if (!b.id || !ID_RE.test(b.id)) return 'id 는 소문자, 숫자, - 로 64자 이내입니다';
  if (!b.name?.trim()) return '이름이 비었습니다';
  if (b.note && b.note.length > 500) return '메모는 500자 이내입니다';
  return null;
}
