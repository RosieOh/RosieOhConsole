import type { BoardData, Me, ReportData, ReposData, ViewersData } from './types';

/** 서버가 거절한 이유를 그대로 담은 오류 */
export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

// Rosie 콘솔 안의 업무보드(6d) — API 는 /board/api/…, 로그인·로그아웃은 콘솔(/dashapi)
export const BASE = '/board';
export const LOGIN_URL = '/dashapi/login';
/** 콘솔 로그아웃(JSON 응답) 뒤 콘솔 첫 화면으로 */
export function logout() {
  void fetch('/dashapi/logout', { method: 'POST', credentials: 'same-origin' }).finally(() => { location.href = '/'; });
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, { cache: 'no-store', ...init, headers: { Accept: 'application/json', ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...(init?.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path === '/api/board') { location.href = LOGIN_URL; }   // 로그인 만료
  if (!res.ok || (data && data.ok === false)) throw new ApiError(data?.error || `HTTP ${res.status}`, res.status);
  return data as T;
}
const post = <T>(path: string, body: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(body) });

type Target = { repo: string; number: number };

export const api = {
  board: () => request<BoardData>('/api/board'),
  me: () => request<Me>('/api/me').catch((): Me => ({ login: null, admin: false })),
  move: (t: Target, to: string) => post<{ ok: true; labels: string[] }>('/api/move', { ...t, to }),
  blocked: (t: Target) => post<{ ok: true; blocked: boolean }>('/api/blocked', t),
  follow: (t: Target) => post<{ ok: true }>('/api/follow', t),
  close: (t: Target) => post<{ ok: true }>('/api/state', { ...t, state: 'closed' }),
  viewers: () => request<ViewersData>('/api/viewers'),
  changeViewer: (action: 'add' | 'remove', login: string) => post<{ ok: true; viewers: string[] }>('/api/viewers', { action, login }),
  repos: (q: string) => request<ReposData>(`/api/repos?q=${encodeURIComponent(q)}`),
  changeRepo: (body: { action: 'add' | 'remove' | 'type'; repo: string; type?: string }) => post<{ ok: true }>('/api/repos', body),
  report: () => request<ReportData>('/api/report'),
  reportAct: (body: { action: 'save' | 'reset' | 'reflect'; project: string; text?: string }) => post<{ ok: true }>('/api/report', body),
};
