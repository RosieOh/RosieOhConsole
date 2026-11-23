// 공통(core) — 요청 제한, 출처 검사 (npm run build 뒤)
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.PUBLIC_URL = 'https://console.example.com';
process.env.ALLOWED_ORIGINS = 'https://other.example.com';
const { SlidingWindow, rateLimiter } = await import('../dist/core/rate-limit.js');
const { assertSameOrigin, CROSS_ORIGIN } = await import('../dist/core/http.js');

test('SlidingWindow — 창 안 횟수, 먼저 보기(full)·세기(hit)·되면 쓰기(take)', () => {
  const w = new SlidingWindow(2, 1000);
  assert.equal(w.full('a', 0), false);
  assert.equal(w.hit('a', 0), 1);
  assert.equal(w.hit('a', 100), 2);
  assert.equal(w.full('a', 200), true);
  assert.equal(w.take('a', 300), false);          // 넘으면 세지 않는다
  assert.equal(w.count('a', 300), 2);
  assert.equal(w.full('a', 1001), false);         // 창이 지나면 풀린다(0 은 빠지고 100 만)
  assert.equal(w.count('a', 1001), 1);
  assert.equal(w.take('b', 0), true);              // 키마다 따로
  w.delete('a'); assert.equal(w.count('a', 1001), 0);
  w.hit('c', 0); w.clear(); assert.equal(w.count('c', 0), 0);
});

test('rateLimiter — 함수 하나로(되면 true)', () => {
  const allow = rateLimiter(1, 60_000);
  assert.equal(allow('ip', 0), true);
  assert.equal(allow('ip', 1), false);
  assert.equal(allow('ip', 60_001), true);
});

test('assertSameOrigin — PUBLIC_URL·ALLOWED_ORIGINS 만, Origin 없으면 통과(같은 출처 GET 등)', () => {
  const req = (origin) => ({ get: (h) => (h === 'origin' ? origin : undefined) });
  assert.doesNotThrow(() => assertSameOrigin(req('https://console.example.com')));
  assert.doesNotThrow(() => assertSameOrigin('https://other.example.com'));
  assert.doesNotThrow(() => assertSameOrigin(undefined));
  assert.throws(() => assertSameOrigin(req('https://evil.example.com')), (e) => e.getStatus() === 403 && e.message === CROSS_ORIGIN);
});
