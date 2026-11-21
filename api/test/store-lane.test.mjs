import { test } from 'node:test';
import assert from 'node:assert/strict';

const { readStoreLane, latestStoreTag } = await import('../dist/deploy/store-lane.js');
const s = (name, conclusion) => ({ name, conclusion });

test('부모앱 릴리스 갈래 — 단계 이름으로', () => {
  assert.equal(readStoreLane([s('판정 — OTA 인지 스토어인지', 'success'), s('OTA 배포 (JS 만 바뀜)', 'skipped'), s('스토어 빌드 · 업로드 · 태그 (네이티브 바뀜)', 'success')], 'success'), 'store');
  assert.equal(readStoreLane([s('OTA 배포 (JS 만 바뀜)', 'success'), s('스토어 빌드 · 업로드 · 태그', 'skipped')], 'success'), 'ota');
  assert.equal(readStoreLane([s('dry-run — 판정 결과만 (올리지 않음)', 'success'), s('OTA 배포 (JS 만 바뀜)', 'skipped')], 'success'), 'dry-run');
  assert.equal(readStoreLane([s('판정', 'success'), s('OTA 배포', 'skipped')], 'success'), 'none');
  assert.equal(readStoreLane([s('의존성', 'failure')], 'failure'), 'failed');
});

test('스토어 버전 — 숫자로 비교', () => {
  assert.equal(latestStoreTag(['store/1.3.9', 'store/1.3.10', 'v2.0.0', 'store/x']), '1.3.10');
  assert.equal(latestStoreTag(['v1']), null);
});
