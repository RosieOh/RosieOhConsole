import { test } from 'node:test';
import assert from 'node:assert/strict';

const { readReleaseBody, contentDisposition, rateLimiter } = await import('../dist/apks/release.js');
const { apkApps, hasReleases, isApkKind } = await import('../dist/apks/apps.js');

test('릴리스 본문 — versionCode·SHA-256·빌드 주소', () => {
  const body = '기기앱 v1.6.3 (versionCode 16003)\n\nSHA-256: A60CB499AE099B98DD80FA1912428CC602FBA695FB7148F6743B05D0AE537E7C\n빌드: https://github.com/demo-owner/demo-app/actions/runs/388';
  assert.deepEqual(readReleaseBody(body), {
    versionCode: 16003,
    sha256: 'a60cb499ae099b98dd80fa1912428cc602fba695fb7148f6743b05d0ae537e7c',
    buildUrl: 'https://github.com/demo-owner/demo-app/actions/runs/388',
    commit: null, server: null,
  });
  // 내부 테스트 빌드 본문 — 커밋, 서버 줄이 더 있다
  const t = readReleaseBody('기기앱 테스트배드 v1.6.3 #12 (versionCode 16003)\n\nSHA-256: ' + 'a'.repeat(64) + '\n빌드: http://x/runs/9\n커밋: 0123456789abcdef0123456789abcdef01234567\n서버: https://testbed.example.com/demo-app');
  assert.equal(t.commit, '0123456789abcdef0123456789abcdef01234567');
  assert.equal(t.server, 'https://testbed.example.com/demo-app');
});

test('사람이 쓴 릴리스 본문 — 없는 값은 null', () => {
  assert.deepEqual(readReleaseBody('그냥 메모'), { versionCode: null, sha256: null, buildUrl: null, commit: null, server: null });
  assert.deepEqual(readReleaseBody(null), { versionCode: null, sha256: null, buildUrl: null, commit: null, server: null });
});

test('다운로드 파일 이름이 헤더를 깨지 않는다', () => {
  assert.equal(contentDisposition('demo-app-v1.6.3.apk'), `attachment; filename="demo-app-v1.6.3.apk"; filename*=UTF-8''demo-app-v1.6.3.apk`);
  const h = contentDisposition('앱"\r\nX: 1.apk');
  assert.ok(!/[\r\n]/.test(h));
  assert.match(h, /filename="_+X: 1\.apk"/);
});

test('로그인 없는 다운로드 — IP 당 1분에 n 번', () => {
  const allow = rateLimiter(2, 60_000);
  assert.equal(allow('1.1.1.1', 0), true);
  assert.equal(allow('1.1.1.1', 10), true);
  assert.equal(allow('1.1.1.1', 20), false);
  assert.equal(allow('2.2.2.2', 20), true);
  assert.equal(allow('1.1.1.1', 60_001), true);
});

test('보관함 앱: 기기앱과 부모앱, 저장소 있는 것만, 카탈로그 순서 그대로 (#175)', () => {
  const comps = [
    { key: 'demo-api', kind: 'backend', repo: 'demo-api' },
    { key: 'demo-app', kind: 'device-app', repo: 'demo-app' },
    { key: 'demo-parents', kind: 'store-app', repo: 'demo-parents' },
    { key: 'web', kind: 'web', repo: 'demo-web' },
    { key: 'no-repo', kind: 'store-app', repo: '' },
  ];
  assert.deepEqual(apkApps(comps).map((c) => c.key), ['demo-app', 'demo-parents']);
  // 운영 칸(녹스, 출고 기록)은 기기앱만, 부모앱은 내부 테스트만
  assert.equal(hasReleases('device-app'), true);
  assert.equal(hasReleases('store-app'), false);
  assert.equal(isApkKind('backend'), false);
});

test('부모앱 내부 테스트 본문도 같은 칸으로 읽는다 (#175)', () => {
  const t = readReleaseBody('부모앱 테스트배드 v1.3.5 #3 (versionCode 13005)\n\nSHA-256: ' + 'b'.repeat(64) + '\n빌드: http://x/runs/7\n커밋: ' + 'c'.repeat(40) + '\n서버: https://testbed.example.com/demo-parents\n고객에게 나가는 앱이 아닙니다(개발 서버에 연동된 테스트용 빌드).');
  assert.equal(t.versionCode, 13005);
  assert.equal(t.sha256, 'b'.repeat(64));
  assert.equal(t.commit, 'c'.repeat(40));
  assert.equal(t.server, 'https://testbed.example.com/demo-parents');
});
