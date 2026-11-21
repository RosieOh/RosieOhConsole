import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

process.env.DATA_DIR = mkdtempSync(tmpdir() + '/mxc-apkc-');
const { parseMessage, summarize } = await import('../dist/apks/changes.js');
const { statusOf, currentKnox, WHO_RE } = await import('../dist/apks/knox.js');

test('커밋 메시지 → 읽을 말', () => {
  assert.deepEqual(parseMessage('fix(child): 로그인 화면 폴드 펼침 레이아웃 — 로고/버전 균등배율', 'abcdef0123456789'),
    { kind: 'fix', title: '로그인 화면 폴드 펼침 레이아웃', detail: '로고/버전 균등배율', issue: undefined, sha: 'abcdef012345' });
  assert.equal(parseMessage('#3 fix(demo-app): 확정 전송 실패 시 재시도').issue, 3);
  assert.equal(parseMessage('chore(child): 버전 1.6.3 / 16003'), null);
  assert.equal(parseMessage('#3 chore: 1.1.1 (11001)'), null);
  assert.equal(parseMessage('Merge origin/main into feat/x'), null);
  assert.equal(parseMessage("Merge branch 'fix/x' — 인스타 딥링크 오차단").title, '인스타 딥링크 오차단');
  assert.equal(parseMessage("Merge pull request '[demo-app] 확정 전송' (#2) from feat/a into main").title, '확정 전송');
});

test('요약 — PR 머지 제목은 같은 커밋이 있으면 뺀다, 새 기능 먼저', () => {
  const s = summarize([
    { sha: '1', message: "Merge pull request '#7 SSO API 주소도 빌드별로 분기' (#8) from fix/7 into main" },
    { sha: '2', message: '#7 fix(x): SSO API 주소도 빌드별로 분기 — 디버그는 테스트배드' },
    { sha: '3', message: 'feat(x): 위치 1회 전송' },
    { sha: '4', message: 'chore: 버전 1.1.1' },
    { sha: '5', message: "Merge pull request '새 화면' (#9) from a into main" },
  ]);
  assert.deepEqual(s.map((c) => [c.kind, c.title]), [['feat', '위치 1회 전송'], ['fix', 'SSO API 주소도 빌드별로 분기'], ['other', '새 화면']]);
});

test('녹스 상태 — 적용됨 / QA 중 / 새 버전, 지금 녹스 버전', () => {
  assert.equal(statusOf(undefined), 'new');
  assert.equal(statusOf({ downloads: 2 }), 'qa');
  assert.equal(statusOf({ downloads: 2, knox: { at: 'x', by: 'a' } }), 'knox');
  assert.equal(currentKnox({ 'v1': { downloads: 1, knox: { at: '2026-10-01', by: 'a' } }, 'v2': { downloads: 1, knox: { at: '2026-10-05', by: 'b' } }, 'v3': { downloads: 1 } }).tag, 'v2');
  assert.ok(WHO_RE.test('김담당')); assert.ok(!WHO_RE.test('<script>'));
});

test('버전 올림 커밋으로 버전별 내역 나누기', async () => {
  const { bumpVersion, splitVersions } = await import('../dist/apks/changes.js');
  assert.equal(bumpVersion('chore(child): 버전 1.6.3 / 16003'), '1.6.3');
  assert.equal(bumpVersion('chore(child): 버전 1.6.002 (16002), #3/#4/#6 머지 반영'), '1.6.2');
  assert.equal(bumpVersion('chore: 자녀앱 버전 4.4.3 (versionCode 44013)'), '4.4.3');
  assert.equal(bumpVersion('chore: 1.3.1 (versionCode 13001)'), '1.3.1');
  assert.equal(bumpVersion('chore(release): v1.1.1 [skip ci]'), '1.1.1');
  assert.equal(bumpVersion('chore(child): versionName 컨벤션 교정, 1.6.2 → 1.6.002'), null);
  assert.equal(bumpVersion('fix(child): 로그인 화면'), null);
  const c = (message, i) => ({ sha: 's' + i, message, date: `2026-09-${String(20 - i).padStart(2, '0')}` });
  const list = ['chore(child): 버전 1.6.3 / 16003', 'fix(child): 로그인', 'chore(child): 버전 1.6.002 (16002)', 'chore(child): versionName 교정', 'chore(child): 버전 1.6.2 (16002)', 'feat(child): 커버', 'chore(child): 버전 1.5.8 (15030)', 'fix: 옛것'].map(c);
  const v = splitVersions(list, 'v1.6.3');
  assert.deepEqual(v.map((x) => [x.version, x.commits.length]), [['1.6.3', 2], ['1.6.2', 4], ['1.5.8', 2]]);
  assert.equal(v[1].date, '2026-09-18');
  // 최신 릴리스 태그보다 새 커밋(올림 전)도 그 태그 몫
  assert.deepEqual(splitVersions([c('fix: 새것', 0), c('chore: 1.1.1 (11001)', 1)], 'v1.1.1').map((x) => [x.version, x.commits.length]), [['1.1.1', 2]]);
});

