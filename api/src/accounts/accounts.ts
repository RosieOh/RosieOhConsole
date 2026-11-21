import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { cfg } from '../config.js';
import { JsonStore, Versioned } from '../json-store.js';
import { isAllowed, roleOf, setRole } from '../access/access.js';

// 회원 — 콘솔 자체 계정(아이디·비밀번호)과 GitHub 로그인을 한 명단으로.
// 저장: 문서 'accounts'(MariaDB store 표, DB 가 없으면 DATA_DIR/accounts.json). 역할은 권한 명단(access)에 그대로 둔다.
//
// 상태: pending(가입 승인 대기) → active(로그인 가능) / rejected(거절) / suspended(정지)
// 아이디는 소문자로 비교한다. GitHub 로 만든 계정의 아이디는 GitHub 아이디(소문자)다.
// sv(세션 판 번호)를 올리면 그 사람의 기존 세션이 모두 끊긴다(비밀번호 변경·다른 기기 로그아웃).

export type AccountStatus = 'pending' | 'active' | 'suspended' | 'rejected';
export interface LoginEvent { at: string; via: 'password' | 'github'; ip: string; ok: boolean; reason?: string }
export interface Account {
  login: string; name: string; email: string;
  password?: string;            // scrypt$N$r$p$salt$hash — 없으면 GitHub 로만 로그인
  github?: string;              // 연결된 GitHub 아이디(원래 대소문자)
  status: AccountStatus;
  createdAt: string; via: 'signup' | 'github' | 'admin';
  decidedBy?: string; decidedAt?: string;
  lastLoginAt?: string;
  sv: number;
  history: LoginEvent[];
}
interface AccountsFile extends Versioned { users: Record<string, Account> }

export class AccountError extends Error {
  constructor(readonly code: string, message: string, readonly status = 400) { super(message); }
}

export const ID_RE = /^[a-z][a-z0-9_-]{2,19}$/;
export const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const NAME_MAX = 40;
const HISTORY_KEEP = 20;
const RESERVED = new Set(['admin', 'root', 'system', 'console', 'api', 'github', 'login', 'logout', 'signup', 'me', 'account', 'accounts']);

let store: JsonStore<AccountsFile> | null = null;
const theStore = () => (store ??= new JsonStore<AccountsFile>(`${cfg.dataDir}/accounts.json`, () => ({ rev: 0, users: {} })));
/** 시험용 — 다른 DATA_DIR 로 다시 읽는다 */
export function _resetAccounts() { store = null; fails.clear(); }

const norm = (s: string) => String(s || '').trim().toLowerCase();
const now = () => new Date().toISOString();
const write = (fn: (d: AccountsFile) => void) => theStore().update(undefined, fn);
const isRoot = (login: string) => cfg.admins.map(norm).includes(norm(login));

