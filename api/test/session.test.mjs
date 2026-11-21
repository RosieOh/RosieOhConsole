// npm run build 뒤 실행 (dist 를 시험한다)
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SESSION_SECRET = 'x'.repeat(40);
process.env.CONSOLE_ADMINS = 'boss';
const { mkdtempSync } = await import('node:fs');
const { tmpdir } = await import('node:os');
process.env.DATA_DIR = mkdtempSync(tmpdir() + '/mxc-session-');
const { signSession, readSession, TTL_MS } = await import('../dist/auth/session.js');
const { setRole } = await import('../dist/access/access.js');
setRole('boss', 'dev1', 'viewer');   // 로그인은 권한 명단에 있는 사람만

test('서명한 세션을 다시 읽는다 — 관리자 여부 포함', () => {
  assert.deepEqual(readSession(signSession('boss')), { login: 'boss', role: 'admin', admin: true, deployer: true });
  assert.deepEqual(readSession(signSession('dev1')), { login: 'dev1', role: 'viewer', admin: false, deployer: false });
});

test('권한 명단에 없거나 빠지면 서명이 맞아도 익명', () => {
  assert.equal(readSession(signSession('stranger')), null);
  const v = signSession('dev9');
  setRole('boss', 'dev9', 'deployer');
  assert.equal(readSession(v)?.role, 'deployer');
  setRole('boss', 'dev9', 'none');
  assert.equal(readSession(v), null);
});

test('위조·만료·빈 값은 익명', () => {
  const v = signSession('dev1');
  const [body, sig] = v.split('.');
  const forged = Buffer.from(JSON.stringify({ login: 'boss', exp: Date.now() + 1e6 })).toString('base64url');
  assert.equal(readSession(`${forged}.${sig}`), null);
  assert.equal(readSession(`${body}.AAAA`), null);
  assert.equal(readSession(signSession('dev1', Date.now() - TTL_MS - 1)), null);
  assert.equal(readSession(undefined), null);
  assert.equal(readSession('garbage'), null);
});
