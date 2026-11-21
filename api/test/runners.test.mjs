// npm run build 뒤 실행 (dist 를 시험한다)
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { parseWorkflow, resolveLabel, runnerMatches, parseUses } = await import('../dist/runners/workflows.js');
const { statsFor, queueOf, record, uptime, toJob, WEEK } = await import('../dist/runners/stats.js');
const { placeOf, normName, retired } = await import('../dist/runners/known.js');

test('워크플로 — runs-on 문자열·목록, 공용 템플릿 호출과 입력', () => {
  const caller = parseWorkflow(`
name: deploy
on:
  push:
    branches: [dev]
  workflow_dispatch:
jobs:
  testbed:
    uses: demo-owner/ci-templates/.github/workflows/backend-kamal-testbed.yml@main
    with:
      destination: testbed
      runner-label: big
    secrets: inherit
  lint:
    runs-on: [backend-deploy, linux]
`);
  assert.equal(caller.name, 'deploy');
  assert.deepEqual(caller.triggers, ['push', 'workflow_dispatch']);
  assert.deepEqual(caller.jobs[0].uses, { owner: 'demo-owner', repo: 'ci-templates', path: '.github/workflows/backend-kamal-testbed.yml', ref: 'main' });
  assert.equal(caller.jobs[0].with['runner-label'], 'big');
  assert.deepEqual(caller.jobs[1].runsOn, ['backend-deploy', 'linux']);

  const tpl = parseWorkflow(`
on:
  workflow_call:
    inputs:
      runner-label:
        type: string
        default: parents-release
      dry-run:
        type: string
        default: 'false'
jobs:
  release:
    runs-on: \${{ inputs.runner-label }}
`);
  assert.deepEqual(tpl.inputDefaults, { 'runner-label': 'parents-release', 'dry-run': 'false' });
  assert.equal(resolveLabel(tpl.jobs[0].runsOn[0], tpl.inputDefaults), 'parents-release');
  assert.equal(resolveLabel(tpl.jobs[0].runsOn[0], { ...tpl.inputDefaults, 'runner-label': 'x' }), 'x');
  assert.equal(resolveLabel('${{ matrix.os }}', {}), null);
  assert.equal(parseUses('./local.yml'), null);
  assert.deepEqual(parseWorkflow('::: 깨짐 [').jobs, []);
});

test('러너 고르기 — 요청 라벨을 모두 가져야 한다', () => {
  assert.ok(runnerMatches(['parents-release', 'macos', 'ios'], ['parents-release']));
  assert.ok(runnerMatches(['backend-deploy:docker://node:20'], ['backend-deploy']));
  assert.ok(!runnerMatches(['macos'], ['macos', 'gpu']));
  assert.ok(!runnerMatches(['macos'], []));
});

test('작업 집계 — 24시간 수·성공·평균, 지금 도는 것, 대기열', () => {
  const now = Date.parse('2026-10-12T05:00:00Z');
  const j = (id, o) => toJob({ id, html_url: `https://github.com/demo-owner/repo${id}/actions/runs/1/jobs/${id}`, status: 'completed', conclusion: 'success', runner_name: 'Mac mini', ...o });
  const jobs = [
    j(1, { started_at: '2026-10-12T04:00:00Z', completed_at: '2026-10-12T04:10:00Z' }),
    j(2, { conclusion: 'failure', started_at: '2026-10-12T03:00:00Z', completed_at: '2026-10-12T03:02:00Z' }),
    j(3, { started_at: '2026-10-10T03:00:00Z', completed_at: '2026-10-10T03:02:00Z' }),          // 24시간 밖
    j(4, { conclusion: 'skipped', started_at: '2026-10-12T04:30:00Z', completed_at: '2026-10-12T04:30:00Z' }),
    j(5, { status: 'in_progress', conclusion: null, started_at: '2026-10-12T04:55:00Z' }),
    j(6, { status: 'waiting', conclusion: null, runner_name: undefined, created_at: '2026-10-12T04:40:00Z' }),
  ];
  assert.equal(jobs[0].repo, 'repo1');
  const s = statsFor('Mac mini', jobs, now, normName);
  assert.equal(s.count24h, 2); assert.equal(s.success24h, 1); assert.equal(s.failure24h, 1);
  assert.equal(s.avgSec24h, 360);
  assert.equal(s.active.length, 1);
  assert.equal(s.lastJob.id, 4);
  const q = queueOf(jobs, now);
  assert.equal(q.count, 1); assert.equal(q.oldestSec, 20 * 60);
});

test('가동률 — 바뀐 순간만 남기고 7일 창으로 비율', () => {
  const h = {};
  const t0 = Date.parse('2026-10-01T00:00:00Z');
  assert.equal(record(h, 'r', true, t0), true);
  assert.equal(record(h, 'r', true, t0 + 1000), false);          // 같은 상태는 남기지 않는다
  record(h, 'r', false, t0 + 6 * 3600e3);
  record(h, 'r', true, t0 + 8 * 3600e3);
  const u = uptime(h.r, t0 + 10 * 3600e3);
  assert.ok(Math.abs(u.ratio - 0.8) < 1e-9);
  record(h, 'r', false, t0 + WEEK + 9 * 3600e3);                   // 오래된 변화는 잘린다
  assert.ok(h.r.length <= 3);
  assert.equal(uptime(undefined), null);
});

test('러너 설명 — 모르면 추정 표시, 이름의 줄바꿈 없는 공백도 맞춘다', () => {
  const p = placeOf('my-runner');
  assert.equal(p.guess, true);
  assert.equal(p.kind, '미분류');
  assert.match(p.where, /GitHub/);
  assert.equal(normName('Mac\u00a0 mini '), 'mac mini');
  assert.ok(!retired('my-runner'));
});
