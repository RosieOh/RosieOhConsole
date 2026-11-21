// MariaDB 저장 시험 — TEST_DATABASE_URL 이 있을 때만 돈다(없으면 건너뜀).
//   docker compose up -d mariadb
//   TEST_DATABASE_URL=mariadb://console:console@127.0.0.1:3307/console npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const url = process.env.TEST_DATABASE_URL;
const skip = url ? false : 'TEST_DATABASE_URL 없음';

test('MariaDB — 문서·rev·감사·파일, 다시 열어도 남는다, 옛 파일은 옮겨 온다', { skip }, async () => {
  process.env.DATA_DIR = mkdtempSync(tmpdir() + '/mxc-db-');
  const P = await import('../dist/persist.js');
  const { JsonStore, RevConflict } = await import('../dist/json-store.js');
  const mariadb = await import('mariadb');

  // 이 시험의 이름만 지운다(다른 데이터는 건드리지 않는다)
  const u = new URL(url);
  const admin = await mariadb.createConnection({ host: u.hostname, port: Number(u.port || 3306), user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), database: u.pathname.slice(1) });
  const tag = 't' + Date.now();
  try {
    await P.initPersist(url);
    assert.equal(P.persistInfo().driver, 'mariadb');

    const s = new JsonStore(`/nowhere/${tag}-doc.json`, () => ({ rev: 0, v: 1 }));
    s.update(0, (d) => { d.v = 2; });
    s.update(1, (d) => { d.v = 3; });
    assert.throws(() => s.update(1, () => {}), RevConflict);

    // 옛 파일이 있고 DB 에 없으면 옮겨 온다
    writeFileSync(`${process.env.DATA_DIR}/${tag}-legacy.json`, JSON.stringify({ rev: 7, v: 'old' }));
    assert.equal(new JsonStore(`${process.env.DATA_DIR}/${tag}-legacy.json`, () => ({ rev: 0 })).get().v, 'old');

    await P.appendAudit({ at: new Date().toISOString(), login: tag, action: 'test', target: 'x', ok: true });
    P.putBlob(`logos/${tag}.png`, 'image/png', Buffer.from([1, 2, 3]));
    assert.ok(P.hasBlob(`logos/${tag}.png`));
    await P.closePersist();

    // 다시 열면 DB 에서 읽는다
    await P.initPersist(url);
    assert.deepEqual(new JsonStore(`/elsewhere/${tag}-doc.json`, () => ({ rev: 0, v: 1 })).get(), { rev: 2, v: 3 });
    assert.equal(P.readDoc(`${tag}-legacy`).rev, 7);
    assert.ok((await P.readAudit(20)).some((a) => a.login === tag && a.ok === true));
    assert.deepEqual([...(await P.getBlob(`logos/${tag}.png`))], [1, 2, 3]);
    assert.ok(P.hasBlob(`logos/${tag}.png`));
  } finally {
    await P.closePersist().catch(() => {});
    await admin.query('DELETE FROM store WHERE name LIKE ?', [`${tag}-%`]).catch(() => {});
    await admin.query('DELETE FROM audit WHERE login = ?', [tag]).catch(() => {});
    await admin.query('DELETE FROM blob_file WHERE name LIKE ?', [`logos/${tag}%`]).catch(() => {});
    await admin.end();
  }
});
