import { test } from 'node:test';
import assert from 'node:assert/strict';

const { mergeFlags, FLAG_TARGETS, summarizeFlags } = await import('../dist/flags/targets.js');

const f = (key, enabled, extra = {}) => ({ key, description: key + ' 설명', defaultValue: false, enabled, overridden: false, updatedBy: null, updatedAt: null, ...extra });

test('기능 스위치 — 환경별 목록을 스위치당 한 줄로', () => {
  const rows = mergeFlags([
    { env: 'testbed', configured: true, ok: true, flags: [f('console-test', true, { overridden: true, updatedBy: 'dev1' }), f('new-map', false)] },
    { env: 'prod', configured: true, ok: true, flags: [f('console-test', false)] },
  ]);
  assert.deepEqual(rows.map((r) => r.key), ['console-test', 'new-map']);
  assert.equal(rows[0].envs.testbed.enabled, true);
  assert.equal(rows[0].envs.prod.enabled, false);
  assert.equal(rows[1].envs.prod, null);          // 운영엔 아직 배포 안 된 스위치
});

test('연결 안 된 환경은 칸 자체가 없다', () => {
  const rows = mergeFlags([
    { env: 'testbed', configured: true, ok: true, flags: [f('console-test', false)] },
    { env: 'prod', configured: false, ok: false, flags: [] },
  ]);
  assert.equal('prod' in rows[0].envs, false);
});

test('연결 대상 — 토큰 환경변수 이름은 서로 다르다', () => {
  assert.equal(new Set(FLAG_TARGETS.map((t) => t.tokenEnv)).size, FLAG_TARGETS.length);
  for (const t of FLAG_TARGETS) assert.ok(['testbed', 'prod'].includes(t.env));
});

test('기능 스위치 — 흐름 도식 배지는 기본값과 다르게 켜 둔 것만 센다', () => {
  const v = (enabled, overridden, defaultValue = false) => ({ key: 'k', description: '', defaultValue, enabled, overridden, updatedBy: null, updatedAt: null });
  const row = (key, envs, defaultValue = false) => ({ key, description: '', defaultValue, envs });
  const out = summarizeFlags([
    { comp: 'demo-api', rows: [row('a', { prod: v(true, true), testbed: v(true, true) }), row('b', { prod: v(false, true), testbed: v(true, false) })] },
    { comp: 'demo-web', rows: [row('a', { prod: v(false, true, true), testbed: null }, true)] },   // 기본 켜짐을 끈 것도 센다
    { comp: 'demo-auth', rows: [row('a', { prod: v(false, false), testbed: v(false, true) })] },  // 바꿨지만 기본값과 같으면 안 센다
  ]);
  assert.deepEqual(out, { 'demo-api': [{ env: 'prod', on: 1 }, { env: 'testbed', on: 1 }], 'demo-web': [{ env: 'prod', on: 1 }] });
});
