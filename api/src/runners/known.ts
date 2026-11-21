// 러너가 어디에 있는 무엇인지. GitHub 은 이름·라벨만 안다(셀프 호스티드). 사람 말 설명은 여기서.
// guess: true 는 이름·라벨로 미루어 본 것(확인 전).
export interface RunnerPlace { where: string; kind: string; note?: string; guess?: boolean; capacity?: number }

const KNOWN: Record<string, RunnerPlace> = {};

// 등록은 남아 있지만 쓰지 않는 러너 — 콘솔에 보이지 않게 한다
const RETIRED = new Set<string>([]);
export const retired = (name: string) => RETIRED.has(normName(name));

/** 러너 이름엔 줄바꿈 없는 공백(U+00A0) 등이 섞인다 — 비교용으로 맞춘다 */
export const normName = (s: string) => String(s || '').replace(/\s+/gu, ' ').trim().toLowerCase();

export function placeOf(name: string): RunnerPlace {
  return KNOWN[normName(name)] ?? { where: '알 수 없음. GitHub 저장소 설정 › Actions › Runners 에서 확인', kind: '미분류', guess: true };
}
