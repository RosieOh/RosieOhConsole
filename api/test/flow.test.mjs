import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

process.env.DATA_DIR = mkdtempSync(tmpdir() + '/mxc-flow-');
const { stageOf, sliceLog, STAGES } = await import('../dist/flow/lanes.js');
const { tracksOf, lostRunIds } = await import('../dist/flow/flow.service.js');
const { planOf, issueRefs, checkAt } = await import('../dist/promote/plan.js');
const { DEFAULT_STORE } = await import('../dist/catalog/types.js');

const st = (name, status, conclusion = null) => ({ name, status, conclusion });

test('실행 중 단계 → 갈래 단계', () => {
  const r = stageOf('testbed', [st('Set up job', 'completed', 'success'), st('테스트', 'completed', 'success'), st('빌드', 'in_progress'), st('Kamal 배포', 'waiting')]);
  assert.equal(STAGES.testbed[r.index].id, 'build');
  assert.equal(r.current, '빌드');
  const f = stageOf('prod', [st('입력 확인', 'completed', 'success'), st('Kamal', 'completed', 'failure'), st('바깥에서 확인', 'completed', 'skipped')]);
  assert.equal(STAGES.prod[f.index].id, 'deploy');
  assert.equal(f.failedStep, 'Kamal');
});

test('부모앱 — OTA·스토어 갈래', () => {
  const ota = stageOf('store', [st('판정 — OTA 인지 스토어인지', 'completed', 'success'), st('OTA 배포 (JS 만 바뀜)', 'in_progress'), st('스토어 빌드 · 업로드 · 태그 (네이티브 바뀜)', 'waiting')]);
  assert.equal(ota.branch, 'ota');
  assert.equal(STAGES.store[ota.index].id, 'ship');
  const store = stageOf('store', [st('OTA 배포 (JS 만 바뀜)', 'completed', 'skipped'), st('스토어 빌드 · 업로드 · 태그 (네이티브 바뀜)', 'completed', 'success'), st('태그 push · 버전 파일 커밋', 'in_progress')]);
  assert.equal(store.branch, 'store');
  assert.equal(STAGES.store[store.index].id, 'tag');
});

test('앱 테스트 빌드 갈래(#182): 자녀앱, 부모앱 APK, 부모앱 iOS 의 단계 이름', () => {
  const id = (r) => STAGES.apptest[r.index].id;
  // 자녀앱(app-device-apk-testbed)
  const dev = (names, at) => names.map((n, i) => st(n, i < at ? 'completed' : i === at ? 'in_progress' : 'waiting', i < at ? 'success' : null));
  const device = ['도구 확인', '테스트 버전 올림', '테스트배드 서버로', '의존성', '서명 APK 빌드', 'GitHub 프리릴리스에 APK 첨부'];
  assert.equal(id(stageOf('apptest', dev(device, 1))), 'prepare');
  assert.equal(id(stageOf('apptest', dev(device, 4))), 'build');
  assert.equal(id(stageOf('apptest', dev(device, 5))), 'upload');
  assert.equal(stageOf('apptest', dev(device, 4)).current, '서명 APK 빌드');
  // 예전 실행의 "버전 읽기" 도 준비
  assert.equal(id(stageOf('apptest', [st('도구 확인', 'completed', 'success'), st('버전 읽기', 'in_progress')])), 'prepare');
  // 부모앱 APK(app-store-testbed-apk)
  const apk = ['도구 경로 (Homebrew, rbenv, JDK, Android SDK)', '릴리즈 서명 설정 (GitHub 시크릿, 없으면 러너 로컬 ~/Key/<appId>/, 그것도 없으면 저장소 서명 설정)', '버전 읽기', '의존성', '테스트배드 APK 빌드 (npm run build:android -- dev)', '서명 확인', 'GitHub 프리릴리스에 APK 첨부'];
  assert.equal(id(stageOf('apptest', dev(apk, 1))), 'prepare');
  assert.equal(id(stageOf('apptest', dev(apk, 4))), 'build');
  assert.equal(id(stageOf('apptest', dev(apk, 6))), 'upload');
  // 부모앱 iOS(app-store-testbed-ios): "버전 정하기 (... 빌드 번호 ...)" 는 준비, "TestFlight 올리기 (... 운영 빌드 ...)" 는 올림
  const ios = ['도구 경로 (Homebrew, rbenv, JDK, Android SDK)', '의존성', 'codegen 검증 (네이버, Blur Fabric 컴포넌트 등록 확인)', '버전 정하기 (운영 main 의 다음 패치, 빌드 번호는 실행 번호)', 'iOS 테스트배드 빌드 (저장소 runBuild, App Store 내보내기)', '서명 확인 (TestFlight 용 Apple Distribution)', 'TestFlight 올리기 (그 버전에 운영 빌드가 있으면 건너뜀)', '릴리스 기록에 iOS 줄 붙이기'];
  assert.equal(id(stageOf('apptest', dev(ios, 3))), 'prepare');
  assert.equal(id(stageOf('apptest', dev(ios, 4))), 'build');
  assert.equal(id(stageOf('apptest', dev(ios, 6))), 'upload');
  assert.equal(id(stageOf('apptest', dev(ios, 7))), 'upload');
});

