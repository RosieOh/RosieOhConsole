import { test } from 'node:test';
import assert from 'node:assert/strict';

const { readHealth } = await import('../dist/status.service.js');

test('Spring actuator — db·redis 상태까지', () => {
  assert.deepEqual(readHealth({ status: 'UP', components: { db: { status: 'UP' }, redis: { status: 'DOWN' } } }, true), { up: true, db_status: 'UP', redis_status: 'DOWN' });
  assert.equal(readHealth({ status: 'DOWN' }, true).up, false);
});

test('다른 모양 — {status,db,redis} · {data:{status}} · {ok}', () => {
  assert.deepEqual(readHealth({ status: 'UP', db: 'UP', redis: 'UP' }, true), { up: true, db_status: 'UP', redis_status: 'UP' });
  assert.equal(readHealth({ success: true, data: { status: 'UP' } }, true).up, true);
  assert.equal(readHealth({ ok: true }, true).up, true);
});

test('JSON 이 아니면 HTTP 코드로만 판단', () => {
  assert.equal(readHealth(null, true).up, true);
  assert.equal(readHealth(null, false).up, false);
  assert.equal(readHealth({ status: 'UP' }, false).up, false);
});
