// 테마 — 기본 밝게. 리퀴드 글래스 개편으로 키를 올려 예전에 저장된 선택을 한 번 비운다
export type Theme = 'light' | 'dark';
const KEY = 'mxc.theme.v2';
export function currentTheme(): Theme {
  try { return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light'; } catch { return 'light'; }
}
export function applyTheme(t: Theme) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem(KEY, t); } catch { /* 저장 안 돼도 된다 */ }
}
applyTheme(currentTheme());
