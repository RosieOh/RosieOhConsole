// CodeQL 경고를 고친 곳 — 객체 키·로그·GitHub 주소·SVG 정리·로고 형식 판단
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { isSafeKey, logSafe } = await import('../dist/safe.js');
const { ghUrl } = await import('../dist/github.js');
const { sanitizeSvg, sniff } = await import('../dist/catalog/logos.js');

test('객체 키 — 원형을 바꾸는 이름은 거절', () => {
  for (const k of ['__proto__', 'constructor', 'prototype', '', 1, null]) assert.equal(isSafeKey(k), false, String(k));
  for (const k of ['RosieOh/app', 'comp:web', 'v1.2.3']) assert.equal(isSafeKey(k), true);
});

test('로그 — 줄바꿈으로 가짜 줄을 끼워 넣지 못한다', () => {
  assert.ok(!/[\n\r\x1b]/.test(logSafe('a\n[APK] admin 다운로드\r\x1b[31m')));
  assert.equal(logSafe('a\nb'), 'a b');
  assert.equal(logSafe('x'.repeat(500)).length, 300);
});

test('GitHub API 주소 — API 밖으로 나가는 경로는 거절', () => {
  assert.equal(ghUrl('repos/a/b/releases').href, 'https://api.github.com/repos/a/b/releases');
  assert.equal(ghUrl('/user').href, 'https://api.github.com/user');
  assert.equal(ghUrl('//evil.example/x').origin, 'https://api.github.com');   // 앞의 / 는 걷어 내므로 API 안의 경로로 남는다
  for (const bad of ['repos/../../x', 'repos/a/%2e%2e/b', 'repos/a/%2E%2E%2Fb/..', 'https://evil.example/x', 'javascript:alert(1)']) {
    assert.throws(() => ghUrl(bad), undefined, bad);
  }
});

test('SVG — 지우면서 다시 이어 붙는 조각까지, 남으면 거절', () => {
  const nested = '<svg><scr<script>x</script>ipt>alert(1)</script><rect/></svg>';
  assert.ok(!/<script/i.test(sanitizeSvg(nested)));
  assert.ok(!/onload/i.test(sanitizeSvg('<svg><rect/onload="x()"/></svg>')));
  assert.ok(!/script/i.test(sanitizeSvg('<svg><script>a()</script\t\n bar></svg>')));
  assert.throws(() => sanitizeSvg('<svg><a href=" java\tscript:x">.</a><!ENTITY x "y"></svg>'));
  assert.equal(sanitizeSvg('<svg viewBox="0 0 1 1"><circle r="1"/></svg>'), '<svg viewBox="0 0 1 1"><circle r="1"/></svg>');
});

test('로고 형식 — 주석이 길어도 바로 끝난다(ReDoS 없음)', () => {
  assert.equal(sniff(Buffer.from('<?xml version="1.0"?><!-- a --><!-- b --><!DOCTYPE svg><svg>')), 'svg');
  const t = Date.now();
  assert.equal(sniff(Buffer.from('<!--' + '-'.repeat(1000))), null);
  assert.ok(Date.now() - t < 50);
});
