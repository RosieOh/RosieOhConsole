import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

process.env.DATA_DIR = mkdtempSync(tmpdir() + '/mxc-build-notify-');
const { buildRecipients, changeBuildNotify, getBuildNotify, _resetBuildNotifyStore } = await import('../dist/build-notify/build-notify.js');
const { BuildNotifyController } = await import('../dist/build-notify/build-notify.controller.js');
const { AuthGuard } = await import('../dist/auth/auth.guard.js');

test('처음에는 켜져 있고 받는 사람이 없다', () => {
  assert.deepEqual(buildRecipients(), { on: true, to: [] });
});

test('추가는 소문자로, 같은 주소는 한 번만, 빼기와 끄기', () => {
  const a = changeBuildNotify('owner1', { add: ' Dev1@Example.com ' });
  assert.equal(a.to[0].email, 'dev1@example.com');
  assert.equal(a.to[0].by, 'owner1');
  changeBuildNotify('owner1', { add: 'dev2@example.com' }, a.rev);
  assert.throws(() => changeBuildNotify('owner1', { add: 'dev1@example.com' }), /이미/);
  assert.deepEqual(buildRecipients(), { on: true, to: ['dev1@example.com', 'dev2@example.com'] });
  changeBuildNotify('owner1', { remove: 'DEV1@example.com' });
  const off = changeBuildNotify('admin2', { on: false });
  assert.equal(off.by, 'admin2');
  assert.deepEqual(buildRecipients(), { on: false, to: ['dev2@example.com'] });
});

test('형식, 없는 주소, rev, 빈 요청 검사', () => {
  assert.throws(() => changeBuildNotify('owner1', { add: 'not-mail' }), /형식/);
  assert.throws(() => changeBuildNotify('owner1', { add: 'a@example.com, b@example.com' }), /형식/);
  assert.throws(() => changeBuildNotify('owner1', { remove: 'nobody@example.com' }), /없는/);
  assert.throws(() => changeBuildNotify('owner1', { on: 'yes' }), /켜기 또는 끄기/);
  assert.throws(() => changeBuildNotify('owner1', { on: true }, 0), /먼저/);
  assert.throws(() => changeBuildNotify('owner1', {}), /바꿀 것/);
});

test('파일에 남아 다시 읽어도 그대로', () => {
  const before = getBuildNotify();
  _resetBuildNotifyStore();
  assert.deepEqual(getBuildNotify(), before);
  assert.equal(JSON.parse(readFileSync(process.env.DATA_DIR + '/build-notify.json', 'utf8')).rev, before.rev);
});

test('빌드가 읽는 주소만 로그인 없이, 보기와 바꾸기는 관리자만', () => {
  const p = BuildNotifyController.prototype;
  assert.equal(Reflect.getMetadata('__guards__', BuildNotifyController), undefined);
  assert.equal(Reflect.getMetadata('__guards__', p.recipients), undefined);
  for (const h of [p.get, p.change]) {
    assert.deepEqual(Reflect.getMetadata('__guards__', h), [AuthGuard]);
    assert.equal(Reflect.getMetadata('adminOnly', h), true);
  }
});
