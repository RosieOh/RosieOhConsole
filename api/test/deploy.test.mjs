import { test } from 'node:test';
import assert from 'node:assert/strict';

const { readKamalLog, readKamalJobs, fillInputs, VERSION_RE } = await import('../dist/deploy/kamal-log.js');
const { DEFAULT_REGISTRY } = await import('../dist/registry.js');

test('배포 로그 — 컨테이너 이름에서 대상·버전', () => {
  const log = [
    '▶ kamal deploy -c config/deploy-admin.yml -d testbed (버전 e2d0f6252f25)',
    '  INFO docker run --detach --restart unless-stopped --name demo-admin-web-testbed-e2d0f6252f25 --network kamal …',
  ].join('\n');
  assert.deepEqual(readKamalLog(log, 'deploy-admin-dev.yml'), { action: 'deploy', targets: [{ kamal: 'demo-admin', dest: 'testbed', version: 'e2d0f6252f25' }] });
});

test('되돌리기 — ▶ 줄이 있든 없든(공용 템플릿) rollback', () => {
  const name = '--name demo-api-web-prod-caa42353469d';
  assert.equal(readKamalLog(`▶ kamal rollback caa42353469d -d prod\n${name}`, 'rollback-prod.yml').action, 'rollback');
  assert.equal(readKamalLog(name, 'rollback-dev.yml').action, 'rollback');
  assert.equal(readKamalLog(`▶ kamal rollback caa42353469d -c config/deploy.yml -d prod\n${name}`, 'kamal-prod.yml').action, 'rollback');
});

test('check 처럼 아무것도 안 올린 실행은 대상이 없다', () => {
  assert.deepEqual(readKamalLog('전환 상태: 전환 완료\n커밋 상태: 201', 'kamal-prod.yml').targets, []);
});

test('같은 대상이 여러 번 찍히면 마지막 버전', () => {
  const r = readKamalLog('--name demo-web-testbed-aaaaaaaaaaaa\n--name demo-web-testbed-bbbbbbbbbbbb', 'deploy-dev.yml');
  assert.deepEqual(r.targets, [{ kamal: 'demo', dest: 'testbed', version: 'bbbbbbbbbbbb' }]);
});

test('되돌리기 입력 채우기·버전 형식', () => {
  assert.deepEqual(fillInputs({ target: 'admin', action: 'rollback', confirm: '{confirm}', version: '{version}' }, { version: 'abcdef012345', confirm: 'demo-admin' }),
    { target: 'admin', action: 'rollback', confirm: 'demo-admin', version: 'abcdef012345' });
  assert.ok(VERSION_RE.test('abcdef012345'));
  assert.ok(!VERSION_RE.test('abcdef01234'));
  assert.ok(!VERSION_RE.test('abcdef012345; rm'));
});

test('레지스트리 — 운영 되돌리기는 모두 확인 이름이 있다', () => {
  for (const s of DEFAULT_REGISTRY) {
    const p = s.deploy?.prod?.rollback;
    if (p) assert.ok(p.confirm, `${s.key} 운영 되돌리기에 confirm 없음`);
  }
});

test('테스트 작업이 실패해도 배포 작업이 성공했으면 그 대상은 성공', () => {
  const r = readKamalJobs([{ log: 'FAIL test', ok: false }, { log: '--name demo-web-testbed-9c9bff6f047b', ok: true }], 'deploy-dev.yml');
  assert.deepEqual(r.targets, [{ kamal: 'demo', dest: 'testbed', version: '9c9bff6f047b', ok: true }]);
  const f = readKamalJobs([{ log: '--name demo-web-testbed-9c9bff6f047b\nhealth check failed', ok: false }], 'deploy-dev.yml');
  assert.equal(f.targets[0].ok, false);
});

