import { test } from 'node:test';
import assert from 'node:assert/strict';

const { toPipeline, pipelineQuery, deployState, suiteState, deployHostOf } = await import('../dist/flow/pipelines.js');

const T = { key: 'blog', name: '블로그', repo: 'RosieOh/blog', owner: 'RosieOh', repoName: 'blog', environment: 'github-pages', site: 'https://rosieoh.github.io/blog/' };
const run = (id, name, status, conclusion = null) => ({ app: { slug: 'github-actions' }, status, conclusion,
  workflowRun: { databaseId: id, url: `https://github.com/RosieOh/blog/actions/runs/${id}`, createdAt: '2026-11-22T01:00:00Z', updatedAt: '2026-11-22T01:02:00Z', workflow: { name } } });
const commit = (oid, msg, suites = []) => ({ oid, messageHeadline: msg, committedDate: '2026-11-22T00:59:00Z', checkSuites: { nodes: suites } });
const dep = (id, c, state, runId, creator = 'github-actions[bot]') => ({ databaseId: id, createdAt: '2026-11-22T01:01:00Z', creator: { login: creator },
  latestStatus: { state, createdAt: '2026-11-22T01:01:30Z', logUrl: runId ? `https://github.com/RosieOh/blog/actions/runs/${runId}/job/1` : 'https://x.vercel.app', environmentUrl: T.site }, commit: c });
const repo = (head, deps) => ({ defaultBranchRef: { target: head }, deployments: { nodes: deps } });   // deps: 옛것부터(GraphQL 순서)

const old = commit('a'.repeat(40), '옛 글', [run(10, 'Deploy Pages', 'COMPLETED', 'SUCCESS'), run(11, 'CI', 'COMPLETED', 'SUCCESS')]);
const oldDep = dep(1, old, 'SUCCESS', 10);

test('상태 바꾸기', () => {
  assert.equal(deployState('INACTIVE'), 'done');
  assert.equal(deployState('ERROR'), 'failed');
  assert.equal(deployState(null), 'queued');
  assert.equal(suiteState({ status: 'COMPLETED', conclusion: 'CANCELLED' }), 'failed');
  assert.equal(suiteState({ status: 'COMPLETED', conclusion: 'SKIPPED' }), 'skipped');
  assert.equal(suiteState({ status: 'QUEUED' }), 'queued');
});

test('끝난 배포 — 커밋·빌드·배포 모두 완료, 배포를 만든 워크플로 이름', () => {
  const p = toPipeline(T, repo(old, [oldDep]));
  assert.equal(p.provider, 'pages');
  assert.equal(p.active, false);
  assert.deepEqual([p.stages.commit.state, p.stages.build.state, p.stages.deploy.state], ['done', 'done', 'done']);
  assert.equal(p.stages.build.detail, 'Deploy Pages');
  assert.match(p.stages.commit.detail, /^aaaaaaa 옛 글/);
  assert.equal(p.history.length, 1);
});

test('main 최신 커밋에서 배포 워크플로가 도는 중 — 빌드 진행, 배포 대기', () => {
  const head = commit('b'.repeat(40), '새 글', [run(20, 'CI', 'COMPLETED', 'SUCCESS'), run(21, 'Deploy Pages', 'IN_PROGRESS')]);
  const p = toPipeline(T, repo(head, [oldDep]));
  assert.equal(p.active, true);
  assert.equal(p.stages.build.state, 'running');
  assert.equal(p.stages.build.detail, 'Deploy Pages');   // CI 가 아니라 배포 워크플로를 고른다
  assert.equal(p.stages.deploy.state, 'idle');
  assert.match(p.stages.commit.detail, /새 글/);
});

test('배포 워크플로가 실패 — 빌드 실패, 배포 안 함', () => {
  const head = commit('c'.repeat(40), '깨진 글', [run(30, 'Deploy Pages', 'COMPLETED', 'FAILURE')]);
  const p = toPipeline(T, repo(head, [oldDep]));
  assert.equal(p.active, false);
  assert.equal(p.stages.build.state, 'failed');
  assert.equal(p.stages.deploy.state, 'skipped');
  assert.equal(p.stages.build.url, 'https://github.com/RosieOh/blog/actions/runs/30');
});

test('최신 커밋에서 배포가 아닌 워크플로만 돌면 마지막 배포를 그대로 보인다', () => {
  const head = commit('d'.repeat(40), 'README', [run(40, 'CI', 'IN_PROGRESS')]);
  const p = toPipeline(T, repo(head, [oldDep]));
  assert.equal(p.active, false);
  assert.match(p.stages.commit.detail, /옛 글/);
});

test('배포 작업이 도는 중 — 빌드 완료, 배포 진행', () => {
  const p = toPipeline(T, repo(old, [dep(2, old, 'IN_PROGRESS', 10)]));
  assert.equal(p.active, true);
  assert.equal(p.stages.build.state, 'done');
  assert.equal(p.stages.deploy.state, 'running');
});

test('Vercel — 배포 상태 하나로 빌드·배포', () => {
  const V = { ...T, environment: 'Production' };
  const c = commit('e'.repeat(40), '글');
  const going = toPipeline(V, repo(c, [dep(3, c, 'IN_PROGRESS', 0, 'vercel')]));
  assert.equal(going.provider, 'vercel');
  assert.equal(going.active, true);
  assert.equal(going.stages.build.state, 'running');
  const failed = toPipeline(V, repo(c, [dep(3, c, 'FAILURE', 0, 'vercel')]));
  assert.equal(failed.stages.build.state, 'failed');
  assert.equal(failed.stages.deploy.state, 'skipped');
});

test('배포 기록 없음·저장소 없음', () => {
  const none = toPipeline(T, repo(old, []));
  assert.equal(none.stages.deploy.detail, '배포 기록 없음');
  assert.equal(none.lastDeployAt, null);
  const gone = toPipeline(T, null);
  assert.ok(gone.error);
  assert.equal(gone.active, false);
});

test('이력은 새것부터', () => {
  const c2 = commit('f'.repeat(40), '둘째', [run(50, 'Deploy Pages', 'COMPLETED', 'SUCCESS')]);
  const p = toPipeline(T, repo(c2, [oldDep, dep(5, c2, 'SUCCESS', 50)]));
  assert.deepEqual(p.history.map((h) => h.id), [5, 1]);
});

test('질의 — 별칭마다 저장소·환경이 들어가고 문자열은 이스케이프된다', () => {
  const q = pipelineQuery([T, { ...T, repoName: 'we"ird', environment: 'Production' }]);
  assert.match(q, /r0: repository\(owner: "RosieOh", name: "blog"\)/);
  assert.match(q, /r1: repository\(owner: "RosieOh", name: "we\\"ird"\)/);
  assert.match(q, /environments: \["Production"\]/);
});

test('배포 대상 — 주소로 GitHub Pages·Vercel·그 밖의 호스트', () => {
  assert.equal(deployHostOf('https://rosieoh.github.io/x/', 'github-pages').id, 'v:host-pages');
  assert.equal(deployHostOf(undefined, 'github-pages').name, 'GitHub Pages');
  assert.equal(deployHostOf('https://rosiesblog.vercel.app', 'Production').id, 'v:host-vercel');
  const own = deployHostOf('https://console.example.com', 'production');
  assert.equal(own.id, 'v:host-console.example.com');
  assert.equal(own.name, 'console.example.com');
  assert.equal(deployHostOf('not a url', 'Staging').id, 'v:host-staging');
});
