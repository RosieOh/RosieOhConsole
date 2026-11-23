// 업무보드 — GitHub 이슈 → 카드(단계·깃발), /board/api 경로(가짜 GitHub) (npm run build 뒤)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { PassThrough } from 'node:stream';

process.env.DATA_DIR = mkdtempSync(tmpdir() + '/mxc-board-');
process.env.SESSION_SECRET = 'b'.repeat(40);
process.env.CONSOLE_ADMINS = 'boss';
process.env.GITHUB_OWNER = 'demo-owner';
process.env.GITHUB_TOKEN = 'read-token';
process.env.GITHUB_WRITE_TOKEN = 'write-token';
process.env.BOARD_DEFAULT_REPO = 'demo-repo';
const D = await import('../dist/board/derive.js');
const { BoardService, isoWeek } = await import('../dist/board/board.service.js');
const { signSession } = await import('../dist/auth/session.js');
const { setRole } = await import('../dist/access/access.js');
const { cfg } = await import('../dist/core/config.js');
setRole('boss', 'dev1', 'viewer');

const NOW = Date.parse('2026-11-21T12:00:00Z');
const issue = (o = {}) => ({
  number: 1, title: '일', url: 'https://github.com/demo-owner/demo-repo/issues/1', state: 'OPEN', stateReason: null,
  createdAt: '2026-11-20T00:00:00Z', updatedAt: '2026-11-20T00:00:00Z', closedAt: null,
  assignees: { nodes: [] }, labels: { nodes: [] }, milestone: null, closedByPullRequestsReferences: { nodes: [] }, ...o,
});
const pr = (o = {}) => ({ number: 9, state: 'OPEN', isDraft: false, merged: false, reviewDecision: null, mergeable: 'MERGEABLE', commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] }, ...o });

test('단계 짐작 — 닫힘·머지·승인·리뷰·초안·계획·접수', () => {
  assert.equal(D.derive(issue({ state: 'CLOSED', stateReason: 'COMPLETED' })).stage, 'done');
  assert.equal(D.derive(issue({ state: 'CLOSED', stateReason: 'NOT_PLANNED' })).stage, 'cancelled');
  assert.equal(D.derive(issue({ closedByPullRequestsReferences: { nodes: [pr({ state: 'MERGED', merged: true })] } })).stage, 'awaiting_deploy');
  assert.equal(D.derive(issue({ closedByPullRequestsReferences: { nodes: [pr({ reviewDecision: 'APPROVED' })] } })).stage, 'ready_to_merge');
  assert.equal(D.derive(issue({ closedByPullRequestsReferences: { nodes: [pr()] } })).stage, 'review');
  assert.equal(D.derive(issue({ closedByPullRequestsReferences: { nodes: [pr({ isDraft: true })] } })).stage, 'started');
  assert.equal(D.derive(issue({ assignees: { nodes: [{ login: 'a' }] } })).stage, 'planned');
  assert.equal(D.derive(issue()).stage, 'intake');
});

test('카드 — 사람 라벨이 이기고, 깃발·지연·정체·라벨 2개', () => {
  const c = D.toCard('demo-repo', issue({
    labels: { nodes: [{ name: '단계/착수' }, { name: '막힘' }, { name: '단계/리뷰 중' }] },
    milestone: { title: 'v1', dueOn: '2026-11-01T00:00:00Z' }, updatedAt: '2026-11-01T00:00:00Z', stateReason: 'REOPENED',
    closedByPullRequestsReferences: { nodes: [pr({ reviewDecision: 'CHANGES_REQUESTED', mergeable: 'CONFLICTING', commits: { nodes: [{ commit: { statusCheckRollup: { state: 'FAILURE' } } }] } })] },
  }), NOW);
  assert.equal(c.stage, 'started');
  assert.equal(c.manual, true);
  assert.equal(c.derivedStage, 'review');
  assert.equal(c.disagree, true);
  assert.equal(c.dupStage, true);
  assert.deepEqual(c.flags.sort(), ['blocked', 'changes_requested', 'ci_failed', 'conflict', 'reopened']);
  assert.equal(c.overdue, true);
  assert.equal(c.stale, true);
  assert.deepEqual(D.stageLabels(['bug', '단계/착수', '단계/리뷰 중'], 'done'), ['bug', '단계/완료']);
  assert.deepEqual(D.stageLabels(['bug', '단계/착수'], null), ['bug']);
});