test('되돌리기 하한 — 하한 버전이 처음 성공한 실행보다 먼저 배포된 후보만 막는다', async () => {
  const { blockedBy, firstRunOf } = await import('../dist/deploy/floor.js');
  const entries = [
    { id: 50, state: 'success', version: 'cccccccccccc' },
    { id: 40, state: 'failure', version: null },
    { id: 30, state: 'success', version: 'bbbbbbbbbbbb' },
    { id: 20, state: 'success', version: 'aaaaaaaaaaaa' },
    { id: 10, state: 'success', version: 'bbbbbbbbbbbb' },
  ];
  assert.equal(firstRunOf(entries, 'bbbbbbbbbbbb'), 10);
  assert.equal(firstRunOf(entries, 'dddddddddddd'), null);
  const floor = { version: 'aaaaaaaaaaaa', runId: 20, reason: '새 암호를 못 읽음', by: 'x', at: '' };
  // b 는 30 에도 다시 떴지만 처음 뜬 건 10 — 하한(a, 20)보다 먼저라 막힘
  assert.deepEqual(blockedBy(entries, ['bbbbbbbbbbbb', 'aaaaaaaaaaaa'], floor), { bbbbbbbbbbbb: '새 암호를 못 읽음' });
  assert.deepEqual(blockedBy(entries, ['bbbbbbbbbbbb'], null), {});
});

test('배포 실패 — 뒤에 성공하면 해결, 마지막 결과가 실패면 시간과 상관없이 남는다', async () => {
  const { openFailure, resolvedAt } = await import('../dist/deploy/failures.js');
  const r = (id, state, at) => ({ id, state, at });
  // 최신부터: 성공(3) ← 실패(2) ← 성공(1)
  const fixed = [r(3, 'success', '2026-10-12T05:00:00Z'), r(2, 'failure', '2026-10-12T03:11:00Z'), r(1, 'success', '2026-10-11T00:00:00Z')];
  assert.equal(openFailure(fixed), null);
  assert.deepEqual([...resolvedAt(fixed)], [[2, '2026-10-12T05:00:00Z']]);
  // 오래된 실패라도 마지막 결과면 남고, 취소는 건너뛴다
  const open = [r(9, 'cancelled', '2026-10-12T00:00:00Z'), r(8, 'failure', '2026-09-01T00:00:00Z'), r(7, 'success', '2026-08-31T00:00:00Z')];
  assert.equal(openFailure(open)?.id, 8);
  assert.equal(resolvedAt(open).size, 0);
  assert.equal(openFailure([]), null);
});

test('되돌리기 버전 설명 — 바로 전 버전, 릴리스 PR 제목 빼기', async () => {
  const { previousVersion, isReleaseTitle } = await import('../dist/deploy/versions.js');
  const e = (state, version) => ({ state, version });
  // 최신부터: c(성공) ← b(실패) ← b(성공) ← a(성공) ← a(성공)
  const runs = [e('success', 'c'), e('failure', 'b'), e('success', 'b'), e('success', 'a'), e('success', 'a')];
  assert.equal(previousVersion(runs, 'c'), 'b');
  assert.equal(previousVersion(runs, 'b'), 'a');
  assert.equal(previousVersion(runs, 'a'), null);
  assert.equal(previousVersion(runs, 'x'), null);
  assert.ok(isReleaseTitle('릴리스: 6218b22a0839 (콘솔 예약 #69)'));
  assert.ok(!isReleaseTitle('배포 상세 패널 개편'));
});

test('compose 배포 로그도 Kamal 과 같은 이름 규칙으로 읽힌다', () => {
  const log = '이미지 빌드\n교체: 9f54d29aabbc (바뀐 서비스만 재기동)\n--name demo-worker-web-prod-9f54d29aabbc\n완료: 9f54d29aabbc';
  assert.deepEqual(readKamalLog(log, '.github/workflows/deploy-prod.yml'), { targets: [{ kamal: 'demo-worker', dest: 'prod', version: '9f54d29aabbc' }], action: 'deploy' });
  assert.equal(readKamalLog(log, '.github/workflows/rollback-prod.yml').action, 'rollback');
});
