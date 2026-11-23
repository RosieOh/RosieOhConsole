// 회원 — 가입·승인·로그인·세션 끊기·GitHub 연결·탈퇴·관리자 조치 (npm run build 뒤)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

process.env.SESSION_SECRET = 'y'.repeat(40);
process.env.CONSOLE_ADMINS = 'Boss';
process.env.DATA_DIR = mkdtempSync(tmpdir() + '/mxc-accounts-');
const A = await import('../dist/accounts/accounts.js');
const { signSession, readSession } = await import('../dist/auth/session.js');
const { setRole, roleOf } = await import('../dist/access/access.js');

const code = (fn) => { try { fn(); } catch (e) { return e.code; } return null; };
const IP = '10.0.0.1';

test('비밀번호 — scrypt 해시, 맞는 것만 통과, 규칙', () => {
  const h = A.hashPassword('abcd1234');
  assert.match(h, /^scrypt\$16384\$8\$1\$/);
  assert.notEqual(h, A.hashPassword('abcd1234'));   // 소금이 다르다
  assert.ok(A.verifyPassword('abcd1234', h));
  assert.ok(!A.verifyPassword('abcd1235', h));
  assert.ok(!A.verifyPassword('abcd1234', 'plain'));
  assert.match(A.passwordProblem('short1'), /8자/);
  assert.match(A.passwordProblem('onlyletters'), /영문과 숫자/);
  assert.match(A.passwordProblem('alice123x', 'alice'), /아이디/);
  assert.equal(A.passwordProblem('good-pass-42'), null);
});

test('가입 → 승인 대기 → 관리자 승인 → 로그인, 세션 판 번호', () => {
  const a = A.signup({ login: 'Alice', name: '앨리스', email: 'Alice@Example.com', password: 'wonder-land-7' });
  assert.equal(a.login, 'alice');
  assert.equal(a.status, 'pending');
  assert.equal(a.hasPassword, true);
  assert.equal(a.password, undefined);   // 해시는 내주지 않는다
  assert.equal(code(() => A.passwordLogin('alice', 'wonder-land-7', IP)), 'pending');

  // 겹치는 아이디·이메일, 예약어, 처음 관리자 아이디는 가입 못 한다
  assert.equal(code(() => A.signup({ login: 'alice', name: 'x', email: 'z@example.com', password: 'abcdef12' })), 'taken');
  assert.equal(code(() => A.signup({ login: 'alice2', name: 'x', email: 'alice@example.com', password: 'abcdef12' })), 'email_taken');
  assert.equal(code(() => A.signup({ login: 'admin', name: 'x', email: 'q@example.com', password: 'abcdef12' })), 'reserved');
  assert.equal(code(() => A.signup({ login: 'boss', name: 'x', email: 'b@example.com', password: 'abcdef12' })), 'taken');
  assert.equal(code(() => A.signup({ login: '1bad', name: 'x', email: 'c@example.com', password: 'abcdef12' })), 'bad_login');

  const r = A.adminAction('boss', 'alice', 'approve');
  assert.equal(r.account.status, 'active');
  assert.equal(roleOf('alice'), 'viewer');   // 승인 = 보기 권한부터

  assert.equal(code(() => A.passwordLogin('alice', 'nope-nope-1', IP)), 'invalid');
  const ok = A.passwordLogin('ALICE', 'wonder-land-7', IP);
  assert.equal(ok.login, 'alice');
  const cookie = signSession(ok.login, ok.sv);
  assert.equal(readSession(cookie)?.name, '앨리스');

  // 다른 기기 로그아웃 — 옛 쿠키는 끊기고 새 판 번호 쿠키만 산다
  const sv = A.bumpSession('alice');
  assert.equal(readSession(cookie), null);
  assert.equal(readSession(signSession('alice', sv))?.login, 'alice');

  // 정지하면 세션도 로그인도 끊긴다, 다시 쓰게 하면 로그인된다
  A.adminAction('boss', 'alice', 'suspend');
  assert.equal(readSession(signSession('alice', A.getAccount('alice').sv)), null);
  assert.equal(code(() => A.passwordLogin('alice', 'wonder-land-7', IP)), 'suspended');
  A.adminAction('boss', 'alice', 'activate');
  assert.ok(A.passwordLogin('alice', 'wonder-land-7', IP));
  assert.ok(A.myPage('alice').history.length >= 2);
});

