// 업무 보드 저장소 찾기 — 주인 + 모든 조직, 질의 나누기·이름·정렬 (npm run build 뒤)
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { searchQueries, searchGraphql, collect, consoleName, cleanText, directRepo, SEARCH_MAX } = await import('../dist/board/repo-search.js');

test('질의 — 검색어 + user:/org:, 256자를 넘지 않게 나눈다', () => {
  const orgs = Array.from({ length: 30 }, (_, i) => `Organization-Number-${i}`);
  const qs = searchQueries('fit', 'RosieOh', orgs);
  assert.ok(qs.length > 1);
  for (const q of qs) { assert.ok(q.length <= SEARCH_MAX, q.length); assert.match(q, /^fit in:name fork:true sort:updated /); }
  const all = qs.join(' ');
  assert.match(all, /user:RosieOh/);
  for (const o of orgs) assert.ok(all.includes(`org:${o}`), o);
  // 빈 검색어 — 최근 수정 순, 주인과 같은 이름의 조직·겹친 조직은 한 번만
  const empty = searchQueries('', 'RosieOh', ['MarioOrg', 'MarioOrg', 'rosieoh']);
  assert.deepEqual(empty, ['fork:true sort:updated user:RosieOh org:MarioOrg']);
});

test('검색어·직접 찾기', () => {
  assert.equal(cleanText(' my "repo" org:evil '), 'my repo org evil');
  assert.deepEqual(directRepo('MarioOrg/team-1'), { owner: 'MarioOrg', name: 'team-1' });
  assert.equal(directRepo('team'), null);
  assert.equal(directRepo('a/b/c'), null);
  const q = searchGraphql(['x'], { owner: 'MarioOrg', name: 'te"am' });
  assert.match(q, /s0: search\(query: "x", type: REPOSITORY/);
  assert.match(q, /d: repository\(owner: "MarioOrg", name: "te\\"am"\)/);
});

test('결과 — 주인 저장소는 이름만, 조직은 조직/저장소, 겹침 빼고 직접 찾은 것 → 보관 아닌 것 → 최근 순', () => {
  assert.equal(consoleName('rosieoh/Blog', 'RosieOh'), 'Blog');
  assert.equal(consoleName('MarioOrg/team', 'RosieOh'), 'MarioOrg/team');
  const n = (nameWithOwner, pushedAt, o = {}) => ({ nameWithOwner, owner: { login: nameWithOwner.split('/')[0] }, description: null, isPrivate: false, isArchived: false, pushedAt, ...o });
  const r = collect({
    s0: { nodes: [n('RosieOh/old', '2025-01-01T00:00:00Z'), n('RosieOh/new', '2026-11-01T00:00:00Z'), {}] },
    s1: { nodes: [n('MarioOrg/team', '2026-06-01T00:00:00Z'), n('MarioOrg/arch', '2026-11-20T00:00:00Z', { isArchived: true }), n('RosieOh/new', '2026-11-01T00:00:00Z')] },
    d: n('Other/picked', '2020-01-01T00:00:00Z', { isPrivate: true }),
  }, 'RosieOh');
  assert.deepEqual(r.map((x) => x.repo), ['Other/picked', 'new', 'MarioOrg/team', 'old', 'MarioOrg/arch']);
  assert.equal(r[0].private, true);
  assert.equal(r[0].owner, 'Other');
  assert.deepEqual(collect({ d: null, s0: null }, 'RosieOh'), []);   // 직접 찾기 실패·빈 결과
});
