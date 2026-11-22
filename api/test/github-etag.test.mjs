// GitHub 조건부 요청 — 두 번째부터 If-None-Match 를 보내고, 304 면 담아 둔 본문을 돌려준다(304 는 한도에서 빠진다)
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { ghJson, ghFetch, ghStats } = await import('../dist/github.js');

test('ETag — 304 면 담아 둔 본문, POST 는 담지 않는다', async () => {
  const real = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), method: init?.method ?? 'GET', inm: init?.headers?.['If-None-Match'] });
    if ((init?.method ?? 'GET') !== 'GET') return new Response('{"ok":true}', { status: 201 });
    if (init?.headers?.['If-None-Match'] === '"v1"') return new Response(null, { status: 304, headers: { etag: '"v1"', 'x-ratelimit-remaining': '4990' } });
    return new Response(JSON.stringify({ n: 1 }), { status: 200, headers: { etag: '"v1"', 'content-type': 'application/json', 'x-ratelimit-remaining': '4991' } });
  };
  try {
    const before = ghStats().notModified;
    assert.deepEqual(await ghJson('repos/a/b/actions/runs?per_page=10'), { n: 1 });
    assert.deepEqual(await ghJson('repos/a/b/actions/runs?per_page=10'), { n: 1 });   // 304 → 담아 둔 본문
    assert.deepEqual(await ghJson('repos/a/b/actions/runs?per_page=10'), { n: 1 });
    assert.equal(seen[0].inm, undefined);
    assert.equal(seen[1].inm, '"v1"');
    assert.equal(ghStats().notModified - before, 2);
    assert.equal(ghStats().remaining, 4990);
    await ghFetch('repos/a/b/dispatches', { method: 'POST', body: '{}' });
    await ghFetch('repos/a/b/dispatches', { method: 'POST', body: '{}' });
    assert.equal(seen.filter((x) => x.method === 'POST' && x.inm).length, 0);
    assert.ok(ghStats().top.some(([k]) => k === 'repos/:repo/actions/runs'));
  } finally { globalThis.fetch = real; }
});
