// GitHub Deployments 트랙(Pages·Vercel) — 배포 기록 → 배포 줄, 카탈로그 연결, 운영 반영 제외 (npm run build 뒤)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

process.env.DATA_DIR = mkdtempSync(tmpdir() + '/mxc-depenv-');
const { toDeploymentRun } = await import('../dist/deploy/deploy.service.js');
const { DEFAULT_REGISTRY } = await import('../dist/registry.js');
const { planOf } = await import('../dist/promote/plan.js');

const d = { id: 7, sha: 'abcdef1234567890', ref: 'main', created_at: '2026-11-20T01:00:00Z', creator: { login: 'RosieOh' } };

test('배포 기록 → 배포 줄 — 상태 갈래와 버전(커밋 12자)', () => {
  const ok = toDeploymentRun(d, { state: 'success', created_at: '2026-11-20T01:02:00Z', environment_url: 'https://x.example' }, 'github-pages', 'https://github.com/o/r');
  assert.equal(ok.state, 'success'); assert.equal(ok.version, 'abcdef123456'); assert.equal(ok.url, 'https://x.example');
  assert.equal(ok.ended, '2026-11-20T01:02:00Z'); assert.equal(ok.actor, 'RosieOh'); assert.equal(ok.workflow, 'github-pages');
  assert.equal(toDeploymentRun(d, { state: 'inactive' }, 'e', 'w').state, 'success');   // 다음 배포로 밀려난 것도 성공했던 배포
  assert.equal(toDeploymentRun(d, { state: 'error' }, 'e', 'w').state, 'failure');
  assert.equal(toDeploymentRun(d, { state: 'in_progress' }, 'e', 'w').state, 'running');
  const none = toDeploymentRun(d, null, 'e', 'https://github.com/o/r');
  assert.equal(none.state, 'running'); assert.equal(none.ended, null); assert.equal(none.url, 'https://github.com/o/r/deployments');
});

test('카탈로그 — 배포 기록이 있는 7개는 운영 헬스와 GitHub Deployments 트랙, 운영 반영은 없다', () => {
  const live = DEFAULT_REGISTRY.filter((s) => s.deploy?.prod?.environment);
  assert.deepEqual(live.map((s) => s.key).sort(), ['betweenthelines', 'chagok-report', 'daedong', 'hoonshop', 'leeeung', 'otel-canary', 'rosietechblog']);
  for (const s of live) {
    assert.match(s.prod.health, /^https:\/\//);
    assert.deepEqual(s.deploy.prod.workflows, []);
    assert.equal(planOf(s), null);
  }
  assert.equal(DEFAULT_REGISTRY.find((s) => s.key === 'rosietechblog').deploy.prod.environment, 'Production');
});