test('주간보고 초안·ISO 주', () => {
  const since = Date.parse('2026-11-16T00:00:00Z');
  const done = D.toCard('r', issue({ number: 2, title: '끝난 일', state: 'CLOSED', stateReason: 'COMPLETED', closedAt: '2026-11-18T00:00:00Z' }), NOW);
  const doing = D.toCard('r', issue({ number: 3, title: '하는 일', closedByPullRequestsReferences: { nodes: [pr()] } }), NOW);
  const t = D.draftReport([done, doing], since);
  assert.match(t, /\[실적\]\n- 끝난 일 \(#2\)/);
  assert.match(t, /\[진행\]\n- 하는 일 \(#3\) — 리뷰 중/);
  assert.match(t, /\[계획\]\n- 없음/);
  assert.equal(isoWeek(Date.parse('2026-11-21T12:00:00')).key, '2026-W47');
  assert.equal(isoWeek(Date.parse('2027-01-01T12:00:00')).key, '2026-W53');
});

// ── 경로 — 가짜 요청·응답·GitHub ──
function call(svc, { method = 'GET', url, login = 'boss', body, origin }) {
  const req = new PassThrough();
  Object.assign(req, { method, url, cookies: login ? { mxc: signSession(login) } : {}, get: (h) => (h.toLowerCase() === 'origin' ? origin : undefined) });
  if (body !== undefined) req.end(JSON.stringify(body)); else req.end();
  return new Promise((resolve) => {
    const res = { headersSent: false, statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.headersSent = true; resolve({ status: this.statusCode, body: b }); } };
    svc.handle(req, res);
  });
}
function fakeGitHub(state) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url), m = init.method || 'GET';
    calls.push({ u, m, body: init.body ? JSON.parse(init.body) : null });
    const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });
    if (u.endsWith('/graphql')) return json({ data: { repository: {
      open: { nodes: [issue({ number: 1, title: '열린 일', labels: { nodes: [{ name: 'bug' }, { name: '단계/착수' }] }, assignees: { nodes: [{ login: 'dev1' }] } }), issue({ number: 4, title: '남의 일' })] },
      closed: { nodes: [issue({ number: 2, title: '닫힌 일', state: 'CLOSED', stateReason: 'COMPLETED', closedAt: new Date().toISOString() })] },
      pullRequests: { nodes: [{ number: 7, title: '연결 안 된 PR', url: 'u', isDraft: false, updatedAt: '2026-11-20T00:00:00Z', author: { login: 'dev1' }, closingIssuesReferences: { totalCount: 0 } },
        { number: 8, title: '연결된 PR', url: 'u', isDraft: false, updatedAt: null, author: { login: 'dev1' }, closingIssuesReferences: { totalCount: 1 } }] },
    } } });
    const im = u.match(/issues\/(\d+)$/);
    if (im && m === 'GET') return json({ number: Number(im[1]), labels: state.labels.map((name) => ({ name })), assignees: Number(im[1]) === 1 ? [{ login: 'dev1' }] : [] });
    if (u.endsWith('/labels') && m === 'POST') return json({}, 422);   // 이미 있음
    if (u.match(/issues\/\d+\/labels$/) && m === 'PUT') return json([]);
    if (im && m === 'PATCH') return json({});
    return json({}, 404);
  };
  return calls;
}

test('보드 읽기 — 단계 칸·미연결 PR·읽기 전용 아님', async () => {
  fakeGitHub({ labels: [] });
  const svc = new BoardService();
  const r = await call(svc, { url: '/api/board' });
  assert.equal(r.status, 200);
  const col = (k) => r.body.columns.find((c) => c.key === k).cards.map((c) => c.number);
  assert.deepEqual(col('started'), [1]);
  assert.deepEqual(col('done'), [2]);
  assert.deepEqual(col('intake'), [4]);
  assert.deepEqual(r.body.unlinked.map((u) => u.number), [7]);
  assert.equal(r.body.readonly, false);
  assert.equal((await call(svc, { url: '/api/me' })).body.admin, true);
  assert.equal((await call(svc, { url: '/api/board', login: null })).status, 401);
});