test('단계 시각으로 로그 자르기', () => {
  const log = ['2026-10-08T08:17:00.0000000Z 앞', '2026-10-08T08:18:00.0000000Z 안1', '2026-10-08T08:18:30.0000000Z 안2', '2026-10-08T08:20:00.0000000Z 뒤'].join('\n');
  assert.equal(sliceLog(log, '2026-10-08T08:18:00Z', '2026-10-08T08:18:40Z'), '안1\n안2');
});

test('배포 갈래 — 한 저장소의 한 워크플로는 한 갈래', () => {
  // 같은 실행이 두 갈래로 읽히지 않게(기본 카탈로그가 비면 빈 목록이라도 지켜진다)
  const seen = new Map();
  for (const t of tracksOf()) {
    const k = `${t.repo}|${t.workflow}`;
    assert.ok(!seen.has(k) || seen.get(k) === t.lane, `${k} 가 두 갈래`);
    seen.set(k, t.lane);
  }
});

test('운영 승격 계획 — main push 배포는 머지=배포, kamal-prod 는 머지 뒤 deploy', () => {
  const rb = (confirm, extra = {}) => ({ workflow: 'kamal-prod.yml', ref: 'main', inputs: { ...extra, action: 'rollback', confirm: '{confirm}', version: '{version}' }, confirm });
  const push = { key: 'demo-api', name: 'Demo API', kind: 'backend', repo: 'demo-api', parent: 'p', order: 1,
    deploy: { prod: { kamal: 'demo-api', dest: 'prod', workflows: ['deploy.yml'], rollback: { workflow: 'rollback.yml', ref: 'main', inputs: { version: '{version}' }, confirm: 'demo-api' } } } };
  const dispatch = { key: 'demo-web', name: 'Demo Web', kind: 'web', repo: 'demo-web', parent: 'p', order: 2,
    deploy: { testbed: { kamal: 'demo-web', dest: 'testbed', workflows: ['deploy-dev.yml'] }, prod: { kamal: 'demo-web', dest: 'prod', workflows: ['kamal-prod.yml'], rollback: rb('demo-web') } } };
  const shared = { key: 'demo-admin', name: 'Demo Admin', kind: 'web', repo: 'demo-api', parent: 'p', order: 3,
    deploy: { prod: { kamal: 'demo-admin', dest: 'prod', workflows: ['kamal-prod.yml'], rollback: rb('demo-admin', { target: 'admin' }) } } };
  assert.equal(planOf(push).method, 'merge-push');
  assert.equal(planOf(push).watch, 'deploy.yml');
  assert.equal(planOf(push).confirm, 'demo-api');
  assert.equal(planOf(push).source, 'dev');                // 테스트배드가 없으면 dev 끝
  assert.equal(planOf(dispatch).method, 'merge-dispatch');
  assert.equal(planOf(dispatch).source, 'testbed');
  assert.deepEqual(planOf(dispatch).dispatch.inputs, { action: 'deploy', confirm: 'demo-web' });
  assert.deepEqual(planOf(shared).dispatch.inputs, { target: 'admin', action: 'deploy', confirm: 'demo-admin' });
  assert.equal(planOf({ key: 's', name: 's', kind: 'store-app', repo: 'demo-parents', parent: 'p', order: 1, store: DEFAULT_STORE }).lane, 'store');
  assert.equal(planOf({ key: 'd', name: 'd', kind: 'device-app', repo: 'demo-app', parent: 'p', order: 1 }).lane, 'apk');
  assert.equal(planOf({ key: 'w', name: 'w', kind: 'web', repo: 'x', parent: 'p', order: 1 }), null);
});

test('이슈 번호·예약 시각', () => {
  assert.deepEqual(issueRefs(['#12 고침', 'Merge pull request \'#3 x\' (#4)', 'v1.2#5', 'fix (#7)']), [3, 4, 7, 12]);
  const now = Date.parse('2026-10-12T00:00:00Z');
  assert.equal(checkAt('2026-10-12T00:10:00Z', now), null);
  assert.match(checkAt('2026-10-11T23:00:00Z', now), /지난/);
  assert.match(checkAt('2026-11-12T00:00:00Z', now), /14일/);
  assert.match(checkAt('nope', now), /올바르지/);
});

test('최근 목록 밖으로 밀린 진행 중 실행: 같은 저장소의 running 만 고른다 (#171)', () => {
  const run = (id, repo, state) => ({ id, repo, state });
  const active = [run(9131, 'demo-api', 'running'), run(9125, 'demo-api', 'success'), run(9306, 'demo-api', 'running'), run(8516, 'demo-auth', 'running')];
  const listed = new Set([9306, 9316, 9339, 9351, 9364]);
  assert.deepEqual(lostRunIds(active, 'demo-api', listed), [9131]);
  assert.deepEqual(lostRunIds(active, 'demo-auth', new Set([8516])), []);
  assert.deepEqual(lostRunIds([], 'demo-api', listed), []);
});
