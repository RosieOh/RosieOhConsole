// 시크릿 값 쓰기 — 저장소 공개키 봉인(sealed box), 평문은 GitHub 요청에 실리지 않는다 (npm run build 뒤)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

process.env.DATA_DIR = mkdtempSync(tmpdir() + '/mxc-seal-');
process.env.GITHUB_WRITE_TOKEN = 'test-write-token';
process.env.GITHUB_OWNER = 'demo-owner';
const { sealSecret, _openSealed, _keypair } = await import('../dist/secrets/seal.js');
const { SecretsService } = await import('../dist/secrets/secrets.service.js');

test('봉인 — 공개키로 봉인한 값을 개인키로 열면 원래 값', async () => {
  const k = await _keypair();
  const sealed = await sealSecret('s3cr3t-값', k.publicB64);
  assert.notEqual(sealed, 's3cr3t-값');
  assert.equal(await _openSealed(sealed, k.publicKey, k.privateKey), 's3cr3t-값');
  await assert.rejects(sealSecret('x', Buffer.from('short').toString('base64')), /길이/);
});

test('시크릿 쓰기 — 공개키를 받아 봉인한 값과 key_id 로 PUT, 평문은 어디에도 없다', async () => {
  const k = await _keypair();
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET', body: init.body ?? null });
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
    if (String(url).includes('/actions/secrets/public-key')) return json({ key_id: 'kid-1', key: k.publicB64 });
    if (/\/actions\/secrets\?/.test(String(url))) return json({ total_count: 0, secrets: [] });
    if (init.method === 'PUT') return new Response(null, { status: 201 });
    return json({}, 404);
  };
  try {
    const svc = new SecretsService();
    const r = await svc.set('boss', { scope: 'repo', repo: 'demo-repo', kind: 'secret', name: 'DEPLOY_KEY', value: 'plain-value-123' });
    assert.equal(r.ok, true);
    assert.equal(r.created, true);
    const put = calls.find((c) => c.method === 'PUT');
    assert.match(put.url, /repos\/demo-owner\/demo-repo\/actions\/secrets\/DEPLOY_KEY$/);
    const body = JSON.parse(put.body);
    assert.equal(body.key_id, 'kid-1');
    assert.equal(await _openSealed(body.encrypted_value, k.publicKey, k.privateKey), 'plain-value-123');
    assert.ok(!calls.some((c) => String(c.body ?? '').includes('plain-value-123')), '평문이 요청에 실리면 안 된다');
  } finally {
    globalThis.fetch = realFetch;
  }
});
