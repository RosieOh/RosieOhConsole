// 보안 헤더 — CSP 인라인 스크립트 해시, 클릭재킹 막기, https 일 때만 HSTS
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const { inlineScriptHashes, contentSecurityPolicy, securityHeaders } = await import('../dist/security-headers.js');

test('index.html 의 src 없는 스크립트만 해시로', () => {
  const body = "try { document.documentElement.dataset.theme = 'dark'; } catch (e) {}";
  const html = `<script>${body}</script><script type="module" src="/a.js"></script><script> </script>`;
  const want = `'sha256-${createHash('sha256').update(body).digest('base64')}'`;
  assert.deepEqual(inlineScriptHashes(html), [want]);
  assert.match(contentSecurityPolicy([want]), new RegExp(`script-src 'self' ${want.replace(/[+/]/g, '\\$&')}`));
});

test('헤더 — frame-ancestors none, X-Frame-Options, https 일 때만 HSTS', () => {
  const run = (https) => {
    const h = {};
    securityHeaders({ https })({}, { setHeader: (k, v) => { h[k] = v; } }, () => {});
    return h;
  };
  const plain = run(false), secure = run(true);
  assert.match(plain['Content-Security-Policy'], /frame-ancestors 'none'/);
  assert.match(plain['Content-Security-Policy'], /object-src 'none'/);
  assert.equal(plain['X-Frame-Options'], 'DENY');
  assert.equal(plain['X-Content-Type-Options'], 'nosniff');
  assert.equal(plain['Strict-Transport-Security'], undefined);
  assert.match(secure['Strict-Transport-Security'], /max-age=31536000/);
});
