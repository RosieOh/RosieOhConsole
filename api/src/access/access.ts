import { cfg } from '../core/config.js';
import { JsonStore, Versioned } from '../core/json-store.js';

// 권한 — GitHub 계정 기반. 로그인은 처음 관리자(CONSOLE_ADMINS)와 여기 등록된 사람만. 역할: admin(전부 + 카탈로그·권한 편집) · deployer(배포·되돌리기·예약·조치) · viewer(조회, 기본)
// 처음 관리자(CONSOLE_ADMINS)는 화면에서 못 뺀다 — 관리자가 0명이 되는 잠김을 막는다.
export type Role = 'admin' | 'deployer' | 'viewer';
export const ROLES: Role[] = ['admin', 'deployer', 'viewer'];
export const LOGIN_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;

export interface AccessFile extends Versioned { users: Record<string, { role: Role; by: string; at: string }> }

let store: JsonStore<AccessFile> | null = null;
const theStore = () => (store ??= new JsonStore<AccessFile>(`${cfg.dataDir}/access.json`, () => ({ rev: 0, users: {} })));

export const liveAdmins: string[] = [];
const norm = (l: string) => String(l || '').trim().toLowerCase();
const isRoot = (login: string) => cfg.admins.map(norm).includes(norm(login));

export function refreshAdmins() {
  const list = [...new Set([...cfg.admins.map(norm), ...Object.entries(theStore().get().users).filter(([, u]) => u.role === 'admin').map(([l]) => l)])].sort();
  liveAdmins.splice(0, liveAdmins.length, ...list);
  return liveAdmins;
}

/** 로그인해도 되는 사람 — 처음 관리자이거나 권한 명단에 있는 사람 */
export function isAllowed(login: string) {
  return isRoot(login) || !!theStore().get().users[norm(login)];
}

export function roleOf(login: string): Role {
  if (isRoot(login)) return 'admin';
  return theStore().get().users[norm(login)]?.role ?? 'viewer';
}
export const canDeploy = (r: Role) => r === 'admin' || r === 'deployer';

export function listAccess() {
  const s = theStore().get();
  return { rev: s.rev, roots: cfg.admins.map(norm), users: s.users, warning: theStore().broken };
}

/** role 'none' = 명단에서 빼기(로그인 못 함) */
export function setRole(by: string, login: string, role: Role | 'none', rev?: number) {
  const l = norm(login);
  if (!LOGIN_RE.test(l)) throw new Error(`GitHub 아이디 형식이 아닙니다: ${login}`);
  if (role !== 'none' && !ROLES.includes(role)) throw new Error('역할은 admin, deployer, viewer, none 입니다');
  if (isRoot(l)) throw new Error('처음 관리자(CONSOLE_ADMINS)는 화면에서 바꿀 수 없습니다');
  const next = theStore().update(rev, (d) => {
    if (role === 'none') delete d.users[l];
    else d.users[l] = { role, by, at: new Date().toISOString() };
  });
  refreshAdmins();
  return next;
}

/** 시험용 — 다른 dataDir 로 다시 읽는다 */
export function _resetAccessStore() { store = null; refreshAdmins(); }