// 중립 출고 기록 fixture — 같은 앱 안에 2.x 줄과 4.x 줄이 따로 나간다
const item = (title) => ({ kind: 'fix', title });
const LINES = [
  { version: '2.0.17', at: '2026-05-01', channel: 'A', line: '2', items: [item('a')] },
  { version: '4.0.6', at: '2026-06-01', channel: 'B', line: '4', items: [item('b')] },
  { version: '2.0.18', at: '2026-07-01', channel: 'A', line: '2', items: [item('c')] },
  { version: '4.2.1', at: '2026-08-01', channel: 'B', line: '4', items: [item('d')] },
  { version: '4.4.8', at: '2026-09-01', channel: 'B', line: '4', items: [item('e')] },
];
const APP = [
  { version: '1.6.3', at: '2026-09-16', channel: 'A', items: [item('a')] },
  { version: '1.5.18', at: '2026-08-27', channel: 'A', items: [item('b')] },
  { version: '1.4.5', at: '2026-07-27', channel: 'A', items: [item('c')] },
  { version: '1.4.1', at: '2026-07-14', channel: 'A', items: [item('d')] },
];

test('출고 기록: 같은 줄 앞 출고, 출고 사이 커밋, 버전 목록 합치기', async () => {
  const { prevShipped, windowCommits, mergeVersions } = await import('../dist/apks/shipped.js');
  const { normVersion } = await import('../dist/apks/changes.js');
  const o = LINES;
  assert.equal(prevShipped(o, o.find((x) => x.version === '4.4.8')).version, '4.2.1');
  assert.equal(prevShipped(o, o.find((x) => x.version === '2.0.18')).version, '2.0.17');   // 4.x 가 끼어도 같은 줄만
  assert.equal(prevShipped(o, o.find((x) => x.version === '4.0.6')), null);
  const cs = [{ date: '2026-08-27T10:00:00+09:00', n: 1 }, { date: '2026-08-20T10:00:00+09:00', n: 2 }, { date: '2026-07-28T23:00:00+09:00', n: 3 }, { date: '2026-07-01T10:00:00+09:00', n: 4 }];
  assert.deepEqual(windowCommits(cs, '2026-07-28', '2026-08-27').map((c) => c.n), [1, 2]);
  assert.deepEqual(windowCommits(cs, null, '2026-07-28', 1).map((c) => c.n), [3]);
  const v = mergeVersions([{ version: '1.6.3', date: '2026-09-16T10:00:00', count: 2 }, { version: '1.5.10', date: '2026-08-25T10:00:00', count: 5 }],
    [{ tag: 'v1.6.3', date: '2026-09-16T12:00:00Z' }], APP, normVersion);
  assert.deepEqual(v.map((x) => [x.tag, x.release, !!x.shipped]), [['v1.6.3', true, true], ['v1.5.18', false, true], ['v1.5.10', false, false], ['v1.4.5', false, true], ['v1.4.1', false, true]]);
});

test('출고 기록 고치기: 검사, 추가, 고치기, 지우기', async () => {
  const { cleanShipped, upsertShipped } = await import('../dist/apks/shipped.js');
  assert.throws(() => cleanShipped({ version: '1.6', at: '2026-09-16', channel: 'x', items: [] }), /바뀐 내용/);
  assert.throws(() => cleanShipped({ version: 'abc', at: '2026-09-16', channel: 'x', items: [{ title: 'a' }] }), /버전/);
  assert.throws(() => cleanShipped({ version: '1.6.4', at: '9월', channel: 'x', items: [{ title: 'a' }] }), /출고일/);
  const r = cleanShipped({ version: 'v1.6.4', at: '2026-10-20', channel: ' 스토어  2종 ', items: [{ kind: 'zzz', title: ' 한 줄 ', detail: '' }, { title: '' }], note: '' });
  assert.deepEqual(r, { version: '1.6.4', at: '2026-10-20', channel: '스토어 2종', items: [{ kind: 'other', title: '한 줄' }] });
  const base = APP;
  const added = upsertShipped(base, null, r);
  assert.equal(added[0].version, '1.6.4');
  assert.throws(() => upsertShipped(added, null, r), /이미 있습니다/);
  const renamed = upsertShipped(added, '1.6.4', { ...r, version: '1.6.5' });
  assert.deepEqual(renamed.map((x) => x.version).slice(0, 2), ['1.6.5', '1.6.3']);
  assert.equal(upsertShipped(renamed, 'v1.6.5', null).length, base.length);
  assert.throws(() => upsertShipped(base, '9.9.9', null), /없는 출고 기록/);
});
