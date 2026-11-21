import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

process.env.DATA_DIR = mkdtempSync(tmpdir() + '/mxc-access-');
process.env.CONSOLE_ADMINS = 'Boss';
const { roleOf, setRole, listAccess, refreshAdmins, canDeploy, isAllowed } = await import('../dist/access/access.js');

test('처음 관리자는 늘 관리자이고 화면에서 못 바꾼다', () => {
  assert.equal(roleOf('boss'), 'admin');
  assert.throws(() => setRole('boss', 'BOSS', 'viewer'), /처음 관리자/);
});

test('역할 부여·회수 — 관리자 목록, 로그인 허용 명단', () => {
  assert.equal(roleOf('dev1'), 'viewer');
  assert.equal(isAllowed('dev1'), false);
  setRole('boss', 'Dev1', 'deployer');
  assert.equal(roleOf('dev1'), 'deployer');
  assert.ok(canDeploy(roleOf('dev1')));
  assert.equal(isAllowed('dev1'), true);
  setRole('boss', 'dev2', 'admin');
  assert.ok(refreshAdmins().includes('dev2') && refreshAdmins().includes('boss'));
  setRole('boss', 'dev2', 'viewer');
  assert.ok(!refreshAdmins().includes('dev2'));
  assert.equal(listAccess().users.dev2.role, 'viewer');   // 보기도 명단에 남는다(로그인 허용)
  assert.equal(isAllowed('dev2'), true);
  setRole('boss', 'dev2', 'none');
  assert.equal(listAccess().users.dev2, undefined);
  assert.equal(isAllowed('dev2'), false);
  assert.equal(isAllowed('BOSS'), true);
  assert.equal(listAccess().users.dev1.by, 'boss');
  assert.ok(!canDeploy('viewer'));
});

test('형식·역할·rev 검사', () => {
  assert.throws(() => setRole('boss', '../x', 'admin'), /형식/);
  assert.throws(() => setRole('boss', 'dev3', 'root'), /역할/);
  assert.throws(() => setRole('boss', 'dev3', 'admin', 0), /먼저/);
});