test('옮기기·막힘·닫기 — 담당자·관리자만, 단계 라벨은 하나만, 읽기 전용이면 거절', async () => {
  const calls = fakeGitHub({ labels: ['bug', '단계/착수'] });
  const svc = new BoardService();
  const O = cfg.publicUrl;
  const mv = await call(svc, { method: 'POST', url: '/api/move', login: 'dev1', origin: O, body: { repo: 'demo-repo', number: 1, to: 'review' } });
  assert.equal(mv.status, 200, JSON.stringify(mv.body));
  assert.deepEqual(mv.body.labels, ['bug', '단계/리뷰 중']);
  assert.ok(calls.some((c) => c.m === 'POST' && c.u.endsWith('/repos/demo-owner/demo-repo/labels') && c.body.name === '단계/리뷰 중'));
  // 담당자가 아니면 거절, 관리자는 된다
  assert.equal((await call(svc, { method: 'POST', url: '/api/move', login: 'dev1', origin: O, body: { repo: 'demo-repo', number: 4, to: 'done' } })).status, 403);
  assert.equal((await call(svc, { method: 'POST', url: '/api/move', login: 'boss', origin: O, body: { repo: 'demo-repo', number: 4, to: 'done' } })).status, 200);
  // 막힘 켜기, 기록 따르기, 닫기
  assert.equal((await call(svc, { method: 'POST', url: '/api/blocked', login: 'dev1', origin: O, body: { repo: 'demo-repo', number: 1 } })).body.blocked, true);
  assert.deepEqual((await call(svc, { method: 'POST', url: '/api/follow', login: 'dev1', origin: O, body: { repo: 'demo-repo', number: 1 } })).body.labels, ['bug']);
  assert.equal((await call(svc, { method: 'POST', url: '/api/state', login: 'dev1', origin: O, body: { repo: 'demo-repo', number: 1, state: 'closed' } })).status, 200);
  // 따라가지 않는 저장소·다른 출처·없는 단계
  assert.equal((await call(svc, { method: 'POST', url: '/api/move', origin: O, body: { repo: 'other', number: 1, to: 'done' } })).status, 400);
  assert.equal((await call(svc, { method: 'POST', url: '/api/move', origin: 'https://evil.example', body: { repo: 'demo-repo', number: 1, to: 'done' } })).status, 403);
  assert.equal((await call(svc, { method: 'POST', url: '/api/move', origin: O, body: { repo: 'demo-repo', number: 1, to: 'nope' } })).status, 400);
  // 쓰기 토큰이 없으면 읽기 전용
  const saved = cfg.githubWriteToken; cfg.githubWriteToken = '';
  try { assert.equal((await call(svc, { method: 'POST', url: '/api/move', origin: O, body: { repo: 'demo-repo', number: 1, to: 'done' } })).status, 403); }
  finally { cfg.githubWriteToken = saved; }
});

test('주간보고·저장소·열람 명단', async () => {
  fakeGitHub({ labels: [] });
  const svc = new BoardService();
  const O = cfg.publicUrl;
  let rp = (await call(svc, { url: '/api/report' })).body;
  assert.equal(rp.projects[0].name, 'demo-repo');
  assert.equal(rp.projects[0].status, 'auto');
  assert.match(rp.projects[0].auto, /\[실적\]\n- 닫힌 일 \(#2\)/);
  await call(svc, { method: 'POST', url: '/api/report', origin: O, body: { action: 'save', project: 'demo-repo', text: '고친 보고' } });
  rp = (await call(svc, { url: '/api/report' })).body;
  assert.equal(rp.projects[0].status, 'edited'); assert.equal(rp.projects[0].text, '고친 보고');
  await call(svc, { method: 'POST', url: '/api/report', origin: O, body: { action: 'reflect', project: 'demo-repo', text: '고친 보고' } });
  assert.equal((await call(svc, { url: '/api/report' })).body.projects[0].status, 'reflected');
  await call(svc, { method: 'POST', url: '/api/report', origin: O, body: { action: 'reset', project: 'demo-repo' } });
  assert.equal((await call(svc, { url: '/api/report' })).body.projects[0].status, 'auto');

  // 저장소 추가·종류·빼기는 관리자만
  assert.equal((await call(svc, { method: 'POST', url: '/api/repos', login: 'dev1', origin: O, body: { action: 'add', repo: 'x' } })).status, 403);
  await call(svc, { method: 'POST', url: '/api/repos', origin: O, body: { action: 'add', repo: 'MarioOrg/team', type: 'web' } });
  assert.deepEqual((await call(svc, { url: '/api/repos?q=' })).body.tracked.map((t) => t.repo), ['demo-repo', 'MarioOrg/team']);
  await call(svc, { method: 'POST', url: '/api/repos', origin: O, body: { action: 'remove', repo: 'MarioOrg/team' } });

  // 열람 명단에 넣으면 명단 밖 사람은 못 본다(관리자는 늘 본다)
  await call(svc, { method: 'POST', url: '/api/viewers', origin: O, body: { action: 'add', login: 'someone' } });
  assert.equal((await call(svc, { url: '/api/board', login: 'dev1' })).status, 403);
  assert.equal((await call(svc, { url: '/api/me', login: 'dev1' })).body.viewer, false);
  assert.equal((await call(svc, { url: '/api/board' })).status, 200);
  await call(svc, { method: 'POST', url: '/api/viewers', origin: O, body: { action: 'remove', login: 'someone' } });
  assert.equal((await call(svc, { url: '/api/board', login: 'dev1' })).status, 200);
});