test('로그인 실패가 몰리면 잠근다', () => {
  A.signup({ login: 'carol', name: 'C', email: 'carol@example.com', password: 'secret-c-9x' });
  A.adminAction('boss', 'carol', 'approve');
  const ip = '10.9.9.9';
  for (let i = 0; i < 10; i++) assert.equal(code(() => A.passwordLogin('carol', 'wrong-pass-1', ip)), 'invalid');
  assert.equal(code(() => A.passwordLogin('carol', 'secret-c-9x', ip)), 'locked');
  assert.ok(A.passwordLogin('carol', 'secret-c-9x', '10.9.9.10'));   // 다른 IP 는 따로 센다
});

test('GitHub — 처음 관리자는 계정이 생기고, 모르는 사람은 승인 대기, 같은 아이디 계정이 있으면 충돌', () => {
  const boss = A.githubLogin('Boss', IP);
  assert.equal(boss.login, 'boss');
  assert.equal(boss.github, 'Boss');
  assert.equal(boss.status, 'active');

  assert.equal(code(() => A.githubLogin('Dave', IP)), 'pending');
  assert.equal(A.getAccount('dave').via, 'github');
  A.adminAction('boss', 'dave', 'approve');
  assert.equal(A.githubLogin('dave', IP).login, 'dave');

  // 콘솔 계정 alice 가 있는데 GitHub 'alice' 로 들어오면 가로채지 못한다
  assert.equal(code(() => A.githubLogin('alice', IP)), 'conflict');
  // alice 가 자기 계정에 GitHub 'alice-gh' 를 연결하면 그걸로 로그인
  A.linkGithub('alice', 'alice-gh');
  assert.equal(A.githubLogin('Alice-GH', IP).login, 'alice');
  assert.equal(code(() => A.linkGithub('carol', 'alice-gh')), 'github_taken');
  A.unlinkGithub('alice');
  assert.equal(A.getAccount('alice').github, undefined);
  // 비밀번호가 없는 GitHub 계정은 연결을 끊을 수 없다(로그인 방법이 사라진다)
  assert.equal(code(() => A.unlinkGithub('dave')), 'no_password');
});

test('마이페이지 — 프로필·비밀번호 정하기·바꾸기', () => {
  assert.equal(A.updateProfile('dave', { name: '데이브', email: 'dave@example.com' }).name, '데이브');
  assert.equal(code(() => A.updateProfile('dave', { email: 'alice@example.com' })), 'email_taken');
  // GitHub 으로만 들어오던 사람은 지금 비밀번호 없이 새로 정한다
  const sv1 = A.changePassword('dave', { next: 'swordfish-12' });
  assert.ok(A.passwordLogin('dave', 'swordfish-12', IP));
  assert.equal(code(() => A.changePassword('dave', { current: 'wrong-1234', next: 'swordfish-34' })), 'invalid');
  const sv2 = A.changePassword('dave', { current: 'swordfish-12', next: 'swordfish-34' });
  assert.ok(sv2 > sv1);
});

