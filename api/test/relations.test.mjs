import { test } from 'node:test';
import assert from 'node:assert/strict';

const { extractClues, matchClues, wantFile } = await import('../dist/relations/scan.js');

const known = {
  hostToComp: [{ host: 'auth.demo.dev', comp: 'sso' }, { host: 'auth.demo.dev', path: '/admin', comp: 'admin' },
    { host: 'testbed.demo.dev', path: '/demo', comp: 'demo-api' }, { host: 'api.demo.dev', comp: 'demo-api' }],
  infraHosts: [{ host: 'cache.example.net', id: 'redis-shared' }, { host: 'supabase.co', id: 'ota' }],
  defaultRedis: 'infra:redis-shared',
};
const run = (text, self = ['me'], path = 'application.yml') => {
  const lines = text.split('\n');
  return matchClues(extractClues(text).map((clue) => ({ clue, path, lineText: lines[clue.line - 1] })), known, self);
};

test('주소 자리의 호스트만 — 코드 식별자는 호스트가 아니다', () => {
  const c = extractClues('import com.example.app.common.Config;\nthis.app.run()\nval x = error.me\nbase-url: https://api.demo.dev/api\nREDIS_HOST=cache.example.net\n<domain includeSubdomains="true">auth.demo.dev</domain>');
  const hosts = c.filter((x) => x.kind === 'host').map((x) => x.value);
  assert.deepEqual(hosts.sort(), ['api.demo.dev', 'auth.demo.dev', 'cache.example.net']);
});

test('호스트·키 이름 → 서비스·인프라, 자기 자신은 뺀다', () => {
  const { hits } = run('auth:\n  base-url: https://auth.demo.dev\nspring.datasource.url=jdbc:mariadb://app-db.example.net:3306/x\nAPI=https://api.demo.dev\nHOT_UPDATER_SUPABASE_URL=https://xxxx.supabase.co', ['demo-api']);
  const t = hits.map((h) => h.target).sort();
  assert.deepEqual(t, ['comp:sso', 'db:app-db.example.net', 'infra:ota']);
});

test('같은 호스트를 나눠 쓰면 경로로 가린다(공용 테스트배드·auth/admin)', () => {
  assert.deepEqual(run('URL=https://testbed.demo.dev/demo/api').hits.map((h) => h.target), ['comp:demo-api']);
  assert.deepEqual(run('ADMIN=https://auth.demo.dev/admin/api').hits.map((h) => h.target), ['comp:admin']);
  assert.deepEqual(run('AUTH=https://auth.demo.dev/oauth').hits.map((h) => h.target), ['comp:sso']);
});

test('근거에는 값이 없다 — 키 이름과 호스트만', () => {
  const { hits } = run('SSO_SECRET=abcd1234supersecret\nDB_URL=jdbc:mysql://user:pw123@db1.example.net/x', ['demo-api']);
  const all = JSON.stringify(hits);
  assert.ok(!all.includes('abcd1234supersecret') && !all.includes('pw123'), all);
});

test('모르는 호스트는 확인 필요로', () => {
  const { unknown } = run('PAY_URL=https://pay.someshop.co.kr/v1');
  assert.deepEqual(unknown.map((u) => u.host), ['pay.someshop.co.kr']);
});

test('읽을 파일 고르기', () => {
  for (const p of ['src/main/resources/application-prod.yml', '.env.example', 'config/deploy.prod.yml', 'android/app/build.gradle', 'src/api/serverEnv.ts', 'android/app/src/main/res/xml/network_security_config.xml']) assert.ok(wantFile(p), p);
  for (const p of ['node_modules/x/config.js', 'build/libs/a.yml', 'src/test/resources/application.yml', 'README.md', 'src/api/x.test.ts']) assert.ok(!wantFile(p), p);
});