// ── 비밀번호 ──
const N = 16384, R = 8, P = 1, KEYLEN = 32;
export function hashPassword(pw: string) {
  const salt = randomBytes(16);
  const hash = scryptSync(pw, salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${hash.toString('base64')}`;
}
export function verifyPassword(pw: string, stored: string | undefined) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, salt, hash] = parts;
  const want = Buffer.from(hash, 'base64');
  const got = scryptSync(pw, Buffer.from(salt, 'base64'), want.length, { N: Number(n), r: Number(r), p: Number(p) });
  return want.length === got.length && timingSafeEqual(want, got);
}
/** 비밀번호 규칙 — 틀리면 이유 */
export function passwordProblem(pw: string, login = ''): string | null {
  if (typeof pw !== 'string' || pw.length < 8) return '비밀번호는 8자 이상입니다';
  if (pw.length > 72) return '비밀번호는 72자 이하입니다';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return '비밀번호에 영문과 숫자를 함께 넣으세요';
  if (login && pw.toLowerCase().includes(norm(login))) return '비밀번호에 아이디를 넣지 마세요';
  return null;
}

// ── 로그인 실패 잠금 — IP·아이디마다 15분에 10번 ──
const fails = new Map<string, number[]>();
const FAIL_WINDOW = 15 * 60_000, FAIL_MAX = 10;
const failKey = (ip: string, login: string) => `${ip}|${norm(login)}`;
function locked(ip: string, login: string, t = Date.now()) {
  const list = (fails.get(failKey(ip, login)) || []).filter((x) => t - x < FAIL_WINDOW);
  fails.set(failKey(ip, login), list);
  return list.length >= FAIL_MAX;
}
const noteFail = (ip: string, login: string) => fails.set(failKey(ip, login), [...(fails.get(failKey(ip, login)) || []), Date.now()]);

// ── 읽기 ──
export function getAccount(login: string): Account | null { return theStore().get().users[norm(login)] ?? null; }
export function listAccounts(): Account[] { return Object.values(theStore().get().users).sort((a, b) => a.login.localeCompare(b.login)); }
const byGithub = (gh: string) => Object.values(theStore().get().users).find((a) => a.github && norm(a.github) === norm(gh)) ?? null;

/** 화면에 내주는 모양(비밀번호 해시는 빼고 있는지만) */
export function publicAccount(a: Account) {
  const { password, history, ...rest } = a;
  return { ...rest, hasPassword: !!password, role: roleOf(a.login), root: isRoot(a.login) };
}

function remember(login: string, e: Omit<LoginEvent, 'at'>) {
  write((d) => {
    const a = d.users[norm(login)];
    if (!a) return;
    a.history = [{ at: now(), ...e }, ...(a.history || [])].slice(0, HISTORY_KEEP);
    if (e.ok) a.lastLoginAt = now();
  });
}

// ── 가입·로그인 ──
export function signup(b: { login?: string; name?: string; email?: string; password?: string }) {
  const login = norm(b.login ?? '');
  const name = String(b.name ?? '').trim();
  const email = String(b.email ?? '').trim().toLowerCase();
  if (!ID_RE.test(login)) throw new AccountError('bad_login', '아이디는 영문 소문자로 시작하는 3~20자(영문 소문자, 숫자, -, _)입니다');
  if (RESERVED.has(login)) throw new AccountError('reserved', '쓸 수 없는 아이디입니다');
  if (!name || name.length > NAME_MAX) throw new AccountError('bad_name', `이름은 1~${NAME_MAX}자입니다`);
  if (!EMAIL_RE.test(email)) throw new AccountError('bad_email', '이메일 형식이 아닙니다');
  const why = passwordProblem(String(b.password ?? ''), login);
  if (why) throw new AccountError('bad_password', why);
  // GitHub 아이디로 이미 들어오는 사람(처음 관리자·권한 명단)의 아이디는 가로챌 수 없다
  if (getAccount(login) || isRoot(login) || isAllowed(login) || byGithub(login)) throw new AccountError('taken', '이미 쓰는 아이디입니다', 409);
  if (listAccounts().some((a) => a.email && a.email === email)) throw new AccountError('email_taken', '이미 가입한 이메일입니다', 409);
  const a: Account = { login, name, email, password: hashPassword(String(b.password)), status: 'pending', createdAt: now(), via: 'signup', sv: 0, history: [] };
  write((d) => { d.users[login] = a; });
  return publicAccount(a);
}

const STATUS_MSG: Record<Exclude<AccountStatus, 'active'>, string> = {
  pending: '가입 승인을 기다리는 중입니다. 관리자가 승인하면 로그인할 수 있습니다',
  rejected: '가입이 거절된 계정입니다',
  suspended: '정지된 계정입니다. 관리자에게 문의하세요',
};

/** 아이디·비밀번호 로그인 — 맞으면 계정. 틀린 이유는 아이디가 있는지 드러내지 않는다 */
export function passwordLogin(loginIn: string, pw: string, ip: string): Account {
  const login = norm(loginIn);
  if (locked(ip, login)) throw new AccountError('locked', '로그인을 너무 많이 실패했습니다. 15분 뒤 다시 하세요', 429);
  const a = getAccount(login);
  if (!a || !a.password || !verifyPassword(String(pw ?? ''), a.password)) {
    noteFail(ip, login);
    if (a) remember(a.login, { via: 'password', ip, ok: false, reason: '비밀번호 틀림' });
    throw new AccountError('invalid', '아이디 또는 비밀번호가 맞지 않습니다', 401);
  }
  if (a.status !== 'active') throw new AccountError(a.status, STATUS_MSG[a.status], 403);
  if (!isAllowed(a.login)) throw new AccountError('forbidden', '로그인 권한이 없습니다. 관리자에게 문의하세요', 403);
  fails.delete(failKey(ip, login));
  remember(a.login, { via: 'password', ip, ok: true });
  return getAccount(a.login)!;
}

/**
 * GitHub 로그인 — 연결된 계정이 있으면 그 계정으로. 없고 권한 명단(처음 관리자 포함)에 있으면 계정을 만들어 들인다.
 * 둘 다 아니면 승인 대기 가입으로 남긴다(GitHub 으로 회원가입).
 */
export function githubLogin(gh: string, ip: string): Account {
  let a = byGithub(gh);
  if (!a) {
    const same = getAccount(gh);
    if (same) throw new AccountError('conflict', `콘솔 계정 '${same.login}' 이 이미 있습니다. 그 계정으로 로그인한 뒤 마이페이지에서 GitHub 을 연결하세요`, 409);
    const allowed = isRoot(gh) || isAllowed(gh);
    a = { login: norm(gh), name: gh, email: '', github: gh, status: allowed ? 'active' : 'pending', createdAt: now(), via: 'github', sv: 0, history: [] };
    const made = a;
    write((d) => { d.users[made.login] = made; });
  }
  if (a.status !== 'active') {
    remember(a.login, { via: 'github', ip, ok: false, reason: a.status });
    throw new AccountError(a.status, STATUS_MSG[a.status], 403);
  }
  if (!isAllowed(a.login)) throw new AccountError('forbidden', '로그인 권한이 없습니다. 관리자에게 문의하세요', 403);
  remember(a.login, { via: 'github', ip, ok: true });
  return getAccount(a.login)!;
}

// ── 마이페이지 ──
function mustGet(login: string) {
  const a = getAccount(login);
  if (!a) throw new AccountError('not_found', '계정을 찾지 못했습니다', 404);
  return a;
}

export function myPage(login: string) {
  const a = mustGet(login);
  return { ...publicAccount(a), history: a.history || [] };
}

export function updateProfile(login: string, b: { name?: string; email?: string }) {
  const a = mustGet(login);
  const name = b.name === undefined ? a.name : String(b.name).trim();
  const email = b.email === undefined ? a.email : String(b.email).trim().toLowerCase();
  if (!name || name.length > NAME_MAX) throw new AccountError('bad_name', `이름은 1~${NAME_MAX}자입니다`);
  if (email && !EMAIL_RE.test(email)) throw new AccountError('bad_email', '이메일 형식이 아닙니다');
  if (email && listAccounts().some((x) => x.login !== a.login && x.email === email)) throw new AccountError('email_taken', '다른 계정이 쓰는 이메일입니다', 409);
  write((d) => { Object.assign(d.users[a.login], { name, email }); });
  return publicAccount(getAccount(a.login)!);
}

/** 비밀번호 바꾸기(없으면 새로 정하기). 바꾸면 다른 세션은 끊긴다 — 새 sv 를 돌려준다 */
export function changePassword(login: string, b: { current?: string; next?: string }) {
  const a = mustGet(login);
  if (a.password && !verifyPassword(String(b.current ?? ''), a.password)) throw new AccountError('invalid', '지금 비밀번호가 맞지 않습니다', 401);
  const why = passwordProblem(String(b.next ?? ''), a.login);
  if (why) throw new AccountError('bad_password', why);
  write((d) => { const x = d.users[a.login]; x.password = hashPassword(String(b.next)); x.sv = (x.sv || 0) + 1; });
  return getAccount(a.login)!.sv;
}

/** 다른 기기 로그아웃 — sv 를 올려 지금 쿠키도 무효로 만들고, 컨트롤러가 새 쿠키를 준다 */
export function bumpSession(login: string) {
  const a = mustGet(login);
  write((d) => { d.users[a.login].sv = (d.users[a.login].sv || 0) + 1; });
  return getAccount(a.login)!.sv;
}

export function linkGithub(login: string, gh: string) {
  const a = mustGet(login);
  const other = byGithub(gh);
  if (other && other.login !== a.login) throw new AccountError('github_taken', `GitHub '${gh}' 은 다른 계정('${other.login}')에 연결돼 있습니다`, 409);
  const same = getAccount(gh);
  if (same && same.login !== a.login) throw new AccountError('github_taken', `GitHub '${gh}' 와 같은 아이디의 계정이 따로 있습니다`, 409);
  write((d) => { d.users[a.login].github = gh; });
}

export function unlinkGithub(login: string) {
  const a = mustGet(login);
  if (!a.password) throw new AccountError('no_password', '비밀번호를 먼저 정해야 GitHub 연결을 끊을 수 있습니다(로그인할 방법이 없어집니다)');
  if (norm(a.github ?? '') === a.login && isRoot(a.login)) throw new AccountError('root', '처음 관리자 계정의 GitHub 연결은 끊을 수 없습니다');
  write((d) => { delete d.users[a.login].github; });
}

/** 탈퇴 — 비밀번호가 있으면 비밀번호, 없으면 아이디를 다시 입력 */
export function withdraw(login: string, b: { password?: string; confirm?: string }) {
  const a = mustGet(login);
  if (isRoot(a.login)) throw new AccountError('root', '처음 관리자는 탈퇴할 수 없습니다(CONSOLE_ADMINS)');
  if (a.password ? !verifyPassword(String(b.password ?? ''), a.password) : norm(b.confirm ?? '') !== a.login)
    throw new AccountError('invalid', a.password ? '비밀번호가 맞지 않습니다' : `아이디 '${a.login}' 를 그대로 입력하세요`, 401);
  write((d) => { delete d.users[a.login]; });
  try { setRole(a.login, a.login, 'none'); } catch { /* 명단에 없었다 */ }
}

// ── 관리자 ──
export type AdminAction = 'approve' | 'reject' | 'suspend' | 'activate' | 'reset-password' | 'delete';
export const ADMIN_ACTIONS: AdminAction[] = ['approve', 'reject', 'suspend', 'activate', 'reset-password', 'delete'];

/** 관리자 조치. reset-password 는 임시 비밀번호를 한 번만 돌려준다 */
export function adminAction(by: string, login: string, action: AdminAction): { account?: ReturnType<typeof publicAccount>; tempPassword?: string } {
  const a = mustGet(login);
  if (norm(by) === a.login && action !== 'reset-password') throw new AccountError('self', '자기 계정에는 쓸 수 없습니다');
  if (isRoot(a.login) && action !== 'reset-password') throw new AccountError('root', '처음 관리자 계정은 바꿀 수 없습니다');
  const decided = { decidedBy: norm(by), decidedAt: now() };
  switch (action) {
    case 'approve':
    case 'activate':
      if (action === 'approve' && a.status !== 'pending' && a.status !== 'rejected') throw new AccountError('state', '승인 대기 중인 계정이 아닙니다');
      write((d) => { Object.assign(d.users[a.login], { status: 'active' }, decided); });
      if (!isAllowed(a.login)) setRole(by, a.login, 'viewer');   // 승인 = 보기 권한부터
      break;
    case 'reject':
      if (a.status !== 'pending') throw new AccountError('state', '승인 대기 중인 계정만 거절할 수 있습니다');
      write((d) => { Object.assign(d.users[a.login], { status: 'rejected' }, decided); });
      break;
    case 'suspend':
      write((d) => { const x = d.users[a.login]; Object.assign(x, { status: 'suspended' }, decided); x.sv = (x.sv || 0) + 1; });
      break;
    case 'reset-password': {
      const temp = randomBytes(9).toString('base64url').replace(/[-_]/g, 'x') + '7a';
      write((d) => { const x = d.users[a.login]; x.password = hashPassword(temp); x.sv = (x.sv || 0) + 1; });
      return { account: publicAccount(getAccount(a.login)!), tempPassword: temp };
    }
    case 'delete':
      write((d) => { delete d.users[a.login]; });
      try { setRole(by, a.login, 'none'); } catch { /* 명단에 없었다 */ }
      return {};
  }
  return { account: publicAccount(getAccount(a.login)!) };
}
