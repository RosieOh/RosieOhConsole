// 요청에서 온 값을 다룰 때 쓰는 작은 검사들 — CodeQL 경고(속성 이름 주입·로그 주입)를 코드에서 막는다

/** 객체 키로 써도 되는 이름인지 — __proto__·constructor·prototype 은 객체의 원형을 바꿀 수 있어 막는다 */
export function isSafeKey(k: unknown): k is string {
  return typeof k === 'string' && k !== '' && k !== '__proto__' && k !== 'constructor' && k !== 'prototype';
}

/** 로그 한 줄에 넣을 값 — 줄바꿈·제어 문자를 지워 가짜 로그 줄을 끼워 넣지 못하게 한다 */
export function logSafe(v: unknown, max = 300): string {
  return String(v ?? '').replace(/[\n\r]/g, ' ').replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, max);
}