test('관리자 조치·탈퇴 — 처음 관리자·자기 자신은 막는다, 임시 비밀번호', () => {
  assert.equal(code(() => A.adminAction('boss', 'boss', 'suspend')), 'self');
  setRole('boss', 'carol', 'admin');
  assert.equal(code(() => A.adminAction('carol', 'boss', 'suspend')), 'root');
  const { tempPassword } = A.adminAction('boss', 'carol', 'reset-password');
  assert.equal(A.passwordProblem(tempPassword), null);
  assert.ok(A.passwordLogin('carol', tempPassword, '10.1.1.1'));

  assert.equal(code(() => A.withdraw('boss', { confirm: 'boss' })), 'root');
  assert.equal(code(() => A.withdraw('dave', { password: 'nope' })), 'invalid');
  A.withdraw('dave', { password: 'swordfish-34' });
  assert.equal(A.getAccount('dave'), null);
  assert.equal(roleOf('dave'), 'viewer');   // 명단에서 빠졌다(기본값)

  A.signup({ login: 'erin', name: 'E', email: 'erin@example.com', password: 'quiet-river-5' });
  assert.equal(A.adminAction('boss', 'erin', 'reject').account.status, 'rejected');
  assert.equal(code(() => A.passwordLogin('erin', 'quiet-river-5', IP)), 'rejected');
  A.adminAction('boss', 'erin', 'delete');
  assert.equal(A.getAccount('erin'), null);
});

test('터미널 비밀번호 — 처음 관리자는 계정이 없어도 만들고, 모르는 사람은 거절', async () => {
  // 처음 관리자 'boss' 계정은 앞 시험에서 GitHub 로그인으로 생겼다 → 비밀번호만 정해지고 세션 판 번호가 오른다
  const before = A.getAccount('boss').sv;
  const r = A.setPasswordDirect('Boss', 'first-admin-7');
  assert.equal(r.created, false);
  assert.ok(A.getAccount('boss').sv > before);
  assert.ok(A.passwordLogin('boss', 'first-admin-7', '10.2.2.2'));
  assert.equal(code(() => A.setPasswordDirect('nobody', 'some-pass-12')), 'not_found');
  assert.equal(code(() => A.setPasswordDirect('boss', 'short')), 'bad_password');

  // 계정이 아직 없는 처음 관리자(새 DATA_DIR)
  const { cfg } = await import('../dist/core/config.js');
  cfg.dataDir = mkdtempSync(tmpdir() + '/mxc-accounts2-');   // 설정은 시작할 때 읽으므로 값을 직접 바꾼다
  A._resetAccounts();
  const made = A.setPasswordDirect('Boss', 'first-admin-7');
  assert.equal(made.created, true);
  assert.equal(made.account.status, 'active');
  assert.equal(made.account.role, 'admin');
  assert.ok(A.passwordLogin('boss', 'first-admin-7', IP));
});

test('쓰기 요청 출처 — PUBLIC_URL·ALLOWED_ORIGINS 만, Origin 이 없으면 통과', async () => {
  const { cfg, originOk } = await import('../dist/core/config.js');
  const saved = [...cfg.allowedOrigins];
  assert.equal(originOk(undefined), true);
  assert.equal(originOk(cfg.publicUrl), true);
  assert.equal(originOk('http://evil.example'), false);
  cfg.allowedOrigins.push('http://localhost:5173');
  assert.equal(originOk('http://localhost:5173'), true);
  cfg.allowedOrigins.splice(0, cfg.allowedOrigins.length, ...saved);
});

test('가입 제한 — 같은 IP 는 1시간에 10번까지 시도', () => {
  const ip = '198.51.100.7';
  for (let i = 0; i < 10; i++) assert.equal(code(() => A.signup({ login: '1bad', name: 'x', email: 'r@example.com', password: 'abcdef12' }, ip)), 'bad_login');
  assert.equal(code(() => A.signup({ login: 'frank', name: 'F', email: 'frank@example.com', password: 'fine-pass-3' }, ip)), 'rate_limited');
  // 다른 IP 는 그대로
  assert.equal(A.signup({ login: 'frank', name: 'F', email: 'frank@example.com', password: 'fine-pass-3' }, '198.51.100.8').status, 'pending');
});
