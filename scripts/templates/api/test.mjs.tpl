import { test } from 'node:test';
import assert from 'node:assert/strict';

const { toView, invalid } = await import('../dist/__NAME__/model.js');

test('__TITLE__ — 이름 순으로, 같은 이름은 id 순', () => {
  const v = toView([{ id: 'b', name: '나' }, { id: 'c', name: '가' }, { id: 'a', name: '나' }], new Date('2026-01-01T00:00:00Z'));
  assert.deepEqual(v.items.map((x) => x.id), ['c', 'a', 'b']);
  assert.equal(v.updatedAt, '2026-01-01T00:00:00.000Z');
});

test('__TITLE__ — 입력 검사', () => {
  assert.equal(invalid({ id: 'ok-1', name: '이름' }), null);
  assert.match(invalid({ id: 'Bad ID', name: '이름' }), /id/);
  assert.match(invalid({ id: 'ok', name: '  ' }), /이름/);
});
